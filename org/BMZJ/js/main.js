// 北梦之镜 官网交互脚本
(function () {
  const D = window.BMZJ_DATA;

  // 渲染品牌网格
  function renderBrands() {
    const grid = document.getElementById('brand-grid');
    if (!grid || !D) return;
    grid.innerHTML = D.brands.map(b => `
      <div class="brand-item">
        <div class="brand-zh">${b.zh}</div>
        <div class="brand-en">${b.en}</div>
        <div class="brand-meta">${b.models} 机型 · ${b.packages.toLocaleString()} 链接</div>
      </div>
    `).join('');
  }

  // 渲染机型/官方包明细表
  function renderTable() {
    const wrap = document.getElementById('catalog-table');
    if (!wrap || !D) return;
    const rows = D.brands.map(b => `
      <tr>
        <td>${b.zh}</td>
        <td>${b.en}</td>
        <td>${b.models.toLocaleString()}</td>
        <td>${b.packages.toLocaleString()}</td>
      </tr>
    `).join('');
    wrap.innerHTML = `
      <table class="catalog-table">
        <thead>
          <tr><th>品牌</th><th>Brand</th><th>收录机型</th><th>官方 ROM 直链</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><th colspan="2">合计</th><th>${D.totalModels.toLocaleString()}</th><th>${D.totalPackages.toLocaleString()}</th></tr>
        </tfoot>
      </table>
    `;
  }

  // 统计数字滚动
  function animateStat(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const t = parseInt(target, 10);
    const dur = 1200;
    const start = performance.now();
    function step(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(t * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // 滚动进入视口时触发统计动画
  function observeStats() {
    const sec = document.getElementById('catalog');
    if (!sec) return;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            animateStat('stat-brands', D.totalModels ? D.brands.length : 15);
            animateStat('stat-models', D.totalModels);
            animateStat('stat-packages', D.totalPackages);
            io.disconnect();
          }
        });
      }, { threshold: 0.3 });
      io.observe(sec);
    }
  }

  // 导航栏滚动阴影
  function navShadow() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    });
  }

  // 进入视口淡入动画
  function revealOnScroll() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach(el => io.observe(el));
    // 兜底：加载后强制显示，避免个别环境下 IntersectionObserver 未触发导致内容不可见
    setTimeout(() => {
      els.forEach(el => el.classList.add('is-visible'));
    }, 2500);
  }

  // 平滑滚动
  function smoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (id === '#') return;
        const target = document.querySelector(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  // 服务状态实时检测（每 30 秒自动刷新）
  function setupStatusCheck() {
    const timeEl = document.getElementById('status-check-time');
    const cards = document.querySelectorAll('.status-card');
    if (!timeEl || !cards.length) return;

    const isLocalPreview =
      location.protocol === 'file:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';

    function fmtTime() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    // 检测单个 URL：可达 = 在线
    function checkUrl(url) {
      return new Promise((resolve) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        fetch(url + '?_=' + Date.now(), {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          credentials: 'omit'
        })
          .then(() => { clearTimeout(timer); resolve(true); })
          .catch(() => { clearTimeout(timer); resolve(false); });
      });
    }

    function setCardState(card, online) {
      const dot = card.querySelector('.status-dot');
      const badge = card.querySelector('.status-badge');
      if (!dot || !badge) return;
      if (online) {
        dot.classList.remove('offline');
        dot.classList.add('online');
        badge.textContent = '在线';
        badge.classList.remove('down');
        badge.classList.add('ok');
      } else {
        dot.classList.remove('online');
        dot.classList.add('offline');
        badge.textContent = '离线';
        badge.classList.remove('ok');
        badge.classList.add('down');
      }
    }

    async function checkAll() {
      // 本地预览环境无法跨域检测，模拟在线（部署到正式域名后走真实检测）
      if (isLocalPreview) {
        cards.forEach(card => setCardState(card, true));
      } else {
        const results = await Promise.all(
          Array.from(cards).map(card => {
            const url = card.getAttribute('data-url');
            return url ? checkUrl(url) : Promise.resolve(true);
          })
        );
        results.forEach((online, i) => {
          if (cards[i]) setCardState(cards[i], online);
        });
      }
      timeEl.textContent = '上次检查时间：' + fmtTime();
    }

    checkAll();
    setInterval(checkAll, 30000);
  }

  // 回到顶部按钮
  function backToTop() {
    const btn = document.getElementById('back-top');
    if (!btn) return;
    window.addEventListener('scroll', () => {
      if (window.scrollY > 600) btn.classList.add('show');
      else btn.classList.remove('show');
    }, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderBrands();
    renderTable();
    observeStats();
    navShadow();
    revealOnScroll();
    smoothScroll();
    setupStatusCheck();
    backToTop();
  });
})();
