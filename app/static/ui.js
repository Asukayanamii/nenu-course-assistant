// ============================================================
// UI 层 — 页面切换、Cookie、课程查询、已选课程、初始化
// ============================================================

// ---------- Navigation ----------

function switchPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.getElementById('nav-' + name).classList.add('active');
    if (name === 'selected') loadSelected();
}

// ---------- Cookie UI ----------

function showMsg(id, msg, type) {
    const el = document.getElementById(id);
    const colors = {ok:'#16a34a', err:'#dc2626', info:'#2563eb'};
    el.innerHTML = '<span style="color:' + (colors[type] || '#333') + '">' + msg + '</span>';
    setTimeout(() => el.innerHTML = '', 5000);
}

async function setCookie() {
    const cookieStr = document.getElementById('cookie-inp').value.trim();
    if (!cookieStr) return showMsg('cookie-result', 'Cookie 不能为空', 'err');
    try {
        const d = await apiSetCookie(cookieStr);
        if (d.code >= 0) {
            showMsg('cookie-result', '验证通过：' + d.message, 'ok');
            setLoginStatus(true, d.data);
            loadCombos();
            loadWallet();
            refreshSessionStatus();
            resumeGrabIfPaused();
        } else {
            // 粘贴失败不影响已有会话，不清空登录状态
            showMsg('cookie-result', '失败：' + d.message, 'err');
        }
    } catch(e) {
        showMsg('cookie-result', '请求失败：' + e.message, 'err');
    }
}

// ---------- Session Auto-Renew ----------

