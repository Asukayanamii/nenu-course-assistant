// ============================================================
// 抢课核心 — 列表管理、自动轮询、冲突替换
// ============================================================

// ---------- Grab List Management ----------

function addToGrab(kcrwdm, kcmc, jxbmc, teaxms, pkrs, jxbrs, xqjc, xklxdm, kcptdm) {
    if (grabCourses.some(g => g.kcrwdm === kcrwdm)) return;
    grabCourses.push({
        kcrwdm, kcmc, jxbmc, teaxms,
        pkrs: parseInt(pkrs), jxbrs: parseInt(jxbrs),
        xqjc, xklxdm: xklxdm || '',
        autoReplace: false, kcptdm: kcptdm || ''
    });
    renderGrabList();
    apiSaveGrabList(grabCourses);
    showTmpMsg('已加入抢课列表: ' + kcmc);
}

function removeGrab(kcrwdm) {
    grabCourses = grabCourses.filter(g => g.kcrwdm !== kcrwdm);
    renderGrabList();
    apiSaveGrabList(grabCourses);
}

function toggleAutoReplace(kcrwdm) {
    const course = grabCourses.find(g => g.kcrwdm === kcrwdm);
    if (!course) return;
    course.autoReplace = !course.autoReplace;
    apiSaveGrabList(grabCourses);
}

async function addCheckedToGrab() {
    const classCbs = document.querySelectorAll('.chk-class:checked');
    const courseCbs = document.querySelectorAll('.chk-course:checked');
    if (!classCbs.length && !courseCbs.length) {
        alert('请勾选要加入的课程（勾选课程行可加入该课所有课堂，勾选具体课堂可单独加入）');
        return;
    }
    let count = 0;

    // 1) 已勾选的单个课堂
    classCbs.forEach(cb => {
        const kcrwdm = cb.dataset.kcrwdm;
        if (!kcrwdm || grabCourses.some(g => g.kcrwdm === kcrwdm)) return;
        grabCourses.push({
            kcrwdm, kcptdm: cb.dataset.kcptdm || '',
            kcmc: cb.dataset.kcmc || '',
            jxbmc: cb.dataset.jxbmc || '',
            teaxms: cb.dataset.teaxms || '',
            pkrs: parseInt(cb.dataset.pkrs) || 0,
            jxbrs: parseInt(cb.dataset.jxbrs) || 0,
            xqjc: cb.dataset.xqjc || '',
            xklxdm: cb.dataset.xklxdm || '',
            autoReplace: false,
        });
        count++;
    });

    // 2) 已勾选的课程行 → 查全部分课堂后加入
    for (const cb of courseCbs) {
        const kcptdm = cb.dataset.kcptdm;
        const kcmc = cb.dataset.kcmc;
        const xklxdm = cb.dataset.xklxdm;
        if (!kcptdm) continue;
        try {
            const d = await apiQueryDetail(kcptdm, xklxdm);
            (d.rows || []).forEach(row => {
                if (grabCourses.some(g => g.kcrwdm === row.kcrwdm)) return;
                grabCourses.push({
                    kcrwdm: row.kcrwdm,
                    kcmc: row.kcmc || kcmc || '',
                    jxbmc: row.jxbmc || '',
                    teaxms: row.teaxms || '',
                    pkrs: parseInt(row.pkrs) || 0,
                    jxbrs: parseInt(row.jxbrs) || 0,
                    xqjc: (row.xqjc || '').substring(0, 30),
                    xklxdm: row._xklxdm || xklxdm || '',
                    kcptdm: kcptdm || '',
                    autoReplace: false,
                });
                count++;
            });
        } catch(e) {
            addLog && addLog('warn', '获取课程[' + kcmc + ']课堂列表失败: ' + e.message);
        }
    }

    if (count) {
        renderGrabList();
        apiSaveGrabList(grabCourses);
        showTmpMsg('已批量加入 ' + count + ' 个课堂');
    } else {
        alert('勾选的课堂已在抢课列表中');
    }
}

