# NENU 抢课系统

东北师范大学选课辅助系统，提供图形化界面查询课程、管理抢课列表并自动轮询选课。

## 功能

- **Cookie 登录验证** — 粘贴教务处 Cookie 即可登录，无需账号密码
- **课程查询** — 按校区、开课单位、课程大类、关键词筛选课程
- **课程详情查看** — 查看每门课程的可用课堂及实时名额
- **自动抢课** — 将目标课程加入抢课列表，系统自动轮询选课，支持冲突确认、登录过期检测
- **已选课程管理** — 查看已选课程并支持退选
- **持久化存储** — Cookie、抢课列表、选课配置本地保存，关闭后不丢失

## 技术栈

- **后端**: Python + Flask + requests
- **前端**: 原生 HTML + CSS + JavaScript (单页应用)
- **存储**: JSON 文件

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动

```bash
python main.py
```

启动后访问 http://127.0.0.1:5000

### 3. 获取 Cookie

#### 方法一：Application 面板（通用）

1. 浏览器打开 [选课系统](https://bkjx.nenu.edu.cn/xsxk.html?xklxdm=08) 并登录
2. F12 → Application (应用) → Cookies → bkjx.nenu.edu.cn
3. 右键全选 Cookie 并复制 (Name=Value 格式)
4. 粘贴到本系统页面，点击验证保存

#### 方法二：Edge 网络面板（从 config 请求头复制）

1. 打开 [选课系统](https://bkjx.nenu.edu.cn/xsxk.html?xklxdm=08) 并登录成功
2. F12 → 切换到 Network（网络）标签
3. 按 Ctrl+R 刷新页面，在请求列表中找到 `config` 这个请求
4. 点击 `config` → 右侧点 Headers（请求头）
5. 往下翻找到 Request Headers 里的 `Cookie:` 一行
6. 在 `Cookie:` 行上右键 → Copy value → 粘贴到本系统

### 4. 使用

- **Cookie 设置页**: 粘贴 Cookie、验证登录，查看选课配置与学分信息
- **课程查询页**: 选择校区、筛选条件，查询课程并查看课堂详情
- **自动抢课页**: 管理抢课列表，启动自动轮询选课
- **已选课程页**: 查看已选上的课程，支持退选

## 项目结构

```
nenu-course-assistant/
├── main.py              # 应用入口，Flask 应用工厂
├── requirements.txt     # 依赖
├── app/
│   ├── __init__.py
│   ├── client.py        # 教务处 API 客户端 (CourseClient)
│   ├── storage.py       # JSON 文件持久化存储
│   ├── web.py           # Flask 路由 (API 代理 + 页面)
│   └── templates/
│       └── index.html   # 单页前端
└── data/
    └── storage.json     # 本地持久化数据 (含 Cookie, 勿提交)
```

## 打包为独立 exe

在已安装 Python 的机器上执行：

```bash
pip install pyinstaller
pyinstaller --onefile --add-data "app/templates;app/templates" --name "NENU抢课系统" main.py
```

生成的 exe 位于 `dist/NENU抢课系统.exe`（约 18MB），可直接复制到任意 Windows 电脑运行，无需安装 Python。持久化数据（Cookie、抢课列表）会保存在 exe 同目录下的 `data/` 文件夹中。

## 注意事项

- Cookie 包含登录态，`data/storage.json` 已加入 `.gitignore`，切勿提交
- 抢课频率已内置合理间隔，请合理使用
- 如登录过期，抢课会自动停止并提示
