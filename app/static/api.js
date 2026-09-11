// ============================================================
// API 层 — 封装所有后端 fetch 调用，返回解析后的 JSON 数据
// 不操作 DOM，不关心 UI 状态
// ============================================================

// ---------- Cookie ----------
async function apiSetCookie(cookieStr) {
    const r = await fetch('/api/cookies/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({cookies: cookieStr})
    });
    return await r.json();
}

async function apiCheckLogin() {
    const r = await fetch('/api/cookies/check');
    return await r.json();
}

async function apiSessionStatus() {
    const r = await fetch('/api/session/status');
    return await r.json();
}

async function apiRenewSession() {
    const r = await fetch('/api/session/renew', {method: 'POST'});
    return await r.json();
}

// ---------- 内置浏览器 ----------
async function apiBrowserStatus() {
    const r = await fetch('/api/browser/status');
    return await r.json();
}

async function apiBrowserOpen() {
    const r = await fetch('/api/browser/open', {method: 'POST'});
    return await r.json();
}

async function apiBrowserClose() {
    const r = await fetch('/api/browser/close', {method: 'POST'});
    return await r.json();
}

async function apiBrowserRefresh() {
    const r = await fetch('/api/browser/refresh', {method: 'POST'});
    return await r.json();
}

async function apiBrowserSettings(autoClose) {
    const r = await fetch('/api/browser/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({auto_close_browser: autoClose})
    });
    return await r.json();
}

// ---------- Config & Combo ----------
async function apiGetCombo(guid) {
    const r = await fetch('/api/combo/' + guid);
    return await r.json();
}

async function apiGetWallet() {
    const r = await fetch('/api/wallet');
    return await r.json();
}

// ---------- Course Query ----------
async function apiQueryCourses(pools, params) {
    const r = await fetch('/api/courses/query', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pools, ...params})
    });
    return await r.json();
}

async function apiQueryDetail(kcptdm, xklxdm) {
    const r = await fetch('/api/courses/query_detail', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({kcptdm, xklxdm})
    });
    return await r.json();
}

async function apiQuerySelected() {
    const r = await fetch('/api/courses/selected');
    return await r.json();
}

// ---------- Course Actions ----------
async function apiAddCourse(kcrwdm, kcmc, xklxdm, confirm) {
    const body = {kcrwdm, kcmc};
    if (xklxdm) body.xklxdm = xklxdm;
    if (confirm) body.confirm = true;
    const r = await fetch('/api/courses/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    return await r.json();
}

async function apiCancelCourse(kcrwdm, kcmc, xklxdm) {
    const body = {kcrwdm, kcmc};
    if (xklxdm) body.xklxdm = xklxdm;
    const r = await fetch('/api/courses/cancel', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    return await r.json();
}

// ---------- Grab List Persistence ----------
async function apiLoadGrabList() {
    const r = await fetch('/api/grab_list');
    return await r.json();
}

async function apiSaveGrabList(items) {
    await fetch('/api/grab_list', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({items})
    });
}
