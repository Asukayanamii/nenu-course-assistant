// ===== State =====
const POOL_NAMES = {'02':'本部专业','06':'本部公共','07':'净月专业','08':'净月公共'};
let grabCourses = [];           // {kcrwdm, kcmc, jxbmc, teaxms, pkrs, jxbrs, xqjc, xklxdm}
let grabRunning = false;
let grabTimer = null;
let grabQueue = [];             // courses still being tried
let grabSucceeded = [];
let grabAttempt = 0;
let grabStop = false;

// ===== Nav =====
function switchPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.getElementById('page-'+name).classList.add('active');
    document.getElementById('nav-'+name).classList.add('active');
    if (name === 'selected') loadSelected();
}

// ===== Cookie =====
function showMsg(id, msg, type) {
    const el = document.getElementById(id);
    const colors = {ok:'#16a34a',err:'#dc2626',info:'#2563eb'};
    el.innerHTML = '<span style="color:'+(colors[type]||'#333')+'">'+msg+'</span>';
    setTimeout(()=>el.innerHTML='',5000);
}

async function setCookie() {
    const c = document.getElementById('cookie-inp').value.trim();
    if (!c) return showMsg('cookie-result','Cookie 不能为空','err');
    try {
        const r = await fetch('/api/cookies/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:c})});
        const d = await r.json();
        if (d.code>=0) {
            showMsg('cookie-result','验证通过：'+d.message,'ok');
            setLoginStatus(true, d.data);
            loadCombos();
            loadWallet();
        } else {
            showMsg('cookie-result','失败：'+d.message,'err');
            setLoginStatus(false);
        }
    } catch(e) { showMsg('cookie-result','请求失败：'+e.message,'err'); }
}

function setLoginStatus(ok, cfg) {
    const b = document.getElementById('login-badge');
    if (ok) {
        b.className = 'login-status online'; b.innerHTML = '● 已登录';
        document.getElementById('cfg-card').style.display = 'block';
        const g = document.getElementById('cfg-grid');
        let h = '';
        const items = [
            ['学期', cfg?.xkkz?.xnxqmc || cfg?.xnxqmc || '-'],
            ['类型', cfg?.xklxmc || '-'],
            ['阶段', cfg?.xkjd !== undefined ? ['','一选','二选','退选','补选'][cfg.xkjd] || cfg.xkjd : '-'],
            ['可退选', cfg?.xkkz?.iscancel ? '是' : '否'],
        ];
        items.forEach(([l,v])=>{ h += '<div class="item"><div class="l">'+l+'</div><div class="v">'+v+'</div></div>'; });
        g.innerHTML = h;
    } else {
        b.className = 'login-status offline'; b.innerHTML = '● 未登录';
        document.getElementById('cfg-card').style.display = 'none';
    }
}

async function loadCombos() {
    const list = {'f-kkyxdm':'kkyx','f-kcdldm':'kcdl','f-nd':'nd','f-zydm':'zydm'};
    for (const [id,guid] of Object.entries(list)) {
        try {
            const r = await fetch('/api/combo/'+guid);
            const d = await r.json();
            if (d.code===0 && Array.isArray(d.data)) {
                const sel = document.getElementById(id);
                sel.innerHTML = '<option value="">(全部)</option>';
                d.data.forEach(item => { sel.innerHTML += '<option value="'+item.dm+'">'+item.mc+'</option>'; });
            }
        } catch(e) {}
    }
}

async function loadWallet() {
    try {
        const r = await fetch('/api/wallet');
        const d = await r.json();
        if (d.zxf !== undefined) {
            const box = document.getElementById('wallet-box');
            box.style.display = 'flex';
            box.innerHTML = '<div class="item"><div class="num">'+(d.zxf||0)+'</div><div class="l">总</div></div>'
                          + '<div class="item"><div class="num">'+(d.yxxf||0)+'</div><div class="l">已用</div></div>'
                          + '<div class="item"><div class="num">'+((d.zxf-d.yxxf)||0)+'</div><div class="l">可用</div></div>';
        }
    } catch(e) {}
}

// ===== Search =====
async function doSearch() {
    const pools = [];
    document.querySelectorAll('.pool-cb:checked').forEach(cb => pools.push(cb.value));
    if (!pools.length) return alert('请至少选择一个课程池');

    // 节次范围: 起~止 → 逗号分隔
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
        jc: jc,
        kcxx: document.getElementById('f-kcxx').value,
        hasme: document.getElementById('f-hasme').checked ? 1 : 0,
    };
    const tb = document.getElementById('course-tbody');
    tb.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:30px"><span class="loading"></span> 查询中...</td></tr>';
    document.getElementById('search-stat').textContent = '';
    try {
        const r = await fetch('/api/courses/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pools:pools,...params})});
        const d = await r.json();
        const rows = d.rows || [];
        document.getElementById('search-stat').textContent = '共 '+rows.length+' 门';
        if (!rows.length) {
            tb.innerHTML = '<tr><td colspan="8" class="text-center text-muted">没有找到课程</td></tr>';
            return;
        }
        let h = '';
        rows.forEach((c,i) => {
            const kcptdm = c.kcptdm || '';
            const xklxdm = c._xklxdm || '';
            const poolName = POOL_NAMES[xklxdm] || xklxdm;
            h += '<tr onclick="toggleDetail('+i+',\''+kcptdm+'\',\''+esc(c.kcmc)+'\',\''+xklxdm+'\')" style="cursor:pointer">'
                + '<td onclick="event.stopPropagation()"><input type="checkbox" class="chk-course" data-kcptdm="'+kcptdm+'" data-kcmc="'+esc(c.kcmc)+'" data-xklxdm="'+xklxdm+'"></td>'
                + '<td>'+(c.kcbh||'-')+'</td>'
                + '<td><strong>'+esc(c.kcmc)+'</strong></td>'
                + '<td>'+esc(c.kkyxmc||'')+'</td>'
                + '<td><span class="badge-status '+(xklxdm==='02'||xklxdm==='06'?'badge-info':'badge-success')+'">'+poolName+'</span></td>'
                + '<td>'+(c.xf||'-')+'</td>'
                + '<td><span class="badge-status badge-default" id="stat-'+i+'">点击展开</span></td>'
                + '<td><span class="text-muted" style="font-size:12px">点击行展开</span></td>'
                + '</tr>'
                + '<tr class="detail-row" id="detail-'+i+'"><td colspan="8"><div class="detail-inner" id="detail-inner-'+i+'"></div></td></tr>';
        });
        tb.innerHTML = h;
    } catch(e) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-red">请求失败: '+e.message+'</td></tr>';
    }
}

