# NENU 抢课系统

东北师范大学选课辅助系统，提供图形化界面查询课程、管理抢课列表并自动轮询选课。

## 使用教程

[哔哩哔哩视频教程](https://www.bilibili.com/video/BV1Lhj86HEev)

## 功能

- **Cookie 登录** — 粘贴教务处 Cookie 即可登录，无需账号密码
- **多课程池查询** — 同时查询本部公共/专业、净月公共/专业 4 个课程池，支持多选合并、自动去重
- **多维筛选** — 按开课单位、课程大类、年级、专业、星期、节次范围、关键词、仅看有余量等条件过滤
- **课程详情** — 查看每门课程的所有教学班及实时名额，全量分页加载
- **自动轮询抢课** — 将目标课程加入列表后自动循环选课，支持冲突确认、登录过期检测
- **跳过时间冲突** — 全局开关，开启后跳过冲突课程继续抢其他的；关闭后无视冲突持续重试，蹲正选开放瞬间必备
- **自动替换冲突课程**（每门课独立开关） — 自动从 API 错误信息解析冲突课程名，精准定位并退掉冲突课再选入目标课，不误伤其他已选课程
- **可调频率** — 自定义选课间隔（同轮内每门课之间）和轮次间隔
- **已选课程** — 跨所有课程池查看已选课程，支持退选
- **端口自动切换** — 启动时若 5000 被占用自动递增查找可用端口
- **持久化存储** — Cookie、抢课列表、频率设置本地保存，重启不丢失

## 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 启动

```bash
python main.py
```

启动后访问终端提示的地址（默认 http://127.0.0.1:5000，端口被占用会自动切换）

### 获取 Cookie

1. 浏览器打开 [选课系统](https://bkjx.nenu.edu.cn/xsxk.html?xklxdm=08) 并登录成功
2. F12 → Network（网络）标签
3. 按 Ctrl+R 刷新页面，在请求列表中找到 `config` 请求
4. 点击 `config` → Headers（请求头）
5. 找到 Request Headers 里的 `Cookie:` 行，右键 → Copy value
6. 粘贴到本系统 Cookie 设置页，点击验证

### 使用

- **Cookie 设置页** — 粘贴并验证 Cookie，查看选课配置与学分信息
- **课程查询页** — 勾选课程池 → 设置筛选条件 → 查询。点击课程行展开查看教学班，勾选或一键加入抢课列表
- **自动抢课页** — 管理抢课列表，启动自动轮询。可调选课间隔和轮次间隔。全局"跳过时间冲突"开关配合每门课独立"自动替换"开关灵活控制冲突处理策略
- **已选课程页** — 查看已选课程，支持退选

## 项目结构

```
nenu-course-assistant/
├── main.py              # 应用入口
├── requirements.txt     # 依赖
├── app/
│   ├── client.py        # 教务处 API 客户端
│   ├── storage.py       # JSON 持久化存储
│   ├── web.py           # Flask 路由
│   ├── static/
│   │   └── app.js       # 前端逻辑
│   └── templates/
│       └── index.html   # 单页前端 (HTML + CSS)
└── data/
    └── storage.json     # 本地持久化数据（含 Cookie，已 gitignore）
```

## 打包 exe

```bash
pip install pyinstaller
pyinstaller --onefile --add-data "app/templates;app/templates" --add-data "app/static;app/static" --name "NENU抢课系统" main.py
```

生成的 exe 位于 `dist/NENU抢课系统.exe`，可直接运行，持久化数据保存在 exe 同目录的 `data/` 文件夹。

## 注意事项

- Cookie 含登录态，请勿泄露
- 需在校园网或 VPN 环境下访问教务处
- 登录过期后抢课自动停止并提示
- **蹲正选**：预选结束→正选开放前关闭"跳过时间冲突"开关，系统会无视冲突持续尝试，正选一开放即可抢入
