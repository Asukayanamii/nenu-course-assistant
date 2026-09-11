"""Flask 路由 — API 代理 + 持久化"""
import time
from flask import Blueprint, render_template, request, jsonify

from .client import CourseClient, BASE_URL
from . import storage
from . import session_manager

api = Blueprint('api', __name__)


def _make_client():
    """获取共享会话客户端（Cookie 与自动续期状态全局一致）"""
    return session_manager.get_client()


# ==================== 页面 ====================

@api.route('/')
def index():
    return render_template('index.html')


# ==================== Cookie ====================

def _diagnose_failure(cookie_dict, result):
    """验证失败时给出可执行的排查提示"""
    msg = result.get('message') or '验证失败'
    if any(name in cookie_dict for name in storage.AUTH_SIDE_MARKERS):
        return (f'{msg}（这批 Cookie 来自统一身份认证，不含选课系统的会话：'
                f'请先在 bkjx.nenu.edu.cn 登录，再打开选课页面 xsxk.html?xklxdm=08 '
                f'复制该页面的 Cookie，或使用内置浏览器登录）')
    return (f'{msg}（Cookie 可能已过期：请打开选课页面 xsxk.html?xklxdm=08 '
            f'重新复制，或使用内置浏览器登录）')


@api.route('/api/cookies/set', methods=['POST'])
def set_cookies():
    data = request.json or {}
    raw = data.get('cookies', '').strip()
    if not raw:
        return jsonify({'code': -1, 'message': 'Cookie 不能为空'})

    # 解析 cookie 字符串 → dict
    cookie_dict = {}
    for item in raw.split(';'):
        item = item.strip()
        if '=' in item:
            k, v = item.split('=', 1)
            k, v = k.strip(), v.strip()
            if k:
                cookie_dict[k] = v

    if not cookie_dict:
        return jsonify({'code': -1, 'message': '未解析到有效的 Cookie'})

    # 获取选课类型代码
    xklxdm = data.get('xklxdm', '') or storage.get_xklxdm() or '08'

    client = CourseClient(cookies_dict=cookie_dict, xklxdm=xklxdm)
    result = client.load_config()

    if result.get('code', -1) >= 0:
        storage.save_cookie_jar(client.export_cookie_jar())
        storage.save_config(result.get('data', {}))
        storage.save_xklxdm(xklxdm)
        session_manager.adopt(client, mode=session_manager.MODE_MANUAL)
        tgt = client.has_ticket()
        msg = ('验证通过（已开启自动续期）' if tgt
               else '验证通过（纯粘贴模式：将尽力保活，失效后需重新粘贴）')
        return jsonify({'code': 0, 'message': msg, 'data': result['data'], 'tgt_present': tgt})
    else:
        return jsonify({'code': -1, 'message': _diagnose_failure(cookie_dict, result)})


@api.route('/api/cookies/check')
def check_login():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'logged_in': False, 'message': '未登录',
                        'session': session_manager.status()})
    ok = client.check_login()
    cfg = storage.get_config()
    if ok:
        session_manager.persist()
    else:
        session_manager.note_failure(client)
    return jsonify({'code': 0 if ok else -1, 'logged_in': ok, 'config': cfg,
                    'session': session_manager.status()})


@api.route('/api/cookies/clear', methods=['POST'])
def clear_cookies():
    storage.save_cookie_jar([])
    storage.save_config({})
    session_manager.invalidate()
    return jsonify({'code': 0, 'message': '已清除'})


# ==================== 会话自动续期 ====================

@api.route('/api/session/status')
def session_status():
    return jsonify({'code': 0, **session_manager.status()})


@api.route('/api/session/renew', methods=['POST'])
def session_renew():
    ok = session_manager.renew()
    st = session_manager.status()
    return jsonify({'code': 0 if ok else -1,
                    'message': '续期成功' if ok else (st.get('last_error') or '续期失败'),
                    **st})


# ==================== 内置浏览器 ====================

@api.route('/api/browser/status')
def browser_status():
    return jsonify({'code': 0, **session_manager.status()})


@api.route('/api/browser/open', methods=['POST'])
def browser_open():
    """打开可见的登录窗口（首次需在此登录，之后由浏览器自动维持登录态）"""
    ok, msg = session_manager.open_browser_login()
    return jsonify({'code': 0 if ok else -1,
                    'message': msg or ('已打开登录窗口，请完成登录' if ok else '打开失败'),
                    **session_manager.status()})


@api.route('/api/browser/close', methods=['POST'])
def browser_close():
    session_manager.close_browser()
    return jsonify({'code': 0, 'message': '已关闭内置浏览器', **session_manager.status()})


@api.route('/api/browser/refresh', methods=['POST'])
def browser_refresh():
    """让浏览器重新走一遍免密登录，换出新会话"""
    ok, msg = session_manager.browser_refresh()
    return jsonify({'code': 0 if ok else -1, 'message': msg, **session_manager.status()})


@api.route('/api/browser/settings', methods=['POST'])
def browser_settings():
    """登录成功后是否自动关闭浏览器窗口（省资源）"""
    data = request.json or {}
    if 'auto_close_browser' in data:
        settings = storage.get_settings()
        settings['auto_close_browser'] = bool(data['auto_close_browser'])
        storage.save_settings(settings)
    return jsonify({'code': 0, **session_manager.status()})


# ==================== 配置与下拉 ====================

@api.route('/api/combo/<guid>')
def get_combo(guid):
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录'})
    return jsonify({'code': 0, 'data': client.load_combo(guid)})


@api.route('/api/wallet')
def get_wallet():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录'})
    return jsonify(client.get_xfqb())


