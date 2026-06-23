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

from flask import Flask
from app.web import api

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


def create_app():
    template_dir = os.path.join(_BASE, 'app', 'templates')
    static_dir = os.path.join(_BASE, 'app', 'static')
    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir, static_url_path='/static')
    app.secret_key = 'nenu-course-grabber-secret'
    app.register_blueprint(api)
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


if __name__ == '__main__':
    app = create_app()
    port = find_free_port(5000)
    if port is None:
        print("错误: 无法找到可用端口")
        sys.exit(1)
    print("=" * 50)
    print("NENU 抢课系统")
    print("=" * 50)
    print(f"\n  地址: http://127.0.0.1:{port}")
    print("\n使用说明:")
    print("  1. 登录 https://bkjx.nenu.edu.cn 并选课成功进入选课页面")
    print("  2. F12 → Network → 刷新页面 → 找 config 请求")
    print("  3. 点 config → Headers → Request Headers → Cookie 行右键 Copy value")
    print("  4. 粘贴 Cookie → 选择课程池查询 → 加入抢课列表 → 启动")
    print("=" * 50)
    app.run(host='127.0.0.1', port=port, debug=True, use_reloader=False)
