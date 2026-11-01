// 北梦之镜 · 用户面板登录逻辑（安全版 · PBKDF2 加盐高强度）
// 前端只读取预生成的校验文件 BMZJ3383603143.bin（密码/激活码均为「独立盐 + PBKDF2」加盐结果），
// 不包含 Fernet 密钥、不包含任何明文密码、不包含原始密码哈希，无法还原 404.dat。
// 校验链路：verify = PBKDF2-HMAC-SHA256(salt, sha256(输入), iterations)
(function () {
  'use strict';

  // 校验文件位置（由本地脚本从 404.dat 生成，PBKDF2 加盐）
  // 用户面板位于 org/BMZJ/user-panel/，校验文件在 org/，故向上两级
  var USERS_URL = '../../BMZJ3383603143.bin';

  // 迭代次数兜底（校验文件里 iterations 优先）
  var DEFAULT_ITERATIONS = 300000;

  // ---------- 工具函数 ----------
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return hex;
  }

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  function sha256Hex(str) {
    var data = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return bytesToHex(new Uint8Array(buf));
    });
  }

  // PBKDF2-HMAC-SHA256：password 为 hex 字符串，salt 为 hex 字符串，返回 32 字节 hex
  function pbkdf2Hex(saltHex, passwordHex, iterations) {
    var pwBytes = new TextEncoder().encode(passwordHex);
    var saltBytes = hexToBytes(saltHex);
    return crypto.subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' },
          key,
          256
        );
      })
      .then(function (bits) {
        return bytesToHex(new Uint8Array(bits));
      });
  }

  // 计算 verify = PBKDF2(salt, sha256(输入), iterations)
  async function calcVerify(saltHex, iterations, input) {
    var material = await sha256Hex(input);
    return pbkdf2Hex(saltHex, material, iterations);
  }

  // ---------- 拉取校验文件 ----------
  var cachedUsers = null;
  async function fetchUsers() {
    if (cachedUsers) return cachedUsers;
    var resp = await fetch(USERS_URL + '?_=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
    if (!resp.ok) throw new Error('服务器返回异常（' + resp.status + '）');
    cachedUsers = await resp.json();
    return cachedUsers;
  }

  // ---------- 到期解析（与主程序 _parse_expire 一致） ----------
  function parseExpire(item) {
    var exp = (item && item.expire) || '';
    if (exp === '' || exp === '永久' || exp === '无限制' || exp === 'permanent' ||
        exp === 'Permanent' || exp === null || exp === 0 || exp === '0') {
      return { expired: false, ts: 0 };
    }
    var ts = parseInt(exp, 10);
    if (isNaN(ts) || ts <= 0) return { expired: false, ts: 0 };
    return { expired: (Date.now() / 1000) > ts, ts: ts };
  }

  // ---------- DOM 元素 ----------
  var loginView = document.getElementById('login-view');
  var infoView = document.getElementById('info-view');
  var accountForm = document.getElementById('account-form');
  var codeForm = document.getElementById('code-form');
  var usernameInput = document.getElementById('username');
  var passwordInput = document.getElementById('password');
  var codeInput = document.getElementById('code-input');
  var loginError = document.getElementById('login-error');
  var loginLoading = document.getElementById('login-loading');
  var accountSubmitBtn = document.getElementById('account-submit');
  var codeSubmitBtn = document.getElementById('code-submit');
  var logoutBtn = document.getElementById('logout-btn');

  var infoUsername = document.getElementById('info-username');
  var infoStatus = document.getElementById('info-status');
  var infoUserType = document.getElementById('info-user-type');
  var infoLimitType = document.getElementById('info-limit-type');
  var infoExpire = document.getElementById('info-expire');
  var infoRemaining = document.getElementById('info-remaining');

  var countdownTimer = null;

  function showError(msg) {
    loginError.textContent = msg || '';
  }

  function setLoading(on) {
    loginLoading.hidden = !on;
    accountSubmitBtn.disabled = on;
    codeSubmitBtn.disabled = on;
  }

  // ---------- 显示用户信息 ----------
  function formatRemaining(ts) {
    if (!ts || ts <= 0) return '∞ 无限制';
    var sec = ts - Math.floor(Date.now() / 1000);
    if (sec <= 0) return '已过期';
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var parts = [];
    if (d > 0) parts.push(d + '天');
    if (h > 0 || d > 0) parts.push(h + '时');
    parts.push(m + '分');
    parts.push(s + '秒');
    return parts.join(' ');
  }

  function formatExpire(ts) {
    if (!ts || ts <= 0) return '永久';
    var d = new Date(ts * 1000);
    var pad = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function showInfo(item, name) {
    var p = parseExpire(item);
    var userType = item.user_type || '—';
    var limitType = item.limit_type || '—';

    loginView.hidden = true;
    infoView.hidden = false;

    infoUsername.textContent = name || '普通用户';

    infoStatus.textContent = p.expired ? '已过期' : '正常';
    infoStatus.className = 'account-status-badge ' + (p.expired ? 'expired' : 'active');

    infoUserType.textContent = userType;
    infoLimitType.textContent = limitType;
    infoExpire.textContent = formatExpire(p.ts);

    function updateRemaining() {
      var remain = formatRemaining(p.ts);
      infoRemaining.textContent = remain;
      infoRemaining.className = 'info-value' + (p.ts > 0 ? ' highlight' : '');
    }
    updateRemaining();
    if (countdownTimer) clearInterval(countdownTimer);
    if (p.ts > 0 && !p.expired) {
      countdownTimer = setInterval(updateRemaining, 1000);
    }

    try {
      sessionStorage.setItem('bmzj_login', JSON.stringify({ name: name, item: item }));
    } catch (e) {}
  }

  function restoreSession() {
    try {
      var s = sessionStorage.getItem('bmzj_login');
      if (!s) return false;
      var obj = JSON.parse(s);
      showInfo(obj.item, obj.name);
      return true;
    } catch (e) {
      return false;
    }
  }

  function logout() {
    try { sessionStorage.removeItem('bmzj_login'); } catch (e) {}
    if (countdownTimer) clearInterval(countdownTimer);
    infoView.hidden = true;
    loginView.hidden = false;
    showError('');
  }

  // ---------- 账号登录（PBKDF2 加盐比对） ----------
  async function loginAccount(username, password) {
    if (!username.trim()) { showError('请输入用户名'); return; }
    if (!password) { showError('请输入密码'); return; }
    setLoading(true);
    showError('');
    try {
      var data = await fetchUsers();
      var accounts = (data && data.accounts) || [];
      var iterations = (data && data.iterations) || DEFAULT_ITERATIONS;

      // 先按用户名定位账号，只对命中项做一次 PBKDF2（省时）
      var acc = null;
      for (var i = 0; i < accounts.length; i++) {
        if (accounts[i].username === username) { acc = accounts[i]; break; }
      }
      if (!acc) { showError('用户名或密码错误'); setLoading(false); return; }

      var verify = await calcVerify(acc.salt, iterations, password);
      if (verify.toLowerCase() === (acc.verify || '').toLowerCase()) {
        var p = parseExpire(acc);
        if (p.expired) {
          showError('账号已到期，请联系管理员续期');
          setLoading(false);
          return;
        }
        showInfo(acc, username);
        setLoading(false);
        return;
      }
      showError('用户名或密码错误');
    } catch (e) {
      showError('无法连接到服务器，请检查您的网络');
      console.error(e);
    }
    setLoading(false);
  }

  // ---------- 激活码登录（PBKDF2 加盐比对） ----------
  async function loginCode(code) {
    if (!code.trim()) { showError('请输入激活码'); return; }
    setLoading(true);
    showError('');
    try {
      var data = await fetchUsers();
      var codes = (data && data.codes) || [];
      var accounts = (data && data.accounts) || [];
      var iterations = (data && data.iterations) || DEFAULT_ITERATIONS;

      // 匹配独立激活码列表
      for (var i = 0; i < codes.length; i++) {
        var verify = await calcVerify(codes[i].salt, iterations, code);
        if (verify.toLowerCase() === (codes[i].verify || '').toLowerCase()) {
          var p = parseExpire(codes[i]);
          if (p.expired) { showError('激活码已到期，请联系管理员续期'); setLoading(false); return; }
          showInfo(codes[i], '普通用户');
          setLoading(false);
          return;
        }
      }
      // 匹配账号的 code_verify / verify / username
      for (var j = 0; j < accounts.length; j++) {
        var acc = accounts[j];
        var codeVerify = acc.code_verify || '';
        var pwdVerify = acc.verify || '';
        var codeHash = null;
        if (codeVerify) {
          codeHash = await calcVerify(acc.code_salt, iterations, code);
          if (codeHash.toLowerCase() === codeVerify.toLowerCase()) {
            var pe = parseExpire(acc);
            if (pe.expired) { showError('该账号已到期，请联系管理员续期'); setLoading(false); return; }
            showInfo(acc, acc.username);
            setLoading(false);
            return;
          }
        }
        if (acc.username === code) {
          var pe2 = parseExpire(acc);
          if (pe2.expired) { showError('该账号已到期，请联系管理员续期'); setLoading(false); return; }
          showInfo(acc, acc.username);
          setLoading(false);
          return;
        }
      }
      showError('激活码无效');
    } catch (e) {
      showError('无法连接到服务器，请检查您的网络');
      console.error(e);
    }
    setLoading(false);
  }

  // ---------- Tab 切换 ----------
  var tabs = document.querySelectorAll('.account-tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var which = tab.getAttribute('data-tab');
      accountForm.hidden = (which !== 'account');
      codeForm.hidden = (which !== 'code');
      showError('');
    });
  });

  // ---------- 事件绑定 ----------
  accountForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginAccount(usernameInput.value, passwordInput.value);
  });
  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginCode(codeInput.value);
  });
  logoutBtn.addEventListener('click', logout);

  // ---------- 初始化 ----------
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    showError('当前环境不支持安全校验，请通过 https 访问');
  } else {
    if (!restoreSession()) {
      loginView.hidden = false;
    }
  }
})();
