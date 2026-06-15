"""NENU 选课系统 API 客户端"""
import requests
import time
import logging
from urllib.parse import urljoin

logger = logging.getLogger(__name__)

BASE_URL = 'https://bkjx.nenu.edu.cn'
XKLXDM = '08'


class CourseClient:
    """纯 API 客户端，只负责发请求，不负责存储"""

    def __init__(self, cookies_dict=None):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        })
        self.config = None
        self._last_activity = 0

        if cookies_dict:
            self.set_cookies(cookies_dict)

    def set_cookies(self, cookies_dict):
        for key, val in cookies_dict.items():
            self.session.cookies.set(key, val, domain='bkjx.nenu.edu.cn')

    def _api_post(self, path, data=None, referer=None):
        url = urljoin(BASE_URL, path)
        headers = {'Referer': referer or f'{BASE_URL}/xsxk.html?xklxdm={XKLXDM}'}
        resp = self.session.post(url, data=data, headers=headers, timeout=15)
        self._last_activity = time.time()
        try:
            return resp.json()
        except Exception:
            return {'code': -1, 'message': '解析响应失败'}

    def _api_get(self, path, params=None, referer=None):
        url = urljoin(BASE_URL, path)
        headers = {}
        if referer:
            headers['Referer'] = referer
        resp = self.session.get(url, params=params, headers=headers, timeout=15)
        self._last_activity = time.time()
        try:
            return resp.json()
        except Exception:
            return {'code': -1, 'message': '解析响应失败'}

    # ----- 登录 -----
    def check_login(self):
        r = self.load_config()
        return r.get('code', -1) >= 0

    # ----- 配置 -----
    def load_config(self):
        r = self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/config', {})
        if r.get('code', -1) >= 0:
            self.config = r['data']
        return r

    def load_combo(self, guid):
        return self._api_post('/new/combo/getData', {'guid': guid})

    def get_xfqb(self):
        return self._api_get('/new/student/xsxk/xfqb')

    # ----- 课程查询 -----
    def query_hzkc(self, params=None, page=1, rows=60):
        data = {'page': page, 'rows': rows, 'nd': '', 'zydm': ''}
        if params:
            data.update(params)
        return self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/hzkc', data)

    def query_kxkc(self, kcptdm=None, hasme=0, page=1, rows=50, extra_params=None):
        data = {'page': page, 'rows': rows, 'hasme': hasme}
        if kcptdm:
            data['kcptdm'] = kcptdm
        if extra_params:
            data.update(extra_params)
        return self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/kxkc', data)

    def query_yxkc(self, page=1, rows=50):
        return self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/yxkc',
                              {'page': page, 'rows': rows})

    # ----- 选课操作 -----
    def add_course(self, kcrwdm, kcmc='', qz=-1, hlct=0):
        return self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/add',
                              {'kcrwdm': kcrwdm, 'kcmc': kcmc, 'qz': qz, 'hlct': hlct})

    def cancel_course(self, kcrwdm, jxbdm='', kcmc=''):
        return self._api_post(f'/new/student/xsxk/xklx/{XKLXDM}/cancel',
                              {'kcrwdm': kcrwdm, 'jxbdm': jxbdm, 'kcmc': kcmc})