function toggleDetail(idx, kcptdm, kcmc, xklxdm) {
    const el = document.getElementById('detail-'+idx);
    if (!el) return;
    const show = !el.classList.contains('show');
    el.classList.toggle('show');
    if (show && kcptdm) loadDetail(idx, kcptdm, kcmc, xklxdm);
}

async function loadDetail(idx, kcptdm, kcmc, xklxdm) {
    if (!kcptdm) return;
    const inner = document.getElementById('detail-inner-'+idx);
    const stat = document.getElementById('stat-'+idx);
    inner.innerHTML = '<span class="loading"></span> 加载中...';
    try {
        const r = await fetch('/api/courses/query_detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kcptdm,xklxdm})});
        const d = await r.json();
        const rows = d.rows || [];
        stat.textContent = rows.length+' 个课堂';
        stat.className = 'badge-status '+(rows.length?'badge-success':'badge-default');

        if (!rows.length) { inner.innerHTML = '<span class="text-muted">无可用课堂</span>'; return; }

        let h = '';
        rows.forEach(r => {
            const hasSlot = parseInt(r.jxbrs||0) < parseInt(r.pkrs||0);
            const inList = grabCourses.some(g => g.kcrwdm === r.kcrwdm);
            h += '<div class="item '+(hasSlot?'hasslot':'full')+'">'
                + (inList ? '<span class="badge-status badge-info" style="margin-right:6px">已加入</span>'
                   : '<input type="checkbox" class="chk-class" style="margin-right:6px;width:14px;height:14px"'
                     + ' data-kcrwdm="'+esc(r.kcrwdm)+'"'
                     + ' data-kcmc="'+esc(r.kcmc)+'"'
                     + ' data-jxbmc="'+esc(r.jxbmc||'')+'"'
                     + ' data-teaxms="'+esc(r.teaxms||'')+'"'
                     + ' data-pkrs="'+(r.pkrs||0)+'"'
                     + ' data-jxbrs="'+(r.jxbrs||0)+'"'
                     + ' data-xqjc="'+esc((r.xqjc||'').substring(0,30))+'"'
                     + ' data-xklxdm="'+(r._xklxdm||xklxdm||'')+'"'
                     + '>')
                + '<strong>'+esc(r.jxbmc||'')+'</strong>'
                + ' | '+esc(r.teaxms||'')
                + ' | '+(r.pkrs||'?')+'/'+(r.jxbrs||'?')
                + (hasSlot ? ' <span class="badge-status badge-success">有名额</span>' : ' <span class="badge-status badge-danger">已满</span>')
                + ' | <span style="color:#666">'+esc((r.xqjc||'').substring(0,30))+'</span>'
                + (inList ? ''
                   : ' <button class="btn btn-sm btn-success" onclick="addToGrab(\''+r.kcrwdm+'\',\''+esc(r.kcmc)+'\',\''+esc(r.jxbmc||'')+'\',\''+esc(r.teaxms||'')+'\',\''+(r.pkrs||0)+'\',\''+(r.jxbrs||0)+'\',\''+esc((r.xqjc||'').substring(0,30))+'\',\''+(r._xklxdm||xklxdm||'')+'\')">加入抢课</button>')
                + '</div>';
        });
        inner.innerHTML = h;
    } catch(e) {
        inner.innerHTML = '<span class="text-red">加载失败: '+e.message+'</span>';
    }
}

// ===== Grab List Persistence =====
async function loadGrabListFromServer() {
    try {
        const r = await fetch('/api/grab_list');
        const d = await r.json();
        if (d.code === 0 && Array.isArray(d.data)) {
            grabCourses = d.data;
            renderGrabList();
        }
    } catch(e) {}
}

async function saveGrabListToServer() {
    try {
        await fetch('/api/grab_list', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({items: grabCourses})
        });
    } catch(e) {}
}

