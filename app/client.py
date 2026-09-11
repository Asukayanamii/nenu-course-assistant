"""NENU 选课系统 API 客户端"""
import requests
import time
import logging
import threading
from urllib.parse import urljoin, quote

from .storage import (
    COOKIE_DOMAIN,
    SHARED_COOKIE_DOMAIN,
    TICKET_COOKIE_NAMES,
    classify_cookies,
)

logger = logging.getLogger(__name__)

BASE_URL = 'https://bkjx.nenu.edu.cn'
AUTHSERVER_URL = 'https://authserver.nenu.edu.cn'
COMMON_XKLXDM = ['08', '09', '01', '02', '00']

CAS_SESSION_COOKIE_NAMES = ('JSESSIONID', 'route')
SSO_SERVICE = f'{BASE_URL}/new/ssoLogin'    # 站点根 302 到认证中心时使用的 service
RENEW_FAIL_BACKOFF = 60          # 续期失败后的退避时间（秒），避免连续失败时反复重试


POOL_MAP = {
    '02': {'name': '本部专业', 'campus': '本部', 'type': '专业'},
    '06': {'name': '本部公共', 'campus': '本部', 'type': '公共'},
    '07': {'name': '净月专业', 'campus': '净月', 'type': '专业'},
    '08': {'name': '净月公共', 'campus': '净月', 'type': '公共'},
}


