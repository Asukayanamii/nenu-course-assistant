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
        } else {
            showMsg('cookie-result', '失败：' + d.message, 'err');
            setLoginStatus(false);
        }
    } catch(e) {
        showMsg('cookie-result', '请求失败：' + e.message, 'err');
    }
}

function setLoginStatus(ok, cfg) {
    const b = document.getElementById('login-badge');
    if (ok) {
        b.className = 'login-status online';
        b.innerHTML = '● 已登录';
        document.getElementById('cfg-card').style.display = 'block';
        const items = [
            ['学期', cfg?.xkkz?.xnxqmc || cfg?.xnxqmc || '-'],
            ['类型', cfg?.xklxmc || '-'],
            ['阶段', cfg?.xkjd !== undefined ? (['','一选','二选','退选','补选'][cfg.xkjd] || cfg.xkjd) : '-'],
            ['可退选', cfg?.xkkz?.iscancel ? '是' : '否'],
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
    } catch(e) { /* ignore */ }
});
