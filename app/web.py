"""Flask 路由 — API 代理 + 持久化"""
import time
from flask import Blueprint, render_template, request, jsonify

from .client import CourseClient, BASE_URL
from . import storage

api = Blueprint('api', __name__)


def _make_client(xklxdm=None):
    """从持久化存储中加载 cookies 创建客户端"""
    cookies = storage.get_cookies()
    if not cookies:
        return None
    return CourseClient(cookies, xklxdm=xklxdm or storage.get_xklxdm())


# ==================== 页面 ====================

@api.route('/')
def index():
    return render_template('index.html')


# ==================== Cookie ====================

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
            cookie_dict[k] = v

    if not cookie_dict:
        return jsonify({'code': -1, 'message': '未解析到有效的 Cookie'})

    # 获取选课类型代码
    xklxdm = data.get('xklxdm', '') or storage.get_xklxdm() or '08'

    # 验证
    client = CourseClient(cookie_dict, xklxdm=xklxdm)
    result = client.load_config()

    if result.get('code', -1) >= 0:
        storage.save_cookies(cookie_dict)
        storage.save_config(result.get('data', {}))
        storage.save_xklxdm(xklxdm)
        return jsonify({'code': 0, 'message': '验证通过', 'data': result['data']})
    else:
        return jsonify({'code': -1, 'message': result.get('message', '验证失败')})


@api.route('/api/cookies/check')
def check_login():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'logged_in': False, 'message': '未登录'})
    ok = client.check_login()
    cfg = storage.get_config()
    return jsonify({'code': 0 if ok else -1, 'logged_in': ok, 'config': cfg})


@api.route('/api/cookies/clear', methods=['POST'])
def clear_cookies():
    storage.save_cookies({})
    return jsonify({'code': 0, 'message': '已清除'})


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
    for key in ['xqdm', 'hasme', 'page', 'rows']:
        val = data.get(key)
        if val is not None:
            extra[key] = val

    result = client.query_kxkc(kcptdm=kcptdm, extra_params=extra, xklxdm=xklxdm)
    for row in result.get('rows', []):
        row['_xklxdm'] = xklxdm
    return jsonify(result)


@api.route('/api/courses/selected')
def get_selected():
    client = _make_client()
    if not client:
        return jsonify({'code': -1, 'message': '未登录', 'rows': []})
    return jsonify(client.query_yxkc())


# ==================== 选课 / 退选 ====================

@api.route('/api/courses/add', methods=['POST'])
def add_course():
    data = request.json or {}
    xklxdm = data.get('xklxdm') or storage.get_xklxdm()
    client = _make_client(xklxdm=xklxdm)
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
    client = _make_client(xklxdm=xklxdm)
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
        })
    storage.save_grab_list(cleaned)
    return jsonify({'code': 0, 'message': f'已保存 {len(cleaned)} 门课程'})
