#!/usr/bin/env python3
"""NENU 抢课系统 — 入口"""
import os
import sys
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


if __name__ == '__main__':
    app = create_app()
    print("=" * 50)
    print("NENU 抢课系统")
    print("=" * 50)
    print("\n  地址: http://127.0.0.1:5000")
    print("\n使用说明:")
    print("  1. 登录 https://bkjx.nenu.edu.cn 并选课成功进入选课页面")
    print("  2. F12 → Network → 刷新页面 → 找 config 请求")
    print("  3. 点 config → Headers → Request Headers → Cookie 行右键 Copy value")
    print("  4. 粘贴 Cookie → 选择课程池查询 → 加入抢课列表 → 启动")
    print("=" * 50)
    app.run(host='127.0.0.1', port=5000, debug=True)
