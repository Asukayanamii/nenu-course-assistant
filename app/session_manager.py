"""共享会话管理：单例客户端、保活心跳、Cookie 自动落盘

两种会话来源：
  - browser：内置浏览器持有登录态（推荐），票根由浏览器维护，失效时刷新页面即可换新
  - manual ：手动粘贴 Cookie（降级方案），不含票根，只做最大程度保活，失效后需重新粘贴
"""
import logging
import threading
import time

from .client import CourseClient
from . import storage
from . import browser_session

logger = logging.getLogger(__name__)

# 保活间隔：有票根时可以放宽，纯粘贴会话要更勤快地续命
HEARTBEAT_INTERVAL_BROWSER = 8 * 60
HEARTBEAT_INTERVAL_TICKET = 5 * 60
HEARTBEAT_INTERVAL_MANUAL = 2 * 60
HEARTBEAT_TICK = 20              # 心跳线程检查步长
PERSIST_INTERVAL = 30            # Cookie 落盘节流（秒）
BROWSER_AUTO_CLOSE_DELAY = 8     # 取得票根后延迟关闭浏览器（秒），留出落盘余量

MODE_BROWSER = 'browser'
MODE_MANUAL = 'manual'

_lock = threading.RLock()
_persist_lock = threading.Lock()
_client = None
_saved_snapshot = None
_last_persist = 0
_heartbeat_started = False
_browser_close_pending = False
_stop_event = threading.Event()

_state = {
    'mode': '',
    'logged_in': False,
    'last_ok_at': 0,
    'last_renew_at': 0,
    'last_error': '',
}


# ---------- 客户端 ----------

def _attach(client):
    client.on_session_refresh = _on_renewed
    return client


def _build_client(xklxdm=None):
    jar = storage.get_cookie_jar()
    if not jar:
        return None
    return _attach(CourseClient(cookie_jar=jar, xklxdm=xklxdm or storage.get_xklxdm() or '08'))


def get_client(xklxdm=None):
    """获取共享客户端（单例），未保存 Cookie 时返回 None"""
    global _client
    with _lock:
        if _client is None:
            _client = _build_client(xklxdm)
        return _client


def adopt(client, mode=MODE_MANUAL, persist_now=True):
    """接管一个已验证的客户端"""
    global _client
    with _lock:
        _client = _attach(client)
        _state['mode'] = mode
        _state['logged_in'] = True
        _state['last_ok_at'] = time.time()
        _state['last_error'] = ''
    _save_mode(mode)
    if persist_now:
        persist(force=True)


def invalidate():
    global _client
    with _lock:
        _client = None
        _state['logged_in'] = False
        _state['last_error'] = ''


def _save_mode(mode):
    try:
        settings = storage.get_settings()
        if settings.get('session_mode') != mode:
            settings['session_mode'] = mode
            storage.save_settings(settings)
    except OSError as e:
        logger.warning('保存会话模式失败: %s', e)


def mode():
    with _lock:
        if _state['mode']:
            return _state['mode']
    return storage.get_settings().get('session_mode', '')


def status():
    client = get_client()
    with _lock:
        st = dict(_state)
    st['mode'] = mode()
    st['has_cookies'] = bool(storage.get_cookie_jar())
    st['tgt_present'] = client.has_ticket() if client else False
    st['renewed_at'] = client.renewed_at if client else 0
    st['auto_close_browser'] = storage.get_settings().get('auto_close_browser', True)
    st['browser'] = browser_session.status()
    return st


# ---------- 浏览器接管 ----------

def _on_browser_login(jar):
    """浏览器里登录成功后，把会话同步给主程序"""
    global _client
    if not jar:
        return
    with _lock:
        _client = _attach(CourseClient(cookie_jar=jar, xklxdm=storage.get_xklxdm() or '08'))
        _state['mode'] = MODE_BROWSER
        _state['logged_in'] = True
        _state['last_ok_at'] = time.time()
        _state['last_error'] = ''
    storage.save_cookie_jar(jar)
    _save_mode(MODE_BROWSER)
    _maybe_schedule_browser_close()


def _maybe_schedule_browser_close():
    """已取得长期票根时，可以关掉浏览器省资源——之后靠票根在请求层自动续期

    拿不到票根就绝不关闭，否则会失去自动续期的能力。
    """
    global _browser_close_pending
    if not storage.get_settings().get('auto_close_browser', True):
        return
    client = _client
    if client is None or not client.has_ticket():
        return
    with _lock:
        if _browser_close_pending:
            return
        _browser_close_pending = True
    threading.Timer(BROWSER_AUTO_CLOSE_DELAY, _auto_close_browser).start()


def _auto_close_browser():
    """在独立线程中关闭：回调本身跑在浏览器线程里，不能就地关闭（会自锁）"""
    global _browser_close_pending
    try:
        if not storage.get_settings().get('auto_close_browser', True):
            return
        if browser_session.status().get('running'):
            logger.info('已取得长期票根，自动关闭内置浏览器（后续由票根自动续期）')
            browser_session.close()
    except Exception as e:
        logger.warning('自动关闭浏览器失败: %s', e)
    finally:
        with _lock:
            _browser_close_pending = False


def start_browser(headless=True):
    """启动内置浏览器（幂等）。会话接管回调在此确保已注册，避免调用顺序影响"""
    browser_session.set_login_handler(_on_browser_login)
    return browser_session.start(headless=headless)


