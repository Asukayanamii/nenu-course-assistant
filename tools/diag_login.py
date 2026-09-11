#!/usr/bin/env python3
"""Cookie 与登录票根诊断脚本（开发排障用，不参与打包）

用法（需在校园网或 VPN 环境下执行）:
    python tools/diag_login.py

依次打印:
    1. 本地保存的 Cookie 域名分布与票根情况
    2. 认证中心换票链路（是否凭票根换到 service ticket）
    3. 选课系统会话建立情况
    4. config 接口调用结果
    5. 主动续期测试
"""
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests

from app import storage
from app.client import (
    CourseClient, BASE_URL, AUTHSERVER_URL, SSO_SERVICE, TICKET_COOKIE_NAMES,
)

LINE = '=' * 64


def show_cookies():
    print(LINE)
    print('1. 本地会话 Cookie')
    print(LINE)
    jar = storage.get_cookie_jar()
    if not jar:
        print('  未保存任何 Cookie，请先在网页里粘贴')
        return None

    for c in jar:
        value = c.get('value') or ''
        preview = value[:12] + '...' if len(value) > 12 else value
        mark = '  <== 登录票根' if c.get('name') in TICKET_COOKIE_NAMES else ''
        print('  %-32s domain=%-24s %s%s' % (c.get('name'), c.get('domain'), preview, mark))

    client = CourseClient(cookie_jar=jar, xklxdm=storage.get_xklxdm() or '08')
    print()
    print('  票根状态:', '已就绪，可自动续期' if client.has_ticket() else '缺失，无法自动续期')
    return client


def show_chain(session, url, title):
    print()
    print(LINE)
    print(title)
    print(LINE)
    hops = 0
    while hops < 8:
        try:
            resp = session.get(url, timeout=20, allow_redirects=False)
        except requests.RequestException as e:
            print('  请求失败:', e)
            return None
        print('  [%s] %s' % (resp.status_code, resp.url[:120]))
        if not resp.is_redirect:
            break
        location = resp.headers.get('Location', '')
        print('        -> %s' % location[:120])
        url = location
        hops += 1

    if 'ticket=' in (url or ''):
        print('  已换到 service ticket：票根有效，可静默续期')
    return resp


def main():
    client = show_cookies()
    if not client:
        return 1

    service = quote(SSO_SERVICE, safe='')
    show_chain(client.session, f'{AUTHSERVER_URL}/authserver/login?service={service}',
               '2. 认证中心换票链路（有效票根应 302 回 /new/ssoLogin?ticket=...）')

    print()
    print(LINE)
    print('3. 调用 config 接口')
    print(LINE)
    result = client.load_config()
    print('  code =', result.get('code'), '| message =', result.get('message', ''))
    if result.get('code', -1) >= 0:
        print('  登录态可用')
    else:
        print('  当前会话不可用：若换票成功，下次请求会自动续期')

    print()
    print(LINE)
    print('4. 主动续期测试')
    print(LINE)
    print('  renew_session ->', client.renew_session(force=True))

    print()
    print(LINE)
    print('5. 续期后的 Cookie（应出现新的 bkjx JSESSIONID）')
    print(LINE)
    for c in client.export_cookie_jar():
        value = c.get('value') or ''
        preview = value[:12] + '...' if len(value) > 12 else value
        print('  %-32s domain=%-24s %s' % (c.get('name'), c.get('domain'), preview))
    return 0


if __name__ == '__main__':
    sys.exit(main())
