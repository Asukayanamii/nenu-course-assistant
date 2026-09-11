// ===== Constants =====
const POOL_NAMES = {'02':'本部专业','06':'本部公共','07':'净月专业','08':'净月公共'};

// ===== Global State =====
let loginConfig = null;     // 最近一次选课配置（会话状态刷新时复用，避免展示被清空）
let loginState = false;     // 界面上的登录状态，用于与后台会话状态同步
let grabCourses = [];       // {kcrwdm,kcmc,jxbmc,teaxms,pkrs,jxbrs,xqjc,xklxdm,autoReplace,kcptdm}
let grabRunning = false;
let grabTimer = null;
let grabQueue = [];         // courses still being tried this round
let grabSucceeded = [];
let grabSkipped = [];       // courses with time conflicts
let grabAttempt = 0;
let grabStop = false;
let grabPausedByAuth = false;   // 因登录失效暂停，会话恢复后自动继续

// ===== Utilities =====
function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function now() {
    const d = new Date();
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
}

function addLog(type, msg) {
    const el = document.getElementById('status-log');
    const cls = {ok:'ok',fail:'fail',info:'info',warn:'warn'};
    el.innerHTML += '<div><span class="t">['+now()+']</span> <span class="'+(cls[type]||'info')+'">'+esc(msg)+'</span></div>';
    el.scrollTop = el.scrollHeight;
}

function showTmpMsg(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#16a34a;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,0.2)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}
