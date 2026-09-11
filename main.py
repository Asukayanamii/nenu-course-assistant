#!/usr/bin/env python3
"""NENU 抢课系统 — 入口"""
import os
import sys
import socket
import logging

if getattr(sys, 'frozen', False):
    _BASE = sys._MEIPASS
else:
    _BASE = os.path.abspath(os.path.dirname(__file__))
# 确保能正确 import app 包
sys.path.insert(0, _BASE)

import threading

from flask import Flask
from app.web import api
from app import session_manager, storage

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


def _resume_browser():
    """上次用的是内置浏览器登录，则在后台静默恢复，登录态自动续上"""
    try:
        if storage.get_settings().get('session_mode') != session_manager.MODE_BROWSER:
            return
        ok, msg = session_manager.start_browser(headless=True)
        if ok:
            logging.getLogger(__name__).info('已恢复内置浏览器登录态')
        else:
            logging.getLogger(__name__).warning('恢复内置浏览器失败: %s', msg)
    except Exception as e:
        logging.getLogger(__name__).warning('恢复内置浏览器异常: %s', e)


def create_app():
    template_dir = os.path.join(_BASE, 'app', 'templates')
    static_dir = os.path.join(_BASE, 'app', 'static')
    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir, static_url_path='/static')
    app.secret_key = 'nenu-course-grabber-secret'
    app.register_blueprint(api)
    session_manager.start_heartbeat()
    threading.Thread(target=_resume_browser, name='browser-resume', daemon=True).start()
    return app


def find_free_port(start=5000):
    """从 start 起递增查找可用端口"""
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return None


APP_VERSION = 'v2.2.0'


if __name__ == '__main__':
    app = create_app()
    port = find_free_port(5000)
    if port is None:
        print("错误: 无法找到可用端口")
        sys.exit(1)
    print("=" * 50)
    print(f"NENU 抢课系统 {APP_VERSION}")
    print("=" * 50)
    print(f"\n  地址: http://127.0.0.1:{port}")
    print("\n使用说明:")
    print("  推荐：点击网页上的「打开登录窗口」，在弹出的浏览器里登录一次")
    print("        （勾选「7天免登录」）——之后登录态由该窗口自动维持，无需再复制 Cookie")
    print("  备选：手动粘贴 Cookie（仅尽力保活，失效后需重新粘贴）")
    print("=" * 50)
    app.run(host='127.0.0.1', port=port, debug=True, use_reloader=False)
