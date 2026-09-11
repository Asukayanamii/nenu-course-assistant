# Cookie 与会话架构

本文档记录本系统与学校教务系统之间**登录态维持机制**的完整设计，
包括实测得出的 Cookie 语义、续期链路、模块职责，以及若干**容易踩错的关键约束**。

> 文中的结论均来自对 `bkjx.nenu.edu.cn` / `authserver.nenu.edu.cn` 的实测，
> 而非推测。学校系统若升级，相关判据可能需要重新验证（见 [排障](#排障)）。

---

## 1. 系统背景

| 项目 | 情况 |
|------|------|
| 认证体系 | 金智（Wisedu）定制的 Apereo CAS 单点登录 |
| 业务系统 | 教学服务系统 `https://bkjx.nenu.edu.cn` |
| 认证中心 | `https://authserver.nenu.edu.cn` |
| 业务会话寿命 | `JSESSIONID` 数小时即失效 |
| 长期凭据 | CAS 票根 `CASTGC`（HttpOnly，服务器下发） |
| 多因子风控 | 启用，非可信浏览器需额外校验；**浏览器指纹 Cookie 可让风控放行** |
| 并发会话 | **单会话限制**：同账号新登录会顶掉旧会话 |

### 单会话限制的实际表现

用旧会话请求时，服务器会直接返回：

```
对不起，您的帐号[学号]已在此处登录，您已被迫退出。
```

这意味着「在手机或别的浏览器登录一次」就会把本工具的会话顶掉——
这是「会话莫名失效」最常见的原因，也是自动续期能力的核心价值所在。

---

## 2. Cookie 清单与角色

学校系统里出现的 Cookie 名字带有很强的误导性，务必按下表理解：

| Cookie | 域 | 角色 | 可否复用 |
|--------|----|------|----------|
| **`CASTGC`** | `authserver` | **CAS 票根（TGT）**，形如 `TGT-33761-xxxx...-main` | ✅ **可反复换新会话，这是唯一的长期凭据** |
| `MOD_AUTH_CAS` | `authserver` | 服务票据（ST），形如 `MOD_AUTH_ST-121417-xxxx` | ❌ **一次性**，用过即废 |
| `JSESSIONID` | `bkjx` / `authserver` | 各自的会话标识，**两域同名但完全独立** | ❌ 会话级，随时轮换 |
| `route` | `authserver` | 负载均衡节点粘性 | ❌ |
| `acw_tc` | 两域 | 网关限流/追踪 | ❌ |
| `iPlanetDirectoryPro` | `.nenu.edu.cn` | ⚠️ **名字像 CAS 票据，但实测不被认证中心认可** | ❌ |
| `MULTIFACTOR_BROWSER_FINGERPRINT` | `authserver` | **浏览器指纹，多因子风控放行的钥匙** | ✅ 长期有效（前端 JS 写入，过期时间设为 2099 年） |
| `WIS_PER_ENC` / `REFERERCE_TOKEN` / `happyVoyage` | `authserver` | 认证中心业务 Cookie（偏好、防重放、会话加固） | 随会话 |

### 实测依据（关键结论的验证过程）

**`iPlanetDirectoryPro` 不是票据**：拿它单独访问认证中心，与完全不携带 Cookie 的响应**完全一致**（都是登录页），
说明认证中心根本不识别它。真正被识别的是 `CASTGC`——带上它访问认证中心，
响应会变成 `302` 跳往 `reAuthCheck/reAuthLoginView`（多因子校验），而非登录页。

**`MOD_AUTH_CAS` 无法复用**：它的值是标准 `ST-` 格式，服务票据按 CAS 设计就是一次性的，
浏览器已经用它换过登录态，再拿出来必然被拒。

**票根才是钥匙**：`CASTGC` 单独使用会被多因子风控拦到 `reAuthCheck`；
**必须同时携带 `MULTIFACTOR_BROWSER_FINGERPRINT`** 才能无感放行。
这解释了为什么浏览器里登录毫无阻碍，而脚本裸奔就会被拦。

---

## 3. 域名分域规则

Cookie 必须按域存放，否则请求头里会缺东西或串味。

| 域 | 存放内容 | 原因 |
|----|----------|------|
| `.nenu.edu.cn` | `CASTGC`、`MULTIFACTOR_BROWSER_FINGERPRINT`、`iPlanetDirectoryPro`、`WIS_PER_ENC`、`REFERERCE_TOKEN`、`happyVoyage` | 认证中心在 `authserver.nenu.edu.cn`，只有放到顶级域才能递出去 |
| `bkjx.nenu.edu.cn` | 选课系统业务 Cookie（主要是 `JSESSIONID`） | 业务接口在选课系统域下 |

**为什么必须分开**：两个域下**各有同名的 `JSESSIONID`**。
如果混在一起（早期实现就是把所有 Cookie 一律塞到 `bkjx` 域），会出现两个问题：

1. 票根被塞进 `bkjx` 域 → 请求认证中心时**递不出去** → 续期必然失败；
2. 认证中心的 `JSESSIONID` 混进选课系统请求 → 覆盖真实业务会话。

### 代码中的判定逻辑

`app/storage.py` 定义了三个集合，`classify_cookies()` 据此分域：

```
AUTH_COOKIE_NAMES       # 需发给认证中心的 Cookie，归 .nenu.edu.cn
AUTH_SIDE_MARKERS       # 出现任意一个即判定「这段 Cookie 来自认证中心」
AUTH_SESSION_COOKIE_NAMES  # 认证侧会话 Cookie，判定为认证侧来源时直接丢弃
```

判定 `auth_side` 用的是 `AUTH_SIDE_MARKERS` 而非 `CASTGC` 单一名——
因为**用户可能复制到不含 `CASTGC` 的认证中心 Cookie**，此时仍需正确识别来源，
否则会把认证中心的 `JSESSIONID` 误当成选课系统会话塞进 `bkjx` 域。

> 实测确认：选课页面发往业务接口的 Cookie 仅 `iPlanetDirectoryPro` + `JSESSIONID`，
> 二者都不在 `AUTH_SIDE_MARKERS` 中，因此不会被误判、不会误删。

---

## 4. 续期链路

### 4.1 端到端流程（已实测跑通）

```
认证中心 CASTGC + MULTIFACTOR_BROWSER_FINGERPRINT
   │
   ├─ GET https://authserver.nenu.edu.cn/authserver/login?service=<选课系统 SSO 入口>
   │      └─ 风控放行，302 回跳，Location 携带一次性 ticket
   │
   ├─ GET https://bkjx.nenu.edu.cn/new/ssoLogin?ticket=ST-xxxxx
   │      └─ 选课系统校验票据，下发**新的** JSESSIONID
   │
   └─ POST /new/student/xsxk/xklx/{xklxdm}/config  →  code >= 0 即续期成功
```

其中选课系统的 SSO 入口（`app/client.py` 的 `SSO_SERVICE`）为：

```
https://bkjx.nenu.edu.cn/new/ssoLogin
```

这个值来自实测：访问站点根 `https://bkjx.nenu.edu.cn/` 会 `302` 到
`authserver/login?service=https%3A%2F%2Fbkjx.nenu.edu.cn%2Fnew%2FssoLogin`。

### 4.2 两个容易搞错的地方

**① 选课页面本身不会跳转**

`https://bkjx.nenu.edu.cn/xsxk.html?xklxdm=08` 未登录时**直接返回 SPA 骨架页**（HTTP 200），
**不触发**到认证中心的重定向。因此续期不能靠访问它，必须显式请求认证中心或站点根。

**② 续期前必须清掉认证侧的陈旧会话 Cookie**

`app/client.py` 的 `_drop_cas_session_cookies()` 会在续期前移除认证中心域上的
`JSESSIONID` 与 `route`（保留票根）。原因是这些是上一次交互的残留，
带着它们进入新的登录流程会污染流程状态。

### 4.3 兜底顺序

`renew_session()` 先走认证中心显式路径，失败再试站点根（由服务器自行 302 到认证中心）：

```
1. GET authserver/login?service=/new/ssoLogin   ← 主路径
2. GET bkjx.nenu.edu.cn/                        ← 兜底
```

---

## 5. 两种会话模式

### 5.1 内置浏览器模式（推荐，`mode = browser`）

**动机**：`CASTGC` 是 HttpOnly 且随登录轮换，脚本拿不到、手动复制也常常已经失效。
让真实浏览器完成一次登录，是获取该票根唯一可靠的方式。

流程：

```
用户点击「打开登录窗口」
  → Playwright 启动系统 Edge/Chrome（独立 profile）
  → 用户登录（勾选 7天免登录）
  → 浏览器线程轮询发现登录成功
  → 提取全部学校域 Cookie（含 HttpOnly）交给主程序
  → 主程序接管会话、落盘、切换为其会话来源
  → 若已取得 CASTGC：延迟 8 秒后自动关闭浏览器
```

**自动关闭的安全边界（重要设计决策）**

拿到票根后，请求层就能独立完成后续所有续期，浏览器常驻没有意义。
但**关掉浏览器等于失去票根来源**，所以规则是：

> **`has_ticket()` 为假时，绝不关闭浏览器。**

实现位于 `app/session_manager.py`：

- `_maybe_schedule_browser_close()` — 检查开关与票根，满足条件才排定关闭
- `_auto_close_browser()` — 在**独立线程**中执行关闭

> ⚠️ 第二个函数必须另起线程：回调本身运行在浏览器工作线程内，
> 就地调用 `close()` 会让工作线程等待自己退出，造成死锁。

### 5.2 纯粘贴模式（备选，`mode = manual`）

用户手工从浏览器复制 Cookie。此模式：

- **不要求含票根**，有票根则能力等同浏览器模式，无票根则**只能尽力保活**；
- 依赖后台心跳延长存活时间（见下方间隔表）；
- 失效后需重新粘贴。

**正确的复制位置**（顺序不能错）：

1. 打开 `https://bkjx.nenu.edu.cn/` 登录（会自动跳转认证中心）
2. 再打开 `https://bkjx.nenu.edu.cn/xsxk.html?xklxdm=08` —— **这一步才建立选课系统会话**
3. 在**该选课页面** F12 → Network → `Ctrl+R` → 找 `config` 请求 → Headers → `Cookie:` → Copy value

> ⚠️ 只做第 1 步而不进选课页面，拿到的是认证中心的 Cookie，**不含选课系统会话**，
> 粘贴后必然提示未登录。

---

## 6. 模块架构

### 6.1 分层与职责

```
app/storage.py          Cookie 多域模型、分类规则、JSON 持久化
      │
app/client.py           课务 API 客户端：失效检测、票根续期、请求重试
      │   （纯请求层，不碰存储；续期成功通过回调通知上层）
      │
app/browser_session.py  浏览器工作线程：承载 Playwright、采集 Cookie、校验、刷新
      │   （通过命令队列与主线程通信，因 Playwright 对象不可跨线程）
      │
app/session_manager.py  共享会话单例：模式管理、保活心跳、节流落盘、自动关闭
      │
app/web.py              Flask 路由：对外暴露状态与操作接口
      │
app/static/*.js         前端：状态展示与交互
```

### 6.2 关键数据流

**浏览器接管**（浏览器 → 主程序）

```
browser_session._poll()
  → _harvest(ctx)          提取学校域 Cookie（含 HttpOnly）
  → _probe(jar)            建临时客户端试调 config，确认可用
  → _adopt(jar)            触发回调
      → session_manager._on_browser_login(jar)
          → 重建单例客户端、存 jar、置 mode=browser
          → persist(force=True)  立即落盘（票根不能丢）
          → _maybe_schedule_browser_close()
```

**请求中失效自愈**（客户端内部）

```
_send(method, url, auto_renew=True)
  → 发请求
  → 判定失效（见 §8）
  → 若失效且允许续期：renew_session() 成功 → **原样重试一次**
```

用 `self._renewing` 标志防止重入：`_verify_login()` 内部也会走 `_api_post`，
必须挡住递归调用（其调用点显式传 `auto_renew=False`）。

**保活心跳**（`session_manager.ping()`）

```
ping()
  → client.load_config()
      ├─ 成功 → 标记在线、落盘
      └─ 失败 → _refresh_from_browser()   ← 优先让浏览器换新（若在运行）
                 或 client.renew_session()  ← 其次用票根
                 └─ 都失败 → 记录可执行的错误提示
```

---

## 7. 时间参数

| 参数 | 值 | 位置 | 说明 |
|------|-----|------|------|
| `HEARTBEAT_INTERVAL_BROWSER` | 480s | session_manager | 浏览器在跑时，交给它的轮询，心跳放宽 |
| `HEARTBEAT_INTERVAL_TICKET` | 300s | session_manager | 持有票根，续期有保障 |
| `HEARTBEAT_INTERVAL_MANUAL` | 120s | session_manager | 纯粘贴会话最脆弱，需要更勤快地续命 |
| `HEARTBEAT_TICK` | 20s | session_manager | 心跳线程检查步长 |
| `PERSIST_INTERVAL` | 30s | session_manager | Cookie 落盘节流，避免抢课期间高频写盘 |
| `BROWSER_AUTO_CLOSE_DELAY` | 8s | session_manager | 取得票根后延迟关闭，留出落盘余量 |
| `RENEW_FAIL_BACKOFF` | 60s | client | 续期失败后退避，避免票据过期时疯狂重试 |
| `POLL_INTERVAL` | 2.0s | browser_session | 浏览器线程轮询间隔（本地读 Cookie，开销极小） |
| `MIN_PROBE_GAP` | 5s | browser_session | 两次网络校验的最小间隔 |
| 前端状态轮询 | 5000ms | ui.js | 同步徽标与会话状态 |

---

## 8. 失效检测判据

`app/client.py` 的 `_send()` 满足**任一**条件即判定会话失效：

```python
resp.status_code in (401, 403)                      # HTTP 层
data.get('code') == -401                            # 业务层（实测返回）
_looks_like_login_page(resp)                        # 返回登录页 HTML
```

登录页特征（`_looks_like_login_page`）：`Content-Type` 含 `html`，且满足其一：

- 最终 URL 含 `authserver`
- 正文含 `authserver` / `统一身份认证` / `pwdEncryptSalt`

> 实测：业务接口失效时返回 `{"code": -401, "message": "尚未登录，请先登录"}`，
> 业务层判据即可覆盖；HTML 判据是防御性的兜底。

---

## 9. 安全边界与设计决策

| 决策 | 理由 |
|------|------|
| **绝不存储账号密码** | 票根换票不需要密码，安全面与手动登录一致 |
| **浏览器使用独立 profile** | `data/browser-profile/`，不读写用户日常浏览器的收藏/历史/密码 |
| **不主动完成多因子认证** | 只做「票根换票」，不触发登录风控；指纹 Cookie 让风控自然放行 |
| **无票根不关浏览器** | 见 §5.1，避免丧失唯一续期来源 |
| **粘贴失败不影响已有会话** | 早期实现会因一次无效粘贴就把界面置为未登录 |
| **敏感目录全部 gitignore** | `data/storage.json`、`data/browser-profile/`、`dist/data/` 均含登录态 |

`.gitignore` 相关条目（漏掉任意一条都会导致登录态被提交）：

```
data/storage.json
data/browser-profile/
dist/data/
```

---

## 10. 已知限制

1. **票根寿命取决于「7天免登录」**：勾选后约 7 天，不勾选则只有几小时。
   票根过期后需重新登录一次（界面会明确提示原因）。
2. **Playwright 依赖 python.org 版 Python**：MSYS2/MinGW 版 Python 的平台标签为
   `mingw_x86_64_ucrt_gnu`，PyPI 无对应 wheel，pip 报 `from versions: none`。
   该差异**无法用 PEP 508 环境标记表达**（两者的 `platform.machine()` 都是 `AMD64`），
   故 `playwright` 未写入 `requirements.txt`，改为在文件内注明并运行时检测。
3. **headless 下的风控行为未完全验证**：实测 headless 可正常打开登录页，
   但「真实账号登录 + 长期会话在 headless 下维持」需用真实账号确认。
   当前策略是登录用可见窗口。
4. **打包体积**：Playwright 的 Node 驱动约 100 MB，zlib 压缩后 exe 约 54 MB。
   因直接调用系统 Edge/Chrome，无需下载浏览器内核。

---

## 11. 排障

### 诊断脚本

```bash
python tools/diag_login.py
```

会依次打印：Cookie 域名分布与票根状态 → 认证中心换票链路（逐跳）→
config 接口结果 → 主动续期测试 → 续期后的 Cookie 变化。

### 常见失败模式

| 现象 | 原因 | 处理 |
|------|------|------|
| 提示「缺少 CASTGC 票根」 | 复制到的是认证中心 Cookie，或登录未勾选 7 天免登录 | 按 §5.2 顺序复制；或改用登录窗口 |
| 提示「票根已失效」 | 票根过期（未勾选 7 天免登录时仅数小时） | 点击「打开登录窗口」重新登录 |
| 换票被拦在 `reAuthCheck` | 缺少浏览器指纹 Cookie | 确认 `MULTIFACTOR_BROWSER_FINGERPRINT` 已随票根保存 |
| 续期成功但业务接口仍 401 | 新会话又被其他登录顶掉（单会话限制） | 重新登录一次；避免在其他设备同时登录 |
| 认证中心页面 404 | 通常是浏览器本地问题（扩展/代理） | 换无痕窗口；代理把 `nenu.edu.cn` 设为直连 |

### 相关接口

| 接口 | 用途 |
|------|------|
| `GET /api/session/status` | 会话模式、登录状态、票根、浏览器状态 |
| `POST /api/session/renew` | 手动续期（先试浏览器，再用票根） |
| `POST /api/browser/open` | 打开可见登录窗口 |
| `POST /api/browser/refresh` | 让浏览器重建会话 |
| `POST /api/browser/close` | 关闭浏览器 |
| `POST /api/browser/settings` | 切换「登录后自动关闭浏览器」 |
| `POST /api/cookies/set` | 手动粘贴 Cookie（含失败原因诊断） |
