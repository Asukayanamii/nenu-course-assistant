"""NENU 选课系统 API 客户端"""
import requests
import time
import logging
from urllib.parse import urljoin

logger = logging.getLogger(__name__)

BASE_URL = 'https://bkjx.nenu.edu.cn'
COMMON_XKLXDM = ['08', '09', '01', '02', '00']


POOL_MAP = {
    '02': {'name': '本部专业', 'campus': '本部', 'type': '专业'},
    '06': {'name': '本部公共', 'campus': '本部', 'type': '公共'},
    '07': {'name': '净月专业', 'campus': '净月', 'type': '专业'},
    '08': {'name': '净月公共', 'campus': '净月', 'type': '公共'},
}


class CourseClient:
    """纯 API 客户端，只负责发请求，不负责存储"""

    def __init__(self, cookies_dict=None, xklxdm='08'):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        })
        self.config = None
        self._last_activity = 0
        self.xklxdm = xklxdm

        if cookies_dict:
            self.set_cookies(cookies_dict)

    def set_cookies(self, cookies_dict):
        for key, val in cookies_dict.items():
            self.session.cookies.set(key, val, domain='bkjx.nenu.edu.cn')

    def _api_post(self, path, data=None, referer=None, xklxdm=None):
        _x = xklxdm or self.xklxdm
        url = urljoin(BASE_URL, path)
        headers = {'Referer': referer or f'{BASE_URL}/xsxk.html?xklxdm={_x}'}
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