// ===== Grab List Mgmt =====
function addToGrab(kcrwdm, kcmc, jxbmc, teaxms, pkrs, jxbrs, xqjc, xklxdm) {
    if (grabCourses.some(g => g.kcrwdm === kcrwdm)) return;
    grabCourses.push({kcrwdm,kcmc,jxbmc,teaxms,pkrs,jxbrs,xqjc,xklxdm:xklxdm||'',autoReplace:false});
    renderGrabList();
    saveGrabListToServer();
    showTmpMsg('已加入抢课列表: '+kcmc);
}

function removeGrab(kcrwdm) {
    grabCourses = grabCourses.filter(g => g.kcrwdm !== kcrwdm);
    renderGrabList();
    saveGrabListToServer();
}

function toggleAutoReplace(kcrwdm) {
    const course = grabCourses.find(g => g.kcrwdm === kcrwdm);
    if (course) {
        course.autoReplace = !course.autoReplace;
        saveGrabListToServer();
    }
}

async function addCheckedToGrab() {
    const classCbs = document.querySelectorAll('.chk-class:checked');
    const courseCbs = document.querySelectorAll('.chk-course:checked');
    if (!classCbs.length && !courseCbs.length) {
        alert('请勾选要加入的课程（勾选课程行可加入该课所有课堂，勾选具体课堂可单独加入）');
        return;
    }
    let count = 0;
    // 1. 处理已勾选的单个课堂
    classCbs.forEach(cb => {
        const kcrwdm = cb.dataset.kcrwdm;
        if (!kcrwdm || grabCourses.some(g => g.kcrwdm === kcrwdm)) return;
        grabCourses.push({
            kcrwdm: kcrwdm,
            kcmc: cb.dataset.kcmc || '',
            jxbmc: cb.dataset.jxbmc || '',
            teaxms: cb.dataset.teaxms || '',
            pkrs: cb.dataset.pkrs || 0,
            jxbrs: cb.dataset.jxbrs || 0,
            xqjc: cb.dataset.xqjc || '',
            xklxdm: cb.dataset.xklxdm || '',
            autoReplace: false,
        });
        count++;
    });
    // 2. 处理已勾选的课程行 → 自动获取该课所有课堂
    for (const cb of courseCbs) {
        const kcptdm = cb.dataset.kcptdm;
        const kcmc = cb.dataset.kcmc;
        const xklxdm = cb.dataset.xklxdm;
        if (!kcptdm) continue;
        try {
            const r = await fetch('/api/courses/query_detail', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({kcptdm, xklxdm})
            });
            const d = await r.json();
            (d.rows || []).forEach(row => {
                if (grabCourses.some(g => g.kcrwdm === row.kcrwdm)) return;
                grabCourses.push({
                    kcrwdm: row.kcrwdm,
                    kcmc: row.kcmc || kcmc || '',
                    jxbmc: row.jxbmc || '',
                    teaxms: row.teaxms || '',
                    pkrs: row.pkrs || 0,
                    jxbrs: row.jxbrs || 0,
                    xqjc: (row.xqjc || '').substring(0, 30),
                    xklxdm: row._xklxdm || xklxdm || '',
                    autoReplace: false,
                });
                count++;
            });
        } catch(e) {
            addLog && addLog('warn', '获取课程['+kcmc+']课堂列表失败: '+e.message);
        }
    }
    if (count) {
        renderGrabList();
        saveGrabListToServer();
        showTmpMsg('已批量加入 '+count+' 个课堂');
    } else {
        alert('勾选的课堂已在抢课列表中');
    }
}