class CourseClient:
    """纯 API 客户端，只负责发请求，不负责存储"""

    def __init__(self, cookies_dict=None, xklxdm='08', cookie_jar=None):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        })
        self.config = None
        self._last_activity = 0
        self.xklxdm = xklxdm
        self.renewed_at = 0
        self.on_session_refresh = None      # 续期成功后的回调（由会话管理器注入，用于落盘）
        self._renewing = False
        self._renew_failed_at = 0
        self._renew_lock = threading.Lock()

        if cookie_jar:
            self.load_cookie_jar(cookie_jar)
        elif cookies_dict:
            self.set_cookies(cookies_dict)

    # ----- Cookie 装载 / 导出 -----

    def set_cookies(self, cookies_dict):
        """按名称自动分域：票据与指纹归认证侧，业务 Cookie 归选课系统侧"""
        self.load_cookie_jar(classify_cookies(cookies_dict))

    def load_cookie_jar(self, jar):
        now = time.time()
        for c in jar or []:
            name, value = c.get('name'), c.get('value')
            if not name or not value:
                continue
            expires = c.get('expires')
            if expires and expires < now:
                continue
            domain = c.get('domain') or COOKIE_DOMAIN
            self.session.cookies.set(name, value, domain=domain, path=c.get('path') or '/')

    def export_cookie_jar(self):
        """导出当前会话 Cookie（多域，含过期时间），供持久化"""
        now = time.time()
        jar = []
        try:
            pending = list(self.session.cookies)
        except RuntimeError:
            return jar
        for c in pending:
            if c.is_expired(now) or 'nenu.edu.cn' not in (c.domain or ''):
                continue
            jar.append({
                'name': c.name,
                'value': c.value,
                'domain': c.domain,
                'path': c.path or '/',
                'expires': c.expires,
            })
        return jar

    def has_ticket(self):
        """是否持有 CAS 票根（自动续期的前提）"""
        try:
            pending = list(self.session.cookies)
        except RuntimeError:
            return False
        return any(c.name in TICKET_COOKIE_NAMES and not c.is_expired() for c in pending)

    # ----- 请求 -----

    @staticmethod
    def _parse_json(resp):
        try:
            return resp.json()
        except Exception:
            return {'code': -1, 'message': '解析响应失败'}

    @staticmethod
    def _looks_like_login_page(resp):
        """会话失效时业务接口会返回登录页 HTML 而不是 JSON"""
        if 'html' not in (resp.headers.get('Content-Type') or '').lower():
            return False
        if 'authserver' in (resp.url or ''):
            return True
        text = (resp.text or '')[:4000]
        return any(m in text for m in ('authserver', '统一身份认证', 'pwdEncryptSalt'))

    def _send(self, method, url, auto_renew=True, **kwargs):
        """发请求并解析 JSON；识别到会话失效时自动续期并重试一次"""
        resp = self.session.request(method, url, timeout=15, **kwargs)
        self._last_activity = time.time()
        data = self._parse_json(resp)

        invalid = (resp.status_code in (401, 403)
                   or (isinstance(data, dict) and data.get('code') == -401)
                   or self._looks_like_login_page(resp))
        if invalid and auto_renew and not self._renewing and self.renew_session():
            resp = self.session.request(method, url, timeout=15, **kwargs)
            self._last_activity = time.time()
            data = self._parse_json(resp)
        return data

    def _api_post(self, path, data=None, referer=None, xklxdm=None, auto_renew=True):
        _x = xklxdm or self.xklxdm
        url = urljoin(BASE_URL, path)
        headers = {'Referer': referer or f'{BASE_URL}/xsxk.html?xklxdm={_x}'}
        return self._send('post', url, data=data, headers=headers, auto_renew=auto_renew)

    def _api_get(self, path, params=None, referer=None, auto_renew=True):
        url = urljoin(BASE_URL, path)
        headers = {}
        if referer:
            headers['Referer'] = referer
        return self._send('get', url, params=params, headers=headers, auto_renew=auto_renew)

    # ----- 会话自动续期 -----

    def _drop_cas_session_cookies(self):
        """清掉认证域上的陈旧会话 Cookie（保留票据），避免登录流程状态污染"""
        targets = [c for c in list(self.session.cookies)
                   if c.name in CAS_SESSION_COOKIE_NAMES
                   and 'authserver' in (c.domain or '')]
        for c in targets:
            try:
                self.session.cookies.clear(c.domain, c.path or '/', c.name)
            except KeyError:
                pass

    def _verify_login(self, xklxdm=None):
        _x = xklxdm or self.xklxdm
        r = self._api_post(f'/new/student/xsxk/xklx/{_x}/config', {}, xklxdm=_x, auto_renew=False)
        if r.get('code', -1) >= 0:
            self.config = r.get('data') or {}
            return True
        return False

    def renew_session(self, xklxdm=None, force=False):
        """用 CAS 票根静默换取全新的业务会话，不需要账号密码。

        链路：认证中心凭票根（+浏览器指纹）换出 service ticket
              -> 回跳 /new/ssoLogin?ticket=... -> 选课系统下发新的 JSESSIONID
        """
        if not self.has_ticket():
            logger.info('未检测到登录票根（%s），跳过自动续期', '/'.join(TICKET_COOKIE_NAMES))
            return False
        if not force and time.time() - self._renew_failed_at < RENEW_FAIL_BACKOFF:
            return False
        if self._renewing or not self._renew_lock.acquire(blocking=False):
            logger.info('已有请求正在续期，跳过本次')
            return False

        self._renewing = True
        try:
            _x = xklxdm or self.xklxdm
            logger.info('检测到会话失效，尝试用登录票根自动续期')
            self._drop_cas_session_cookies()

            # 主路径：认证中心凭票根换票后回跳选课系统
            service = quote(SSO_SERVICE, safe='')
            self.session.get(f'{AUTHSERVER_URL}/authserver/login?service={service}',
                             timeout=15, allow_redirects=True)
            if self._verify_login(_x):
                return self._after_renew()

            # 兜底：从站点根进入（根路径会 302 到认证中心，并带上相同的 service）
            self.session.get(f'{BASE_URL}/', timeout=15, allow_redirects=True)
            if self._verify_login(_x):
                return self._after_renew()

            self._renew_failed_at = time.time()
            logger.warning('自动续期失败，票根可能已过期')
            return False
        except requests.RequestException as e:
            self._renew_failed_at = time.time()
            logger.warning('自动续期请求异常: %s', e)
            return False
        finally:
            self._renewing = False
            self._renew_lock.release()

    def _after_renew(self):
        self.renewed_at = time.time()
        self._renew_failed_at = 0
        logger.info('会话自动续期成功')
        if self.on_session_refresh:
            try:
                self.on_session_refresh()
            except Exception as e:
                logger.warning('续期回调异常: %s', e)
        return True

    # ----- 登录 -----
    def check_login(self):
        r = self.load_config()
        return r.get('code', -1) >= 0

    # ----- 配置 -----
    def load_config(self, xklxdm=None):
        _x = xklxdm or self.xklxdm
        r = self._api_post(f'/new/student/xsxk/xklx/{_x}/config', {}, xklxdm=_x)
        if r.get('code', -1) >= 0:
            self.config = r['data']
        return r

    def load_combo(self, guid):
        return self._api_post('/new/combo/getData', {'guid': guid})

    def get_xfqb(self):
        return self._api_get('/new/student/xsxk/xfqb')

    # ----- 课程查询 -----
    def query_hzkc(self, params=None, page=1, rows=60, xklxdm=None):
        _x = xklxdm or self.xklxdm
        data = {'page': page, 'rows': rows, 'nd': '', 'zydm': ''}
        if params:
            data.update(params)
        return self._api_post(f'/new/student/xsxk/xklx/{_x}/hzkc', data, xklxdm=_x)

    def query_kxkc(self, kcptdm=None, hasme=0, page=1, rows=50, extra_params=None, xklxdm=None):
        _x = xklxdm or self.xklxdm
        data = {'page': page, 'rows': rows, 'hasme': hasme}
        if kcptdm:
            data['kcptdm'] = kcptdm
        if extra_params:
            data.update(extra_params)
        return self._api_post(f'/new/student/xsxk/xklx/{_x}/kxkc', data, xklxdm=_x)

    def query_yxkc(self, page=1, rows=50, xklxdm=None):
        _x = xklxdm or self.xklxdm
        return self._api_post(f'/new/student/xsxk/xklx/{_x}/yxkc',
                              {'page': page, 'rows': rows}, xklxdm=_x)

    # ----- 选课操作 -----
    def add_course(self, kcrwdm, kcmc='', qz=-1, hlct=0, xklxdm=None):
        _x = xklxdm or self.xklxdm
        return self._api_post(f'/new/student/xsxk/xklx/{_x}/add',
                              {'kcrwdm': kcrwdm, 'kcmc': kcmc, 'qz': qz, 'hlct': hlct},
                              xklxdm=_x)

    def cancel_course(self, kcrwdm, jxbdm='', kcmc='', xklxdm=None):
        _x = xklxdm or self.xklxdm
        return self._api_post(f'/new/student/xsxk/xklx/{_x}/cancel',
                              {'kcrwdm': kcrwdm, 'jxbdm': jxbdm, 'kcmc': kcmc},
                              xklxdm=_x)
