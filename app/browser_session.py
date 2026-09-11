"""内置浏览器会话：借真实浏览器持有并刷新登录态

认证中心的长期票根（CASTGC）是 HttpOnly Cookie，脚本无法自行获取，
业务会话又轮换频繁——手动复制因此不可靠。这里让一个真实浏览器常驻
持有登录态，主程序随时从它那里取用最新会话。

优先使用系统已装的 Edge / Chrome，无需下载浏览器内核。

Playwright 对象不能跨线程使用，故浏览器运行在专用线程中，
主线程通过命令队列与之通信。
"""
import logging
import os
import queue
import threading
import time

logger = logging.getLogger(__name__)

PROFILE_DIR_NAME = 'browser-profile'
START_URL = 'https://bkjx.nenu.edu.cn/'
POLL_INTERVAL = 2.0
OPEN_TIMEOUT = 120          # 等待浏览器首次就绪
CMD_TIMEOUT = 45            # 单条命令等待上限
MIN_PROBE_GAP = 5           # 两次网络校验的最小间隔，避免频繁打接口
BROWSER_CHANNELS = ('msedge', 'chrome', None)
VIEWPORT = {'width': 1280, 'height': 860}

_cmd_queue = queue.Queue()
_lock = threading.RLock()
_worker = None
_login_handler = None

_state = {
    'open': False,
    'headless': True,
    'logged_in': False,
    'message': '',
    'opened_at': 0,
    'last_ok_at': 0,
    'channel': '',
}


# ---------- 环境 ----------

def available():
    """Playwright 是否可用"""
    return not unavailable_reason()


def unavailable_reason():
    """内置浏览器不可用的原因；可用时返回空字符串"""
    try:
        import playwright  # noqa: F401
    except ImportError:
        return ('未安装 Playwright，无法使用内置浏览器。'
                '安装：pip install "playwright>=1.40,<2.0"')

    import inspect
    import os as _os
    try:
        import playwright as _pw
        driver = _os.path.join(_os.path.dirname(inspect.getfile(_pw)), 'driver')
    except Exception as e:  # noqa: BLE001
        return f'Playwright 安装异常：{e}'

    node = _os.path.join(driver, 'node.exe' if _os.name == 'nt' else 'node')
    cli = _os.path.join(driver, 'package', 'cli.js')
    if not _os.path.isfile(node) or not _os.path.isfile(cli):
        return ('Playwright 驱动不完整（缺少 node 运行时）。'
                '若使用 MSYS2/MinGW 版 Python，请改装 python.org 版 Python')
    return ''