function renderGrabList() {
    const tb = document.getElementById('grab-tbody');
    document.getElementById('grab-count').textContent = grabCourses.length+' 门';
    if (!grabCourses.length) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无课程</td></tr>';
        return;
    }
    let h = '';
    grabCourses.forEach(g => {
        const hasSlot = parseInt(g.jxbrs) < parseInt(g.pkrs);
        const poolName = POOL_NAMES[g.xklxdm] || g.xklxdm || '';
        h += '<tr>'
            + '<td><strong>'+esc(g.kcmc)+'</strong></td>'
            + '<td>'+esc(g.jxbmc||'')+'</td>'
            + '<td>'+esc(g.teaxms||'')+'</td>'
            + '<td>'+(poolName?'<span class="badge-status badge-info">'+poolName+'</span>':'')+'</td>'
            + '<td>'+(g.pkrs||'?')+'/'+(g.jxbrs||'?')+' '+(hasSlot?'<span class="badge-status badge-success">有名额</span>':'<span class="badge-status badge-danger">已满</span>')+'</td>'
            + '<td><label class="toggle toggle-sm" onclick="event.stopPropagation()">'
                + '<input type="checkbox" '+(g.autoReplace?'checked':'')+' onchange="toggleAutoReplace(\''+g.kcrwdm+'\')">'
                + '<span class="slider"></span>'
                + '</label></td>'
            + '<td><button class="btn btn-sm btn-danger" onclick="removeGrab(\''+g.kcrwdm+'\')">移除</button></td>'
            + '</tr>';
    });
    tb.innerHTML = h;
}

// ===== Auto Grab =====
let grabSkipped = [];   // courses with time conflicts that won't resolve

async function startGrab() {
    if (!grabCourses.length) return alert('请先在课程查询页面添加要抢的课程');
    if (grabRunning) return;
    grabRunning = true;
    grabStop = false;
    grabQueue = [...grabCourses];
    grabSucceeded = [];
    grabSkipped = [];
    grabAttempt = 0;
    document.getElementById('btn-grab-start').disabled = true;
    document.getElementById('btn-grab-stop').disabled = false;
    document.getElementById('grab-state').textContent = '抢课进行中...';
    document.getElementById('progress-card').style.display = 'block';
    document.getElementById('status-log').innerHTML = '';
    addLog('info','抢课启动，目标 '+grabQueue.length+' 门');
    if (!grabTimer) grabTimer = setInterval(pollGrabStatus, 600);
    runGrabCycle();
}