function renderGrabList() {
    const tb = document.getElementById('grab-tbody');
    document.getElementById('grab-count').textContent = grabCourses.length + ' 门';
    if (!grabCourses.length) {
        tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无课程</td></tr>';
        return;
    }
    let h = '';
    grabCourses.forEach(g => {
        const hasSlot = parseInt(g.jxbrs) < parseInt(g.pkrs);
        const poolName = POOL_NAMES[g.xklxdm] || g.xklxdm || '';
        h += '<tr>'
            + '<td><strong>' + esc(g.kcmc) + '</strong></td>'
            + '<td>' + esc(g.jxbmc || '') + '</td>'
            + '<td>' + esc(g.teaxms || '') + '</td>'
            + '<td>' + (poolName ? '<span class="badge-status badge-info">' + poolName + '</span>' : '') + '</td>'
            + '<td>' + (g.pkrs || '?') + '/' + (g.jxbrs || '?') + ' '
            + (hasSlot ? '<span class="badge-status badge-success">有名额</span>' : '<span class="badge-status badge-danger">已满</span>') + '</td>'
            + '<td><label class="toggle toggle-sm" onclick="event.stopPropagation()">'
            + '<input type="checkbox" ' + (g.autoReplace ? 'checked' : '') + ' onchange="toggleAutoReplace(\'' + g.kcrwdm + '\')">'
            + '<span class="slider"></span>'
            + '</label></td>'
            + '<td><button class="btn btn-sm btn-danger" onclick="removeGrab(\'' + g.kcrwdm + '\')">移除</button></td>'
            + '</tr>';
    });
    tb.innerHTML = h;
}


// ---------- Auto Grab Cycle ----------

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

    addLog('info', '抢课启动，目标 ' + grabQueue.length + ' 门');
    if (!grabTimer) grabTimer = setInterval(pollGrabStatus, 600);
    runGrabCycle();
}

function stopGrab() {
    grabStop = true;
    addLog('info', '正在停止...');
}

function pollGrabStatus() {
    const prog = document.getElementById('progress-list');
    let h = '';
    grabCourses.forEach(c => {
        const done = grabSucceeded.some(s => s.kcrwdm === c.kcrwdm);
        const skipped = grabSkipped.some(s => s.kcrwdm === c.kcrwdm);
        const trying = grabQueue.some(q => q.kcrwdm === c.kcrwdm);
        let status;
        if (done)        status = '<span class="text-green">已选上</span>';
        else if (skipped) status = '<span class="text-orange">已跳过(冲突)</span>';
        else if (!grabRunning && !trying) status = '<span class="text-red">未成功</span>';
        else             status = '<span class="text-muted">尝试 #' + grabAttempt + '</span>';
        h += '<div class="progress-item"><span class="name">' + esc(c.kcmc) + '</span><span>' + status + '</span></div>';
    });
    prog.innerHTML = h;
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

            const action = await attemptEnroll(course, reqDelay);
            if (action === 'succeeded') continue;
            if (action === 'stopped') { grabStop = true; break; }

            next.push(course);
            if (reqDelay > 0) await sleep(reqDelay);
        }

        grabQueue = next;
        if (grabQueue.length > 0 && !grabStop) await sleep(cycleDelay);
    }

    finishGrab();
}

function finishGrab() {
    if (grabPausedByAuth) {
        addLog('warn', '登录已失效，抢课暂停 — 会话恢复后将自动继续');
    } else if (grabQueue.length === 0 && !grabStop) {
        let msg = '全部完成！成功 ' + grabSucceeded.length + '门';
        if (grabSkipped.length) msg += '，因时间冲突跳过 ' + grabSkipped.length + '门';
        addLog('ok', msg);
    } else if (grabStop) {
        addLog('info', '已停止，成功 ' + grabSucceeded.length + '/' + grabCourses.length + '门');
    }
    grabRunning = false;
    document.getElementById('btn-grab-start').disabled = false;
    document.getElementById('btn-grab-stop').disabled = true;
    document.getElementById('grab-state').textContent = grabPausedByAuth ? '已暂停(登录失效)' : '就绪';
    if (grabTimer) { clearInterval(grabTimer); grabTimer = null; }
}

function resumeGrabIfPaused() {
    if (!grabPausedByAuth || grabRunning) return;
    grabPausedByAuth = false;
    startGrab();
    addLog('ok', '会话已恢复，自动继续抢课');
}