@api.route('/api/config')
def get_config():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录'})
    result = client.load_config()
    if result.get('code', -1) >= 0:
        storage.save_config(result['data'])
    return jsonify(result)


# ==================== 课程查询 ====================

@api.route('/api/courses/query', methods=['POST'])
def query_courses():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录', 'rows': []})

    data = request.json or {}
    pools = data.get('pools', [])
    if not pools:
        pools = [storage.get_xklxdm()]

    params = {}
    for key in ['xqdm', 'kkyxdm', 'nd', 'zydm', 'kcdldm', 'xq', 'jc', 'kcxx', 'kcfl', 'hasme']:
        val = data.get(key)
        if val or val == 0:
            params[key] = val

    all_rows = []
    seen = set()
    PAGE_ROWS = 60
    for xklxdm in pools:
        page = 1
        while True:
            result = client.query_hzkc(params=params, page=page, rows=PAGE_ROWS, xklxdm=xklxdm)
            rows = result.get('rows', [])
            if not rows:
                break
            for row in rows:
                row['_xklxdm'] = xklxdm
                kcbh = row.get('kcbh', '')
                if kcbh and kcbh in seen:
                    continue
                if kcbh:
                    seen.add(kcbh)
                all_rows.append(row)
            if len(rows) < PAGE_ROWS:
                break
            page += 1

    return jsonify({'code': 0, 'rows': all_rows, 'total': len(all_rows)})


@api.route('/api/courses/query_detail', methods=['POST'])
@api.route('/api/courses/available', methods=['POST'])
def get_available():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录', 'rows': []})

    data = request.json or {}
    kcptdm = data.get('kcptdm', '')
    xklxdm = data.get('xklxdm') or storage.get_xklxdm()
    extra = {}
    for key in ['xqdm', 'hasme']:
        val = data.get(key)
        if val is not None:
            extra[key] = val

    all_rows = []
    page = 1
    PAGE_ROWS = 50
    while True:
        result = client.query_kxkc(kcptdm=kcptdm, page=page, rows=PAGE_ROWS, extra_params=extra, xklxdm=xklxdm)
        rows = result.get('rows', [])
        if not rows:
            break
        for row in rows:
            row['_xklxdm'] = xklxdm
            all_rows.append(row)
        if len(rows) < PAGE_ROWS:
            break
        page += 1

    return jsonify({'code': result.get('code', 0), 'rows': all_rows, 'total': len(all_rows)})


@api.route('/api/courses/selected')
def get_selected():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录', 'rows': []})

    all_rows = []
    seen = set()
    PAGE_ROWS = 50
    for xklxdm in ['02', '06', '07', '08']:
        page = 1
        while True:
            result = client.query_yxkc(page=page, rows=PAGE_ROWS, xklxdm=xklxdm)
            rows = result.get('rows', [])
            if not rows:
                break
            for row in rows:
                kcrwdm = row.get('kcrwdm', '')
                if kcrwdm and kcrwdm in seen:
                    continue
                if kcrwdm:
                    seen.add(kcrwdm)
                row['_xklxdm'] = xklxdm
                all_rows.append(row)
            if len(rows) < PAGE_ROWS:
                break
            page += 1

    return jsonify({'code': 0, 'rows': all_rows, 'total': len(all_rows)})


# ==================== 选课 / 退选 ====================

@api.route('/api/courses/add', methods=['POST'])
def add_course():
    data = request.json or {}
    xklxdm = data.get('xklxdm') or storage.get_xklxdm()
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录'})

    kcrwdm = data.get('kcrwdm', '')
    kcmc = data.get('kcmc', '')
    qz = data.get('qz', -1)

    if not kcrwdm:
        return jsonify({'code': -1, 'message': '缺少课程任务码'})

    result = client.add_course(kcrwdm, kcmc, qz, xklxdm=xklxdm)

    # 冲突确认
    if result.get('code') == -2 and data.get('confirm'):
        result = client.add_course(kcrwdm, kcmc, qz, hlct=1, xklxdm=xklxdm)

    return jsonify(result)


@api.route('/api/courses/cancel', methods=['POST'])
def cancel_course():
    data = request.json or {}
    xklxdm = data.get('xklxdm') or storage.get_xklxdm()
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录'})

    result = client.cancel_course(
        data.get('kcrwdm', ''),
        data.get('jxbdm', ''),
        data.get('kcmc', ''),
        xklxdm=xklxdm,
    )
    return jsonify(result)


# ==================== 抢课列表持久化 ====================

@api.route('/api/grab_list', methods=['GET'])
def get_grab_list():
    return jsonify({'code': 0, 'data': storage.get_grab_list()})


@api.route('/api/grab_list', methods=['POST'])
def save_grab_list():
    data = request.json or {}
    items = data.get('items', [])
    # 清理：只保留必要字段
    cleaned = []
    for item in items:
        cleaned.append({
            'kcrwdm': item.get('kcrwdm', ''),
            'kcmc': item.get('kcmc', ''),
            'jxbmc': item.get('jxbmc', ''),
            'teaxms': item.get('teaxms', ''),
            'pkrs': item.get('pkrs', 0),
            'jxbrs': item.get('jxbrs', 0),
            'xqjc': item.get('xqjc', ''),
            'xklxdm': item.get('xklxdm', ''),
            'kcptdm': item.get('kcptdm', ''),
            'autoReplace': item.get('autoReplace', False),
        })
    storage.save_grab_list(cleaned)
    return jsonify({'code': 0, 'message': f'已保存 {len(cleaned)} 门课程'})
