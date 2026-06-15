#!/usr/bin/env python3
"""NENU 抢课系统 — 入口"""
import os
import sys
import logging

# 确保能正确 import app 包
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask
from app.web import api

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')


def create_app():
    template_dir = os.path.join(os.path.dirname(__file__), 'app', 'templates')
    app = Flask(__name__, template_folder=template_dir)
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
    print("  1. 登录 https://bkjx.nenu.edu.cn")
    print("  2. F12 → Application → Cookies → bkjx.nenu.edu.cn")
    print("  3. 全选 Cookie 右键复制 → 粘贴到本系统")
    print("  4. 选择校区查询课程 → 加入抢课列表 → 启动")
    print("=" * 50)
    app.run(host='127.0.0.1', port=5000, debug=True)