async function runGrabCycle() {
    const reqDelay = parseInt(document.getElementById('f-req-delay').value) || 0;
    const cycleDelay = parseInt(document.getElementById('f-cycle-delay').value) || 300;
    localStorage.setItem('grab_req_delay', reqDelay);
    localStorage.setItem('grab_cycle_delay', cycleDelay);
    localStorage.setItem('grab_skip_conflict', document.getElementById('f-skip-conflict').checked ? '1' : '0');

    while (grabQueue.length > 0 && !grabStop) {
        grabAttempt++;
        const next = [];
        for (const course of grabQueue) {
            if (grabStop) break;
            try {
                const body = {kcrwdm:course.kcrwdm,kcmc:course.kcmc};
                if (course.xklxdm) body.xklxdm = course.xklxdm;
                const r = await fetch('/api/courses/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
                const d = await r.json();
                if (d.code >= 0) {
                    addLog('ok','选课成功: '+course.kcmc);
                    grabSucceeded.push(course);
                    if (reqDelay > 0) await sleep(reqDelay);
                    continue;
                } else if (d.code === -2) {
                    const r2 = await fetch('/api/courses/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,confirm:true})});
                    const d2 = await r2.json();
                    if (d2.code >= 0) {
                        addLog('ok','选课成功(冲突确认): '+course.kcmc);
                        grabSucceeded.push(course);
                        if (reqDelay > 0) await sleep(reqDelay);
                        continue;
                    }
                } else if (d.code === -401) {
                    addLog('fail','登录过期，停止抢课');
                    setLoginStatus(false);
                    grabStop = true;
                    break;
                }
                // 时间冲突 — 根据开关决定跳过、替换还是继续重试
                if (d.message && d.message.includes('上课时间有冲突')) {
                    const skip = document.getElementById('f-skip-conflict').checked;
                    if (skip && course.autoReplace) {
                        // 自动替换：退掉已选课再选这门
                        addLog('info','尝试自动替换 ['+course.kcmc+']: 查询已选课程...');
                        let replaced = false;
                        try {
                            const selR = await fetch('/api/courses/selected');
                            const selD = await selR.json();
                            const enrolled = selD.rows || [];
                            for (const ec of enrolled) {
                                if (grabStop) break;
                                if (ec.kcrwdm === course.kcrwdm) continue;
                                addLog('info','尝试退 ['+ec.kcmc+'] 后选 ['+course.kcmc+']');
                                await fetch('/api/courses/cancel', {
                                    method:'POST', headers:{'Content-Type':'application/json'},
                                    body:JSON.stringify({kcrwdm:ec.kcrwdm,kcmc:ec.kcmc,xklxdm:ec._xklxdm||course.xklxdm||''})
                                });
                                const addBody = {kcrwdm:course.kcrwdm,kcmc:course.kcmc};
                                if (course.xklxdm) addBody.xklxdm = course.xklxdm;
                                const aR = await fetch('/api/courses/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(addBody)});
                                const aD = await aR.json();
                                if (aD.code >= 0) {
                                    addLog('ok','替换成功: '+course.kcmc+' (已退 '+ec.kcmc+')');
                                    grabSucceeded.push(course);
                                    replaced = true; break;
                                }
                                if (aD.code === -2) {
                                    const aR2 = await fetch('/api/courses/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...addBody,confirm:true})});
                                    const aD2 = await aR2.json();
                                    if (aD2.code >= 0) {
                                        addLog('ok','替换成功(冲突确认): '+course.kcmc+' (已退 '+ec.kcmc+')');
                                        grabSucceeded.push(course);
                                        replaced = true; break;
                                    }
                                }
                                addLog('info','退 ['+ec.kcmc+'] 后仍未选上 ['+course.kcmc+']，继续尝试下一门');
                                if (reqDelay > 0) await sleep(reqDelay);
                            }
                        } catch(e) {
                            addLog('warn','自动替换异常 ['+course.kcmc+']: '+e.message);
                        }
                        if (replaced) { if (reqDelay > 0) await sleep(reqDelay); continue; }
                        addLog('fail','替换失败，跳过 [ '+course.kcmc+' ]: '+d.message);
                        grabSkipped.push(course);
                        if (reqDelay > 0) await sleep(reqDelay);
                        continue;
                    } else if (skip) {
                        addLog('fail','跳过 [ '+course.kcmc+' ]: '+d.message);
                        grabSkipped.push(course);
                        if (reqDelay > 0) await sleep(reqDelay);
                        continue;
                    } else {
                        addLog('info','第 '+grabAttempt+' 次尝试 ['+course.kcmc+'] (冲突中): '+(d.message||''));
                        next.push(course);
                        if (reqDelay > 0) await sleep(reqDelay);
                        continue;
                    }
                }
                addLog('info','第 '+grabAttempt+' 次尝试 ['+course.kcmc+']: '+(d.message||''));
                next.push(course);
            } catch(e) {
                addLog('warn','请求异常 ['+course.kcmc+']: '+e.message);
                next.push(course);
            }
            if (reqDelay > 0) await sleep(reqDelay);
        }
        grabQueue = next;
        if (grabQueue.length > 0 && !grabStop) await sleep(cycleDelay);
    }
    if (grabQueue.length === 0 && !grabStop) {
        let msg = '全部完成！成功 '+grabSucceeded.length+'门';
        if (grabSkipped.length) msg += '，因时间冲突跳过 '+grabSkipped.length+'门';
        addLog('ok', msg);
    } else if (grabStop) {
        addLog('info','已停止，成功 '+grabSucceeded.length+'/'+grabCourses.length+'门');
    }
    grabRunning = false;
    document.getElementById('btn-grab-start').disabled = false;
    document.getElementById('btn-grab-stop').disabled = true;
    document.getElementById('grab-state').textContent = '就绪';
    if (grabTimer) { clearInterval(grabTimer); grabTimer = null; }
}

function stopGrab() { grabStop = true; addLog('info','正在停止...'); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pollGrabStatus() {
    const prog = document.getElementById('progress-list');
    let h = '';
    grabCourses.forEach(c => {
        const done = grabSucceeded.some(s => s.kcrwdm === c.kcrwdm);
        const skipped = grabSkipped.some(s => s.kcrwdm === c.kcrwdm);
        const trying = grabQueue.some(q => q.kcrwdm === c.kcrwdm);
        const status = done ? '<span class="text-green">已选上</span>'
                     : skipped ? '<span class="text-orange">已跳过(冲突)</span>'
                     : (!grabRunning && !trying) ? '<span class="text-red">未成功</span>'
                     : '<span class="text-muted">尝试 #'+grabAttempt+'</span>';
        h += '<div class="progress-item"><span class="name">'+esc(c.kcmc)+'</span><span>'+status+'</span></div>';
    });
    prog.innerHTML = h;
}

function addLog(type, msg) {
    const el = document.getElementById('status-log');
    const cls = {ok:'ok',fail:'fail',info:'info',warn:'warn'};
    el.innerHTML += '<div><span class="t">['+now()+']</span> <span class="'+(cls[type]||'info')+'">'+esc(msg)+'</span></div>';
    el.scrollTop = el.scrollHeight;
}

function now() {
    const d = new Date();
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
}

// ===== Selected =====
async function loadSelected() {
    const tb = document.getElementById('selected-tbody');
    tb.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:20px"><span class="loading"></span></td></tr>';
    try {
        const r = await fetch('/api/courses/selected');
        const d = await r.json();
        const rows = d.rows || [];
        if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无已选课程</td></tr>'; return; }
        let h = '';
        rows.forEach(r => {
            h += '<tr>'
                + '<td><strong>'+esc(r.kcmc)+'</strong></td>'
                + '<td>'+esc(r.teaxms||'')+'</td>'
                + '<td>'+esc(r.jxbmc||'')+'</td>'
                + '<td>'+(r.xf||'-')+'</td>'
                + '<td style="font-size:12px">'+esc((r.xqjc||'').substring(0,30))+'</td>'
                + '<td style="font-size:12px">'+esc((r.jxcdmcs||'').substring(0,20))+'</td>'
                + '<td><button class="btn btn-sm btn-danger" onclick="doCancel(\''+r.kcrwdm+'\',\''+esc(r.kcmc)+'\')">退选</button></td>'
                + '</tr>';
        });
        tb.innerHTML = h;
    } catch(e) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-red">'+e.message+'</td></tr>';
    }
}

async function doCancel(kcrwdm, kcmc) {
    if (!confirm('确定退选「'+kcmc+'」?')) return;
    try {
        const r = await fetch('/api/courses/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kcrwdm,kcmc})});
        const d = await r.json();
        if (d.code >= 0) { alert('退选成功'); loadSelected(); }
        else alert(d.message);
    } catch(e) { alert('退选失败: '+e.message); }
}

// ===== Util =====
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toggleAllCheck(el) { document.querySelectorAll('.chk-course').forEach(c => c.checked = el.checked); }

let tmpMsgTimer = null;
function showTmpMsg(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#16a34a;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,0.2)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    // 抢课列表持久化加载
    loadGrabListFromServer();

    // 恢复频率设置
    const savedReq = localStorage.getItem('grab_req_delay');
    const savedCycle = localStorage.getItem('grab_cycle_delay');
    if (savedReq !== null) document.getElementById('f-req-delay').value = savedReq;
    if (savedCycle !== null) document.getElementById('f-cycle-delay').value = savedCycle;
    const savedSkip = localStorage.getItem('grab_skip_conflict');
    if (savedSkip !== null) document.getElementById('f-skip-conflict').checked = savedSkip === '1';

    // Check login
    try {
        const r = await fetch('/api/cookies/check');
        const d = await r.json();
        if (d.logged_in) {
            setLoginStatus(true, d.config);
            loadCombos();
            loadWallet();
        }
    } catch(e) {}
});