def profile_dir():
    from . import storage
    path = os.path.join(storage.DATA_DIR, PROFILE_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def set_login_handler(fn):
    """注册登录成功回调（由会话管理器注入，避免模块循环依赖）"""
    global _login_handler
    _login_handler = fn


def _adopt(jar):
    """把浏览器里的会话交给会话管理器接管"""
    if not _login_handler:
        return
    try:
        _login_handler(jar)
    except Exception as e:
        logger.warning('会话接管回调异常: %s', e)


def _jar_key(jar):
    """Cookie 指纹，用于判断会话是否变化"""
    return tuple(sorted((c['name'], c['domain'], c['value']) for c in jar))


# ---------- Cookie 提取与校验 ----------

def _harvest(ctx):
    """从浏览器上下文导出学校域下的全部 Cookie（含 HttpOnly）"""
    jar = []
    try:
        cookies = ctx.cookies()
    except Exception as e:
        logger.warning('读取浏览器 Cookie 失败: %s', e)
        return jar
    for c in cookies:
        domain = c.get('domain') or ''
        if 'nenu.edu.cn' not in domain:
            continue
        expires = c.get('expires')
        jar.append({
            'name': c.get('name'),
            'value': c.get('value'),
            'domain': domain,
            'path': c.get('path') or '/',
            'expires': expires if expires and expires > 0 else None,
        })
    return jar


def _probe(jar):
    """用导出的 Cookie 试一次业务接口，判断登录是否可用"""
    if not jar:
        return False
    from . import storage
    from .client import CourseClient
    try:
        client = CourseClient(cookie_jar=jar, xklxdm=storage.get_xklxdm() or '08')
        return client._verify_login()
    except Exception as e:
        logger.warning('校验浏览器会话失败: %s', e)
        return False


# ---------- 浏览器线程 ----------

class _BrowserWorker(threading.Thread):
    def __init__(self, headless=True):
        super().__init__(name='browser-session', daemon=True)
        self.headless = headless
        self._ctx = None
        self._ready = threading.Event()
        self._error = ''
        self._was_ok = False
        self._last_key = None
        self._last_probe = 0.0

    # -- 生命周期 --

    def run(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as e:
            self._error = f'未安装 Playwright，无法使用内置浏览器（{e}）'
            self._ready.set()
            return

        try:
            with sync_playwright() as p:
                self._launch(p)
                self._ready.set()
                with _lock:
                    _state['open'] = True
                    _state['headless'] = self.headless
                    _state['message'] = ''
                self._loop()
        except Exception as e:
            self._error = str(e)
            logger.warning('内置浏览器异常退出: %s', e)
        finally:
            self._ready.set()
            with _lock:
                _state['open'] = False
                _state['logged_in'] = False

    def _launch(self, p):
        profile = profile_dir()
        last_err = None
        for channel in BROWSER_CHANNELS:
            kwargs = {
                'user_data_dir': profile,
                'headless': self.headless,
                'args': ['--no-first-run', '--no-default-browser-check'],
            }
            if self.headless:
                kwargs['viewport'] = VIEWPORT
            if channel:
                kwargs['channel'] = channel
            try:
                self._ctx = p.chromium.launch_persistent_context(**kwargs)
                with _lock:
                    _state['channel'] = channel or 'bundled'
                logger.info('内置浏览器已启动（%s，%s）',
                            channel or 'bundled', '后台' if self.headless else '可见窗口')
                break
            except Exception as e:
                last_err = e
                logger.info('启动 %s 失败，尝试下一个', channel or 'bundled')
        if self._ctx is None:
            raise RuntimeError(
                f'无法启动浏览器，请确认已安装 Edge 或 Chrome（{last_err}）')

        page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
        try:
            page.goto(START_URL, wait_until='domcontentloaded', timeout=60000)
        except Exception as e:
            logger.warning('打开选课系统页面失败: %s', e)

    def _close(self):
        if self._ctx is not None:
            try:
                self._ctx.close()
            except Exception as e:
                logger.warning('关闭浏览器失败: %s', e)
            self._ctx = None

    def _loop(self):
        last_poll = 0.0
        while True:
            try:
                cmd, reply = _cmd_queue.get(timeout=0.2)
            except queue.Empty:
                cmd = None
            if cmd == 'close':
                self._close()
                reply.put(('closed', None))
                return
            if cmd == 'harvest':
                reply.put(('ok', _harvest(self._ctx)))
                continue
            if cmd == 'refresh':
                # 整段结果作为载荷返回，交由调用方判断成功与否
                reply.put(('refresh', self._refresh()))
                continue

            now = time.time()
            if now - last_poll >= POLL_INTERVAL:
                last_poll = now
                try:
                    self._poll()
                except Exception as e:
                    logger.warning('浏览器会话轮询异常: %s', e)

    def _poll(self):
        """轮询浏览器会话：本地读 Cookie 很便宜，网络校验则按需节流"""
        jar = _harvest(self._ctx)
        key = _jar_key(jar)
        now = time.time()
        changed = key != self._last_key
        interval = 120 if self._was_ok else 15
        if not changed or now - self._last_probe < MIN_PROBE_GAP:
            if now - self._last_probe < interval:
                return
        self._last_key = key
        self._last_probe = now

        ok = _probe(jar)
        with _lock:
            _state['logged_in'] = ok
            if ok:
                _state['last_ok_at'] = now
        if ok:
            if not self._was_ok or changed:
                _adopt(jar)
            self._was_ok = True
        else:
            self._was_ok = False

    def _refresh(self):
        """让浏览器重新走一遍选课系统入口（CAS 免密），换出新会话后导出"""
        if self._ctx is None:
            return ('error', '浏览器未运行')
        try:
            page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
            page.goto(START_URL, wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(1200)
        except Exception as e:
            logger.warning('浏览器刷新页面失败: %s', e)
            return ('error', str(e))
        jar = _harvest(self._ctx)
        ok = _probe(jar)
        with _lock:
            _state['logged_in'] = ok
            if ok:
                _state['last_ok_at'] = time.time()
        self._was_ok = ok
        if ok:
            self._last_key = _jar_key(jar)
            self._last_probe = time.time()
            _adopt(jar)
        return ('ok', jar) if ok else ('fail', jar)


# ---------- 对外接口 ----------

def status():
    with _lock:
        st = dict(_state)
    worker = _worker
    reason = unavailable_reason()
    st['available'] = not reason
    st['reason'] = reason
    st['running'] = bool(worker and worker.is_alive())
    return st


def _wait_ready(worker, timeout):
    if not worker._ready.wait(timeout):
        return False, '浏览器启动超时'
    if worker._error:
        return False, worker._error
    return True, ''


def start(headless=True, timeout=OPEN_TIMEOUT):
    """启动内置浏览器（幂等）。headless=True 时后台静默运行"""
    global _worker
    reason = unavailable_reason()
    if reason:
        return False, reason
    with _lock:
        if _worker and _worker.is_alive():
            if _worker.headless == headless:
                return True, ''
            _stop_locked()
        _worker = _BrowserWorker(headless=headless)
        worker = _worker
    worker.start()
    ok, msg = _wait_ready(worker, timeout)
    if not ok:
        with _lock:
            if _worker is worker:
                _worker = None
    return ok, msg


def open_login(timeout=OPEN_TIMEOUT):
    """打开可见的登录窗口（已开启则复用）"""
    ok, msg = start(headless=False, timeout=timeout)
    if not ok:
        return False, msg
    return True, '请在弹出的浏览器窗口中完成登录（勾选「7天免登录」）'


def harvest(timeout=CMD_TIMEOUT):
    return _send('harvest', timeout)


def refresh(timeout=CMD_TIMEOUT):
    """让浏览器重建会话，返回 (是否成功, Cookie 列表或错误信息)；无响应返回 (None, None)"""
    result = _send('refresh', timeout)
    if not isinstance(result, tuple) or len(result) != 2:
        return None, None
    return result


def _send(cmd, timeout):
    worker = _worker
    if not worker or not worker.is_alive():
        return None
    reply = queue.Queue()
    _cmd_queue.put((cmd, reply))
    try:
        _, payload = reply.get(timeout=timeout)
    except queue.Empty:
        logger.warning('浏览器命令 %s 超时', cmd)
        return None
    return payload


def _stop_locked():
    global _worker
    worker = _worker
    if not worker or not worker.is_alive():
        _worker = None
        return
    reply = queue.Queue()
    _cmd_queue.put(('close', reply))
    try:
        reply.get(timeout=10)
    except queue.Empty:
        logger.warning('关闭浏览器超时')
    _worker = None


def close():
    with _lock:
        _stop_locked()
    with _lock:
        _state['open'] = False
        _state['logged_in'] = False
