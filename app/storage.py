"""JSON 文件持久化存储"""
import json
import os
import shutil
import time

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
DATA_FILE = os.path.join(DATA_DIR, 'storage.json')
TEMPLATE_FILE = os.path.join(DATA_DIR, 'storage.template.json')

_default = {
    'cookies': {},           # cookie_dict
    'grab_list': [],         # [{kcrwdm, kcmc, jxbmc, teaxms, pkrs, jxbrs, xqjc}, ...]
    'config': {},            # 选课配置缓存
    'updated_at': '',
}


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
