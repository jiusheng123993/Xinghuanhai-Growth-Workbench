/* ============================================================================
   星河宠记 官网 v2 · 页面交互
   ----------------------------------------------------------------------------
   职责边界：
     · site.js  —— 状态与行为（导航、抽屉、定价切换、游乐区、返回顶部）
     · motion.js —— 纯粹的动效编排（GSAP / ScrollTrigger）
   两边不互相调用，只通过 DOM 状态（class / attribute）沟通，避免循环依赖。
   ============================================================================ */

(function () {
  'use strict';

  var docEl = document.documentElement;

  /* --------------------------------------------------------------------------
     0. 看门狗：保证内容永远可见
     index.html 头部立刻给 <html> 加了 .js，CSS 据此把首屏元素预置为"待入场"。
     如果 GSAP 加载失败或 motion.js 抛错，.motion-ready 就永远不会出现——
     这时必须摘掉 .js，让内容回到默认可见，否则用户会看到一片空白。
     -------------------------------------------------------------------------- */
  var WATCHDOG_MS = 3500;
  window.setTimeout(function () {
    if (!docEl.classList.contains('motion-ready')) {
      docEl.classList.remove('js');
      docEl.classList.add('no-motion');
    }
  }, WATCHDOG_MS);

  /* --------------------------------------------------------------------------
     1. 导航：滚动态 + 移动端抽屉
     -------------------------------------------------------------------------- */
  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  var navDrawer = document.getElementById('navDrawer');

  // 滚动超过 12px 就给导航加毛玻璃底（阈值小一点，避免"滚了半天才变色"）
  var lastStuck = null;
  function syncNavState() {
    var stuck = window.scrollY > 12;
    if (stuck === lastStuck) return;   // 状态没变就不碰 DOM，避免每帧写 class
    lastStuck = stuck;
    if (nav) nav.classList.toggle('is-stuck', stuck);
  }
  window.addEventListener('scroll', syncNavState, { passive: true });
  syncNavState();

  function setDrawer(open) {
    if (!nav || !navDrawer || !navToggle) return;
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    if (open) navDrawer.removeAttribute('hidden');
    else navDrawer.setAttribute('hidden', '');
  }

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      setDrawer(navToggle.getAttribute('aria-expanded') !== 'true');
    });
  }
  // 点抽屉里的链接后自动收起
  if (navDrawer) {
    navDrawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setDrawer(false);
    });
  }
  // Esc 关闭
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setDrawer(false);
  });
  // 视口变宽回到桌面布局时，收起抽屉，避免残留展开状态
  window.addEventListener('resize', function () {
    if (window.innerWidth > 940) setDrawer(false);
  });

  /* --------------------------------------------------------------------------
     2. 会员价格：月付 / 年付切换
     -------------------------------------------------------------------------- */
  var priceToggle = document.getElementById('priceToggle');
  if (priceToggle) {
    var proPrice = document.getElementById('proPrice');
    var proUnit = document.getElementById('proUnit');
    var proNote = document.getElementById('proNote');

    priceToggle.addEventListener('click', function (e) {
      var btn = e.target.closest('.price-toggle__btn');
      if (!btn || !proPrice) return;
      var period = btn.dataset.period;

      // 切换按钮选中态
      priceToggle.querySelectorAll('.price-toggle__btn').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      // 价格取自 data-* ，避免把数字写死在 JS 里（改价只动 HTML）
      var monthly = proPrice.dataset.monthly;
      var yearly = proPrice.dataset.yearly;

      if (period === 'yearly') {
        proPrice.textContent = yearly;
        if (proUnit) proUnit.textContent = '元 / 月（年付）';
        // 注明对比基准，避免「省 50%」「省 60 元」「原价 19.9」三个数字互相打脸
        if (proNote) proNote.textContent = '年付 59 元，比月付省 60 元';
      } else {
        proPrice.textContent = monthly;
        if (proUnit) proUnit.textContent = '元 / 月';
        if (proNote) proNote.textContent = '原价 19.9 元 / 月';
      }

      // 价格数字做一个轻微的强调动画（有 GSAP 才做，没有也不影响功能）
      if (window.gsap) {
        window.gsap.fromTo(proPrice,
          { scale: 0.88, opacity: 0.4 },
          { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)', overwrite: true });
      }
    });
  }

  /* --------------------------------------------------------------------------
     3. 互动游乐区：抛球 → 小狗叼回来
     注意：源视频没有音轨，旧站的"音效开关"是无效控件，本版已删除。
     -------------------------------------------------------------------------- */
  var playBox = document.getElementById('playBox');
  var playBall = document.getElementById('playBall');
  var playIdle = document.getElementById('playIdle');
  var playFetch = document.getElementById('playFetch');

  if (playBox && playBall && playIdle && playFetch) {
    var busy = false;          // 防止连点导致多段动画叠在一起
    var started = false;       // fetch 视频是否已加载过

    // 静音自动播放是否被允许，直接看 play() 的 Promise，不做 UA 猜测
    function tryPlay(video) {
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* 被策略拦下就静默接受 */ });
    }

    // 只在游乐区进入视口时播放 idle，离开就暂停——省电，也避免后台解码
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) tryPlay(playIdle);
          else playIdle.pause();
        });
      }, { threshold: 0.25 }).observe(playBox);
    } else {
      tryPlay(playIdle);
    }

    function throwBall() {
      if (busy) return;
      busy = true;
      playBox.classList.add('is-played');

      if (!started) {
        playFetch.preload = 'auto';
        playFetch.load();
        started = true;
      }

      // 抛球弧线：先上抛再落下，落到画面左侧偏中（小狗在那边）
      var rect = playBox.getBoundingClientRect();
      var endX = -(rect.width * 0.18);

      if (window.gsap) {
        var t = window.gsap.timeline({
          onComplete: function () {
            window.gsap.set(playBall, { x: 0, y: 0, opacity: 1 });
            busy = false;
          },
        });
        t.to(playBall, { x: endX * 0.5, y: -rect.height * 0.52, duration: 0.5, ease: 'power2.out' })
         .to(playBall, { x: endX, y: -rect.height * 0.2, duration: 0.42, ease: 'power2.in' })
         .to(playBall, { opacity: 0, duration: 0.22 }, '-=0.08');
      } else {
        busy = false;   // 没有 GSAP 就不做弧线，直接切视频
      }

      // 切到叼球视频；播完自动切回
      playFetch.currentTime = 0;
      tryPlay(playFetch);
      playFetch.classList.add('is-on');
      playIdle.classList.remove('is-on');

      playFetch.addEventListener('ended', function onEnd() {
        playFetch.removeEventListener('ended', onEnd);
        playFetch.classList.remove('is-on');
        playIdle.classList.add('is-on');
        tryPlay(playIdle);
        // 让用户还能再玩一次
        window.setTimeout(function () { playBox.classList.remove('is-played'); }, 1200);
      });
    }

    playBox.addEventListener('click', throwBall);
    // 键盘可达：回车/空格等同点击（role=button 的元素必须响应）
    playBox.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        throwBall();
      }
    });
  }

  /* --------------------------------------------------------------------------
     4. 返回顶部
     -------------------------------------------------------------------------- */
  var toTop = document.getElementById('toTop');
  if (toTop) {
    var lastOn = null;
    function syncTopBtn() {
      var on = window.scrollY > window.innerHeight * 0.8;
      if (on === lastOn) return;
      lastOn = on;
      toTop.classList.toggle('is-on', on);
    }
    window.addEventListener('scroll', syncTopBtn, { passive: true });
    syncTopBtn();

    toTop.addEventListener('click', function () {
      // 尊重"减少动态效果"：直接跳，不做平滑滚动
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* --------------------------------------------------------------------------
     5. 锚点平滑滚动
     CSS 的 scroll-behavior: smooth 无法被 prefers-reduced-motion 自动关掉，
     这里在减少动效时显式改成 auto，避免前庭不适用户被"滑"一路。
     -------------------------------------------------------------------------- */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    docEl.style.scrollBehavior = 'auto';
  }
})();
