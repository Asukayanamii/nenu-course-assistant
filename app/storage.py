"""JSON 文件持久化存储"""
import json
import os
import shutil
import sys
import time

if getattr(sys, 'frozen', False):
    _DATA_BASE = os.path.dirname(sys.executable)
else:
    _DATA_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(_DATA_BASE, 'data')
DATA_FILE = os.path.join(DATA_DIR, 'storage.json')
TEMPLATE_FILE = os.path.join(DATA_DIR, 'storage.template.json')

COOKIE_DOMAIN = 'bkjx.nenu.edu.cn'
SHARED_COOKIE_DOMAIN = '.nenu.edu.cn'

# NENU 用 Apereo CAS 标准票根名；这张票可反复换出新的业务会话
TICKET_COOKIE_NAMES = ('CASTGC',)

# 必须发给认证中心的 Cookie：票根 + 浏览器指纹（指纹用于通过多因子风控）
AUTH_COOKIE_NAMES = (
    'CASTGC',
    'MOD_AUTH_CAS',
    'MULTIFACTOR_BROWSER_FINGERPRINT',
    'iPlanetDirectoryPro',
    'WIS_PER_ENC',
    'REFERERCE_TOKEN',
    'happyVoyage',
)

# 认证中心自己域的会话 Cookie，随票根一起应归认证侧
AUTH_SESSION_COOKIE_NAMES = ('JSESSIONID', 'route', 'acw_tc')

# 出现任意一个，即可判定这段 Cookie 来自认证中心而非选课系统
AUTH_SIDE_MARKERS = (
    'CASTGC',
    'MOD_AUTH_CAS',
    'MULTIFACTOR_BROWSER_FINGERPRINT',
    'WIS_PER_ENC',
    'REFERERCE_TOKEN',
    'happyVoyage',
)

_default = {
    'cookies': {},           # cookie_dict（扁平镜像，兼容旧版本）
    'cookie_jar': [],        # [{name, value, domain, path, expires}] 多域会话，含自动续期票据
    'grab_list': [],         # [{kcrwdm, kcmc, jxbmc, teaxms, pkrs, jxbrs, xqjc}, ...]
    'config': {},            # 选课配置缓存
    'xklxdm': '08',          # 选课类型代码，预选=08
    'settings': {},          # 本地设置（保活开关等）
    'updated_at': '',
}


def classify_cookies(cookie_dict):
    """把一段 Cookie 归类成多域 jar。

    判定这段 Cookie 来自哪个域名：
      - 含认证中心特有 Cookie（CASTGC / MOD_AUTH_CAS / 指纹 等）
        说明来自认证中心：票根与指纹归 .nenu.edu.cn 才能递出去，
        其 JSESSIONID / route 等属于认证侧会话，直接丢弃以免混进选课系统请求
      - 否则视为来自选课系统，业务 Cookie 归 bkjx 域
    """
    auth_side = any(name in cookie_dict for name in AUTH_SIDE_MARKERS)
    jar = []
    for name, value in cookie_dict.items():
        if not name or not value:
            continue
        if name in AUTH_COOKIE_NAMES:
            domain = SHARED_COOKIE_DOMAIN
        elif auth_side and name in AUTH_SESSION_COOKIE_NAMES:
            continue
        else:
            domain = COOKIE_DOMAIN
        jar.append({
            'name': name,
            'value': value,
            'domain': domain,
            'path': '/',
            'expires': None,
        })
    return jar


def _migrate_legacy_cookies(flat):
    """旧格式（扁平 dict）→ 多域 jar，无需人工干预"""
    return classify_cookies(flat or {})


def _ensure_file():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        if os.path.exists(TEMPLATE_FILE):
            shutil.copy(TEMPLATE_FILE, DATA_FILE)
        else:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(_default, f, ensure_ascii=False, indent=2)


def load():
    _ensure_file()
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return dict(_default)


def save(data):
    data['updated_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_cookies():
    return load().get('cookies', {})


def save_cookies(cookie_dict):
    data = load()
    data['cookies'] = cookie_dict
    save(data)


def get_cookie_jar():
    """读取多域会话 Cookie；旧数据自动迁移，无需人工干预"""
    data = load()
    if 'cookie_jar' in data:
        return data.get('cookie_jar') or []
    return _migrate_legacy_cookies(data.get('cookies', {}))


def save_cookie_jar(jar):
    """保存多域会话 Cookie，并同步扁平镜像供旧版本读取"""
    data = load()
    data['cookie_jar'] = jar
    flat = {}
    for c in jar:
        name = c.get('name')
        if name:
            flat[name] = c.get('value', '')
    data['cookies'] = flat
    save(data)


def get_settings():
    return load().get('settings', {})


def save_settings(cfg):
    data = load()
    data['settings'] = cfg
    save(data)


def get_grab_list():
    return load().get('grab_list', [])


def save_grab_list(items):
    data = load()
    data['grab_list'] = items
    save(data)


def get_config():
    return load().get('config', {})


def save_config(cfg):
    data = load()
    data['config'] = cfg
    save(data)


def get_xklxdm():
    return load().get('xklxdm', '08')


def save_xklxdm(val):
    data = load()
    data['xklxdm'] = val
    save(data)