async function attemptEnroll(course, reqDelay) {
    try {
        const d = await apiAddCourse(course.kcrwdm, course.kcmc, course.xklxdm);

        // 成功
        if (d.code >= 0) {
            addLog('ok', '选课成功: ' + course.kcmc);
            grabSucceeded.push(course);
            if (reqDelay > 0) await sleep(reqDelay);
            return 'succeeded';
        }

        // 冲突确认（code=-2），尝试二次确认
        if (d.code === -2) {
            const d2 = await apiAddCourse(course.kcrwdm, course.kcmc, course.xklxdm, true);
            if (d2.code >= 0) {
                addLog('ok', '选课成功(冲突确认): ' + course.kcmc);
                grabSucceeded.push(course);
                if (reqDelay > 0) await sleep(reqDelay);
                return 'succeeded';
            }
        }

        // 登录过期 — 后端已先试过自动续期，这里再补一次手动续期
        if (d.code === -401) {
            const r = await apiRenewSession();
            if (r.code === 0) {
                addLog('ok', '登录已自动续期，继续抢课');
                setLoginStatus(true);
                return 'retry';
            }
            addLog('fail', '登录失效且自动续期失败：' + (r.message || '请重新粘贴 Cookie'));
            grabPausedByAuth = true;
            setLoginStatus(false);
            return 'stopped';
        }

        // 时间冲突 → 按优先级处理
        if (d.message && d.message.includes('上课时间有冲突')) {
            return handleConflict(course, d.message, reqDelay);
        }

        // 其他失败
        addLog('info', '第 ' + grabAttempt + ' 次尝试 [' + course.kcmc + ']: ' + (d.message || ''));
        return 'retry';

    } catch(e) {
        addLog('warn', '请求异常 [' + course.kcmc + ']: ' + e.message);
        return 'retry';
    }
}

async function handleConflict(course, errMsg, reqDelay) {
    const skip = document.getElementById('f-skip-conflict').checked;

    // 优先级1: 跳过冲突（开启跳过时不做替换）
    if (skip) {
        addLog('fail', '跳过 [ ' + course.kcmc + ' ]: ' + errMsg);
        grabSkipped.push(course);
        if (reqDelay > 0) await sleep(reqDelay);
        return 'succeeded';     // 标记为"已完成"(跳过)
    }

    // 优先级2: 自动替换（关闭跳过时，检测有余量才替换）
    if (course.autoReplace) {
        return attemptReplace(course, errMsg, reqDelay);
    }

    // 优先级3: 普通重试
    addLog('info', '第 ' + grabAttempt + ' 次尝试 [' + course.kcmc + '] (冲突中): ' + errMsg);
    return 'retry';
}

async function attemptReplace(course, errMsg, reqDelay) {
    // 查余量
    let hasSlot = false;
    if (course.kcptdm) {
        try {
            const qD = await apiQueryDetail(course.kcptdm, course.xklxdm);
            const target = (qD.rows || []).find(r => r.kcrwdm === course.kcrwdm);
            if (target) hasSlot = parseInt(target.jxbrs || 0) < parseInt(target.pkrs || 0);
        } catch(e) {
            addLog('warn', '查询余量失败: ' + e.message);
        }
    }

    if (!hasSlot) {
        addLog('info', '第 ' + grabAttempt + ' 次尝试 [' + course.kcmc + '] (冲突,无余量): ' + errMsg);
        return 'retry';
    }

    // 有余量，解析冲突课程名
    const conflictMatch = errMsg.match(/与 您的《(.+?)》上课时间有冲突/);
    if (!conflictMatch) {
        addLog('warn', '无法解析冲突课程名，继续重试 [' + course.kcmc + ']');
        return 'retry';
    }

    const conflictName = conflictMatch[1];
    addLog('info', '检测到冲突 [' + conflictName + '] 且目标课有余量，尝试替换');
    let replaced = false;

    try {
        // 从已选课程中精确找到冲突课
        const selD = await apiQuerySelected();
        const conflict = (selD.rows || []).find(ec => ec.kcmc === conflictName);

        if (conflict) {
            // 只退这一门冲突课
            await apiCancelCourse(conflict.kcrwdm, conflict.kcmc, conflict._xklxdm || course.xklxdm || '');

            // 再选目标课
            const aD = await apiAddCourse(course.kcrwdm, course.kcmc, course.xklxdm);
            const ok = aD.code >= 0
                || (aD.code === -2 && (await apiAddCourse(course.kcrwdm, course.kcmc, course.xklxdm, true)).code >= 0);

            if (ok) {
                addLog('ok', '替换成功: ' + course.kcmc + ' (已退 ' + conflictName + ')');
                grabSucceeded.push(course);
                replaced = true;
            }
        } else {
            addLog('warn', '未在已选课程中找到冲突课程 [' + conflictName + ']');
        }
    } catch(e) {
        addLog('warn', '自动替换异常: ' + e.message);
    }

    if (replaced) {
        if (reqDelay > 0) await sleep(reqDelay);
        return 'succeeded';
    }

    addLog('fail', '替换失败，继续重试 [' + course.kcmc + ']');
    return 'retry';
}