function fmtClock(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderSessionStatus(s) {
    const box = document.getElementById('session-box');
    if (!box) return;
    if (!s || !s.has_cookies) {
        box.innerHTML = '<span class="text-muted">尚未登录，自动续期未启用</span>';
        renderBrowserStatus(s);
        return;
    }
    const parts = [];
    if (s.mode === 'browser') {
        parts.push('<span class="badge-status badge-success">内置浏览器模式</span>');
        parts.push('<span class="text-muted">登录态由浏览器自动维持</span>');
    } else {
        parts.push('<span class="badge-status badge-info">纯粘贴模式</span>');
        parts.push('<span class="text-muted">尽力保活，失效后需重新粘贴</span>');
    }
    parts.push(s.logged_in
        ? '<span class="badge-status badge-success">会话正常</span>'
        : '<span class="badge-status badge-warning">会话已失效</span>');
    if (s.last_ok_at) {
        parts.push('<span class="text-muted">最近校验 ' + fmtClock(s.last_ok_at) + '</span>');
    }
    let html = parts.join(' ');
    if (s.last_error) {
        html += '<div class="text-red" style="font-size:12px;margin-top:6px">' + esc(s.last_error) + '</div>';
    }
    box.innerHTML = html;
    renderBrowserStatus(s);
}

function renderBrowserStatus(s) {
    const box = document.getElementById('browser-box');
    if (!box) return;
    const b = (s && s.browser) || {};
    if (!b.available) {
        box.innerHTML = '<span class="text-red">' + esc(b.reason || '内置浏览器不可用') + '</span>';
        const btnOpen = document.getElementById('btn-browser-open');
        if (btnOpen) btnOpen.disabled = true;
        return;
    }
    const btnOpen = document.getElementById('btn-browser-open');
    if (btnOpen) btnOpen.disabled = false;
    const parts = [];
    if (b.running) {
        parts.push('<span class="badge-status badge-success">浏览器运行中</span>');
        parts.push('<span class="text-muted">' + esc(b.channel || '') +
            (b.headless ? ' 后台' : ' 窗口') + '</span>');
        parts.push(b.logged_in
            ? '<span class="badge-status badge-success">已登录</span>'
            : '<span class="badge-status badge-warning">等待登录</span>');
    } else if (s && s.tgt_present) {
        parts.push('<span class="badge-status badge-info">已关闭</span>');
        parts.push('<span class="text-muted">已持有登录票根，续期无需浏览器</span>');
    } else {
        parts.push('<span class="text-muted">未启动</span>');
    }
    box.innerHTML = parts.join(' ');
    const btnClose = document.getElementById('btn-browser-close');
    if (btnClose) btnClose.style.display = b.running ? '' : 'none';
    const auto = document.getElementById('f-auto-close');
    if (auto && s) auto.checked = s.auto_close_browser !== false;
}

async function refreshSessionStatus() {
    try {
        const s = await apiSessionStatus();
        renderSessionStatus(s);
        syncLoginBadge(s);
        return s;
    } catch (e) {
        return null;
    }
}

// 后台会话恢复（例如浏览器里刚登录成功）后，把右上角状态同步过来
async function syncLoginBadge(s) {
    if (!s || !s.has_cookies || !s.logged_in || loginState) return;
    try {
        const d = await apiCheckLogin();
        if (!d.logged_in) return;
        setLoginStatus(true, d.config);
        loadCombos();
        loadWallet();
        resumeGrabIfPaused();
        showTmpMsg('登录成功，登录态已同步');
    } catch (e) { /* ignore */ }
}

async function toggleAutoCloseBrowser(el) {
    try {
        const r = await apiBrowserSettings(el.checked);
        renderSessionStatus(r);
    } catch (e) {
        showMsg('cookie-result', '设置失败：' + e.message, 'err');
    }
}

async function openBrowserLogin() {
    const btn = document.getElementById('btn-browser-open');
    if (btn) btn.disabled = true;
    showMsg('cookie-result', '正在启动浏览器（首次启动稍慢）...', 'info');
    try {
        const r = await apiBrowserOpen();
        showMsg('cookie-result',
            r.code === 0 ? '浏览器已打开，请在其中登录（勾选「7天免登录」），登录成功后本页面会自动同步'
                         : '启动失败：' + (r.message || ''),
            r.code === 0 ? 'ok' : 'err');
        renderSessionStatus(r);
    } catch (e) {
        showMsg('cookie-result', '启动失败：' + e.message, 'err');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function refreshBrowserSession() {
    showMsg('cookie-result', '正在让浏览器重新建立会话...', 'info');
    try {
        const r = await apiBrowserRefresh();
        showMsg('cookie-result', r.message, r.code === 0 ? 'ok' : 'err');
        renderSessionStatus(r);
        if (r.code === 0) {
            setLoginStatus(true);
            resumeGrabIfPaused();
        }
    } catch (e) {
        showMsg('cookie-result', '刷新失败：' + e.message, 'err');
    }
}

async function closeBrowser() {
    try {
        const r = await apiBrowserClose();
        showMsg('cookie-result', r.message || '已关闭', 'info');
        renderSessionStatus(r);
    } catch (e) {
        showMsg('cookie-result', '关闭失败：' + e.message, 'err');
    }
}

async function renewSession() {
    const btn = document.getElementById('btn-renew');
    if (btn) btn.disabled = true;
    showMsg('cookie-result', '正在续期...', 'info');
    try {
        const r = await apiRenewSession();
        renderSessionStatus(r);
        if (r.code === 0) {
            showMsg('cookie-result', '续期成功，会话已恢复', 'ok');
            setLoginStatus(true);
            resumeGrabIfPaused();
        } else {
            showMsg('cookie-result', '续期失败：' + (r.message || ''), 'err');
        }
    } catch (e) {
        showMsg('cookie-result', '续期请求失败：' + e.message, 'err');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function setLoginStatus(ok, cfg) {
    if (cfg) loginConfig = cfg;
    loginState = !!ok;
    const data = loginConfig || {};
    const b = document.getElementById('login-badge');
    if (ok) {
        b.className = 'login-status online';
        b.innerHTML = '● 已登录';
        document.getElementById('cfg-card').style.display = 'block';
        const items = [
            ['学期', data?.xkkz?.xnxqmc || data?.xnxqmc || '-'],
            ['类型', data?.xklxmc || '-'],
            ['阶段', data?.xkjd !== undefined ? (['','一选','二选','退选','补选'][data.xkjd] || data.xkjd) : '-'],
            ['可退选', data?.xkkz?.iscancel ? '是' : '否'],
        ];
        document.getElementById('cfg-grid').innerHTML = items.map(([l, v]) =>
            '<div class="item"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>'
        ).join('');
    } else {
        b.className = 'login-status offline';
        b.innerHTML = '● 未登录';
        document.getElementById('cfg-card').style.display = 'none';
    }
}

async function loadCombos() {
    const combos = [
        {id: 'f-kkyxdm', guid: 'kkyx'},
        {id: 'f-kcdldm', guid: 'kcdl'},
        {id: 'f-nd', guid: 'nd'},
        {id: 'f-zydm', guid: 'zydm'},
    ];
    for (const {id, guid} of combos) {
        try {
            const d = await apiGetCombo(guid);
            if (d.code === 0 && Array.isArray(d.data)) {
                const sel = document.getElementById(id);
                sel.innerHTML = '<option value="">(全部)</option>'
                    + d.data.map(item => '<option value="' + item.dm + '">' + item.mc + '</option>').join('');
            }
        } catch(e) { /* ignore */ }
    }
}

async function loadWallet() {
    try {
        const d = await apiGetWallet();
        if (d.zxf !== undefined) {
            const box = document.getElementById('wallet-box');
            box.style.display = 'flex';
            box.innerHTML = '<div class="item"><div class="num">' + (d.zxf || 0) + '</div><div class="l">总</div></div>'
                + '<div class="item"><div class="num">' + (d.yxxf || 0) + '</div><div class="l">已用</div></div>'
                + '<div class="item"><div class="num">' + ((d.zxf - d.yxxf) || 0) + '</div><div class="l">可用</div></div>';
        }
    } catch(e) { /* ignore */ }
}

// ---------- Search & Detail ----------

async function doSearch() {
    const pools = [];
    document.querySelectorAll('.pool-cb:checked').forEach(cb => pools.push(cb.value));
    if (!pools.length) return alert('请至少选择一个课程池');

    const jcStart = document.getElementById('f-jc-start').value;
    const jcEnd = document.getElementById('f-jc-end').value;
    let jc = '';
    if (jcStart && jcEnd) jc = jcStart + ',' + jcEnd;
    else if (jcStart) jc = jcStart;

    const params = {
        kkyxdm: document.getElementById('f-kkyxdm').value,
        kcdldm: document.getElementById('f-kcdldm').value,
        nd: document.getElementById('f-nd').value,
        zydm: document.getElementById('f-zydm').value,
        xq: document.getElementById('f-xq').value,
        jc,
        kcxx: document.getElementById('f-kcxx').value,
        hasme: document.getElementById('f-hasme').checked ? 1 : 0,
    };

    const tb = document.getElementById('course-tbody');
    tb.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:30px"><span class="loading"></span> 查询中...</td></tr>';
    document.getElementById('search-stat').textContent = '';

    try {
        const d = await apiQueryCourses(pools, params);
        const rows = d.rows || [];
        document.getElementById('search-stat').textContent = '共 ' + rows.length + ' 门';

        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="8" class="text-center text-muted">没有找到课程</td></tr>';
            return;
        }

        tb.innerHTML = rows.map((c, i) => {
            const kcptdm = c.kcptdm || '';
            const xklxdm = c._xklxdm || '';
            const poolName = POOL_NAMES[xklxdm] || xklxdm;
            return '<tr onclick="toggleDetail(' + i + ',\'' + kcptdm + '\',\'' + esc(c.kcmc) + '\',\'' + xklxdm + '\')" style="cursor:pointer">'
                + '<td onclick="event.stopPropagation()"><input type="checkbox" class="chk-course" data-kcptdm="' + kcptdm + '" data-kcmc="' + esc(c.kcmc) + '" data-xklxdm="' + xklxdm + '"></td>'
                + '<td>' + (c.kcbh || '-') + '</td>'
                + '<td><strong>' + esc(c.kcmc) + '</strong></td>'
                + '<td>' + esc(c.kkyxmc || '') + '</td>'
                + '<td><span class="badge-status ' + (xklxdm === '02' || xklxdm === '06' ? 'badge-info' : 'badge-success') + '">' + poolName + '</span></td>'
                + '<td>' + (c.xf || '-') + '</td>'
                + '<td><span class="badge-status badge-default" id="stat-' + i + '">点击展开</span></td>'
                + '<td><span class="text-muted" style="font-size:12px">点击行展开</span></td>'
                + '</tr>'
                + '<tr class="detail-row" id="detail-' + i + '"><td colspan="8"><div class="detail-inner" id="detail-inner-' + i + '"></div></td></tr>';
        }).join('');
    } catch(e) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-red">请求失败: ' + e.message + '</td></tr>';
    }
}

function toggleDetail(idx, kcptdm, kcmc, xklxdm) {
    const el = document.getElementById('detail-' + idx);
    if (!el) return;
    const show = !el.classList.contains('show');
    el.classList.toggle('show');
    if (show && kcptdm) loadDetail(idx, kcptdm, kcmc, xklxdm);
}

async function loadDetail(idx, kcptdm, kcmc, xklxdm) {
    if (!kcptdm) return;
    const inner = document.getElementById('detail-inner-' + idx);
    const stat = document.getElementById('stat-' + idx);
    inner.innerHTML = '<span class="loading"></span> 加载中...';
    try {
        const d = await apiQueryDetail(kcptdm, xklxdm);
        const rows = d.rows || [];
        stat.textContent = rows.length + ' 个课堂';
        stat.className = 'badge-status ' + (rows.length ? 'badge-success' : 'badge-default');

        if (!rows.length) {
            inner.innerHTML = '<span class="text-muted">无可用课堂</span>';
            return;
        }

        inner.innerHTML = rows.map(r => {
            const hasSlot = parseInt(r.jxbrs || 0) < parseInt(r.pkrs || 0);
            const inList = grabCourses.some(g => g.kcrwdm === r.kcrwdm);
            return '<div class="item ' + (hasSlot ? 'hasslot' : 'full') + '">'
                + (inList
                    ? '<span class="badge-status badge-info" style="margin-right:6px">已加入</span>'
                    : '<input type="checkbox" class="chk-class" style="margin-right:6px;width:14px;height:14px"'
                        + ' data-kcrwdm="' + esc(r.kcrwdm) + '"'
                        + ' data-kcmc="' + esc(r.kcmc) + '"'
                        + ' data-jxbmc="' + esc(r.jxbmc || '') + '"'
                        + ' data-teaxms="' + esc(r.teaxms || '') + '"'
                        + ' data-pkrs="' + (r.pkrs || 0) + '"'
                        + ' data-jxbrs="' + (r.jxbrs || 0) + '"'
                        + ' data-xqjc="' + esc((r.xqjc || '').substring(0, 30)) + '"'
                        + ' data-xklxdm="' + (r._xklxdm || xklxdm || '') + '"'
                        + ' data-kcptdm="' + kcptdm + '">')
                + '<strong>' + esc(r.jxbmc || '') + '</strong>'
                + ' | ' + esc(r.teaxms || '')
                + ' | ' + (r.pkrs || '?') + '/' + (r.jxbrs || '?')
                + (hasSlot ? ' <span class="badge-status badge-success">有名额</span>' : ' <span class="badge-status badge-danger">已满</span>')
                + ' | <span style="color:#666">' + esc((r.xqjc || '').substring(0, 30)) + '</span>'
                + (inList ? ''
                    : ' <button class="btn btn-sm btn-success" onclick="addToGrab(\'' + r.kcrwdm + '\',\'' + esc(r.kcmc) + '\',\'' + esc(r.jxbmc || '') + '\',\'' + esc(r.teaxms || '') + '\',' + (r.pkrs || 0) + ',' + (r.jxbrs || 0) + ',\'' + esc((r.xqjc || '').substring(0, 30)) + '\',\'' + (r._xklxdm || xklxdm || '') + '\',\'' + kcptdm + '\')">加入抢课</button>')
                + '</div>';
        }).join('');
    } catch(e) {
        inner.innerHTML = '<span class="text-red">加载失败: ' + e.message + '</span>';
    }
}

// ---------- Selected Courses ----------

async function loadSelected() {
    const tb = document.getElementById('selected-tbody');
    tb.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px"><span class="loading"></span></td></tr>';
    try {
        const d = await apiQuerySelected();
        const rows = d.rows || [];
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无已选课程</td></tr>';
            return;
        }
        tb.innerHTML = rows.map(r =>
            '<tr>'
            + '<td><strong>' + esc(r.kcmc) + '</strong></td>'
            + '<td>' + esc(r.teaxms || '') + '</td>'
            + '<td>' + esc(r.jxbmc || '') + '</td>'
            + '<td>' + (r.xf || '-') + '</td>'
            + '<td style="font-size:12px">' + esc((r.xqjc || '').substring(0, 30)) + '</td>'
            + '<td style="font-size:12px">' + esc((r.jxcdmcs || '').substring(0, 20)) + '</td>'
            + '<td><button class="btn btn-sm btn-danger" onclick="doCancel(\'' + r.kcrwdm + '\',\'' + esc(r.kcmc) + '\')">退选</button></td>'
            + '</tr>'
        ).join('');
    } catch(e) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-red">' + e.message + '</td></tr>';
    }
}

async function doCancel(kcrwdm, kcmc) {
    if (!confirm('确定退选「' + kcmc + '」?')) return;
    try {
        const d = await apiCancelCourse(kcrwdm, kcmc);
        if (d.code >= 0) { alert('退选成功'); loadSelected(); }
        else alert(d.message);
    } catch(e) {
        alert('退选失败: ' + e.message);
    }
}

// ---------- Misc UI ----------

function toggleAllCheck(el) {
    document.querySelectorAll('.chk-course').forEach(c => c.checked = el.checked);
}

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', async () => {
    // 恢复抢课列表
    try {
        const d = await apiLoadGrabList();
        if (d.code === 0 && Array.isArray(d.data)) {
            grabCourses = d.data;
            renderGrabList();
        }
    } catch(e) { /* ignore */ }

    // 恢复频率设置
    const savedReq = localStorage.getItem('grab_req_delay');
    const savedCycle = localStorage.getItem('grab_cycle_delay');
    if (savedReq !== null) document.getElementById('f-req-delay').value = savedReq;
    if (savedCycle !== null) document.getElementById('f-cycle-delay').value = savedCycle;
    const savedSkip = localStorage.getItem('grab_skip_conflict');
    if (savedSkip !== null) document.getElementById('f-skip-conflict').checked = savedSkip === '1';

    // 检查登录状态
    try {
        const d = await apiCheckLogin();
        if (d.logged_in) {
            setLoginStatus(true, d.config);
            loadCombos();
            loadWallet();
        }
        renderSessionStatus(d.session);
    } catch(e) { /* ignore */ }

    // 定时同步会话与浏览器状态（本地接口，开销很小）
    setInterval(refreshSessionStatus, 5000);
});