def open_browser_login():
    browser_session.set_login_handler(_on_browser_login)
    return browser_session.open_login()


def close_browser():
    browser_session.close()


def browser_refresh():
    """让浏览器重建会话；返回 (是否成功, 提示语)"""
    st = browser_session.status()
    if not st.get('running'):
        return False, '内置浏览器未运行，请先打开登录窗口'
    ok, payload = browser_session.refresh()
    if ok is None:
        return False, '浏览器无响应，请稍后重试'
    if ok:
        _mark_ok()
        return True, '会话已刷新'
    logger.warning('浏览器会话刷新失败: %s', payload)
    _mark_error('浏览器中的登录态已失效，请在登录窗口中重新登录')
    return False, '登录态已失效，请在登录窗口中重新登录'


# ---------- 续期 ----------

def _mark_ok():
    with _lock:
        _state['last_ok_at'] = time.time()
        _state['logged_in'] = True
        _state['last_error'] = ''


def _mark_error(msg):
    with _lock:
        _state['logged_in'] = False
        _state['last_error'] = msg


def _manual_expired_msg():
    return ('会话已失效（纯粘贴的 Cookie 无法自动续期）：'
            '请重新粘贴 Cookie，或改用「打开登录窗口」以避免反复失效')


def _ticket_expired_msg():
    return ('登录票根已过期，无法自动续期：'
            '请点击「打开登录窗口」重新登录一次（勾选「7天免登录」）')


def _on_renewed():
    with _lock:
        _state['last_renew_at'] = time.time()
        _state['logged_in'] = True
        _state['last_error'] = ''
    persist(force=True)


def renew():
    """手动触发续期：优先让浏览器换新会话，其次用票根"""
    client = get_client()
    if not client:
        return False
    if client.check_login():
        _mark_ok()
        return True
    if _refresh_from_browser():
        _mark_ok()
        return True
    if client.renew_session(force=True):
        _mark_ok()
        return True
    _mark_error(_manual_expired_msg() if not client.has_ticket() else _ticket_expired_msg())
    return False


def _refresh_from_browser():
    """让内置浏览器重新建立会话并接管；不可用时返回 False"""
    st = browser_session.status()
    if not st.get('running'):
        return False
    ok, _payload = browser_session.refresh()
    if ok:
        logger.info('已通过内置浏览器换新会话')
    return bool(ok)


def _keepalive_interval():
    client = _client
    has_ticket = client is not None and client.has_ticket()
    # 浏览器在跑就交给它的轮询，心跳可以放宽
    if mode() == MODE_BROWSER and browser_session.status().get('running'):
        return HEARTBEAT_INTERVAL_BROWSER
    if has_ticket:
        return HEARTBEAT_INTERVAL_TICKET
    return HEARTBEAT_INTERVAL_MANUAL


def ping():
    """保活心跳：轻量校验会话，失效则尝试续期，并落盘最新 Cookie"""
    client = get_client()
    if not client:
        return False

    result = client.load_config()
    if result.get('code', -1) >= 0:
        _mark_ok()
        persist()
        return True

    logger.info('保活检测到会话失效，尝试恢复')
    if _refresh_from_browser() or client.renew_session():
        _mark_ok()
        persist(force=True)
        return True

    _mark_error(_manual_expired_msg() if not client.has_ticket() else _ticket_expired_msg())
    persist()
    return False


# ---------- 持久化 ----------

def _snapshot(jar):
    return tuple(sorted((c['name'], c['domain'], c['value']) for c in jar))


def persist(force=False):
    """把当前会话 Cookie 落盘（节流，避免抢课期间高频写盘）"""
    global _saved_snapshot, _last_persist
    client = _client
    if client is None:
        return
    now = time.time()
    if not force and now - _last_persist < PERSIST_INTERVAL:
        return
    jar = client.export_cookie_jar()
    if not jar or not _persist_lock.acquire(blocking=False):
        return
    try:
        snapshot = _snapshot(jar)
        if not force and snapshot == _saved_snapshot:
            return
        storage.save_cookie_jar(jar)
        _saved_snapshot = snapshot
        _last_persist = now
    except OSError as e:
        logger.warning('Cookie 落盘失败: %s', e)
    finally:
        _persist_lock.release()


# ---------- 保活心跳 ----------

def start_heartbeat(tick=None):
    """启动保活心跳线程（幂等，重复调用不会起第二个线程）"""
    global _heartbeat_started
    with _lock:
        if _heartbeat_started:
            return
        _heartbeat_started = True

    browser_session.set_login_handler(_on_browser_login)

    settings = storage.get_settings()
    step = tick or int(settings.get('heartbeat_tick') or HEARTBEAT_TICK)
    threading.Thread(target=_heartbeat_loop, args=(step,),
                     name='session-heartbeat', daemon=True).start()
    logger.info('会话保活已启动（浏览器模式 %s 秒 / 纯粘贴模式 %s 秒）',
                HEARTBEAT_INTERVAL_BROWSER, HEARTBEAT_INTERVAL_MANUAL)


def _heartbeat_loop(step):
    last = 0.0
    while not _stop_event.wait(step):
        if not storage.get_settings().get('keepalive', True):
            continue
        now = time.time()
        if now - last < _keepalive_interval():
            continue
        last = now
        try:
            ping()
        except Exception as e:
            logger.warning('保活心跳异常: %s', e)
