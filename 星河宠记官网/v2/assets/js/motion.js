/* ============================================================================
   星河宠记 官网 v2 · GSAP 动效编排
   ----------------------------------------------------------------------------
   设计原则（每条都对应一个具体决策，不是套话）：
     1. 只动 transform 与 opacity —— 这两个属性跳过 layout/paint，走 GPU 合成。
        绝不动 width/height/top/left（会触发重排，掉帧）。
     2. 缓动不用 CSS 内置的 ease-out（太弱、动作发飘），统一用强曲线：
        进场 power3.out / 屏内位移 power2.inOut / 滚动关联用 none（必须 1:1 跟手）。
     3. 时长分档：UI 反馈 <300ms；营销区块的入场与叙事允许更长（本页 0.5–0.9s）。
     4. 无 `scale(0)`：进场一律从 0.94~0.97 起，现实里没有东西从"无"里长出来。
     5. 尊重 prefers-reduced-motion：只保留透明度变化，去掉全部位移与缩放。
     6. 所有 ScrollTrigger 按页面从上到下的顺序创建，避免 pin 的刷新顺序错乱。
   ============================================================================ */

(function () {
  'use strict';

  var docEl = document.documentElement;

  /* --------------------------------------------------------------------------
     0. 守卫：GSAP 没加载成功时，立刻摘掉 .js 标记
     这样首屏那些"待入场"的元素会恢复默认可见，页面不会变成一片空白。
     -------------------------------------------------------------------------- */
  if (!window.gsap || !window.ScrollTrigger) {
    docEl.classList.remove('js');
    return;
  }

  var gsap = window.gsap;
  var ScrollTrigger = window.ScrollTrigger;

  // 插件只需注册一次，且必须在任何 ScrollTrigger 用法之前
  gsap.registerPlugin(ScrollTrigger);

  // 全局默认：统一缓动与时长基准，避免每处重复写
  gsap.defaults({ ease: 'power2.out', duration: 0.6 });

  // 图片加载完后布局会变，必须让 ScrollTrigger 重新计算触发位置
  // （视口 resize 是自动处理的，动态内容不是）
  window.addEventListener('load', function () {
    ScrollTrigger.refresh();
  });

  var mm = gsap.matchMedia();

  /* ==========================================================================
     A. 减少动态效果分支
     不做位移/缩放，只把内容摆到最终态，并让数字直接显示终值。
     注意：是"更少更温和"，不是"全关"——这样既照顾前庭不适用户，
     也不会因为动画不跑而让内容缺失。
     ========================================================================== */
  mm.add('(prefers-reduced-motion: reduce)', function () {
    gsap.set('[data-m="hero-item"], [data-m="hero-card"], [data-m="reveal"]', { opacity: 1 });

    // ⚠️ 这里**绝不能**用 clearProps:'transform'（2026-09-11 审-1 实测复现的真 bug）：
    // clearProps 会把内联 transform 整个清掉，于是样式表里
    //   .js [data-m="hero-title"] .line__in { transform: translateY(105%) }
    // 重新生效，标题被顶出遮罩 75.5px —— 系统开了「减少动态效果」的用户，
    // 首屏主标题整句看不见。
    // 正确做法是**写一个内联 transform 把它压住**（用高特异性 CSS 覆盖没用，因为内联那时是空的）。
    gsap.set('.hero__title .line__in', { transform: 'none' });

    gsap.utils.toArray('[data-m="counter"]').forEach(function (el) {
      el.textContent = el.dataset.to || el.textContent;
    });

    docEl.classList.add('motion-ready');
  });

  /* ==========================================================================
     B. 完整动效分支
     ========================================================================== */
  mm.add('(prefers-reduced-motion: no-preference)', function () {

    /* ------------------------------------------------------------------------
       B1. 首屏入场编排
       目的：Explanation（首次访问的营销解释）。这是"罕见/首次"档，
       所以这里是全站唯一允许用较长时长与轻微过冲的地方。
       ------------------------------------------------------------------------ */
    var heroTl = gsap.timeline({ delay: 0.12 });

    // 标题行的初始位移：
    // CSS 里预置的是 `transform: translateY(105%)`（百分比），而 GSAP 读到的计算值是 px 矩阵，
    // 若只写 yPercent 会跟残留的 y(px) 叠加，导致文字推不回来。
    // 所以这里把 y 显式归零，让位移**只**由 yPercent 表达。
    gsap.set('.hero__title .line__in', { yPercent: 105, y: 0 });

    heroTl
      // 眉题先到，给标题一个"引子"
      .to('.hero .eyebrow', { opacity: 1, y: 0, duration: 0.55 }, 0)
      // 标题逐行从遮罩下方推上来——这是首屏最主要的视觉动作
      .to('.hero__title .line__in', {
        yPercent: 0,
        duration: 0.85,
        ease: 'power3.out',
        stagger: 0.1,
      }, 0.06)
      .to('.hero__desc', { opacity: 1, y: 0, duration: 0.6 }, 0.34)
      .to('.hero__cta', { opacity: 1, y: 0, duration: 0.6 }, 0.46)
      // 主视觉用 scale 轻微推近 + 淡入，比单纯淡入更有"登场"感
      .fromTo('.hero__visual', { opacity: 0, scale: 0.965 }, {
        opacity: 1, scale: 1, duration: 0.9, ease: 'power3.out',
      }, 0.2)
      // 浮动卡错峰弹入，用 back.out 给一点点过冲（唯一的"俏皮"点）
      .fromTo('.float-card', { opacity: 0, y: 18, scale: 0.94 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)', stagger: 0.1,
      }, 0.62);

    // 首屏内联样式里没有 y 的初始值，这里补上，避免 .to() 从当前的 0 开始"跳"
    gsap.set(['.hero .eyebrow', '.hero__desc', '.hero__cta'], { y: 14 });

    /* ------------------------------------------------------------------------
       B2. 数字滚动
       目的：State indication —— 让"连续 28 天""156 条记忆"这两个数字有分量。
       ------------------------------------------------------------------------ */
    gsap.utils.toArray('[data-m="counter"]').forEach(function (el) {
      var target = Number(el.dataset.to) || 0;
      var box = { v: 0 };
      gsap.to(box, {
        v: target,
        duration: 1.1,
        ease: 'power2.out',
        delay: 0.9,
        onUpdate: function () { el.textContent = String(Math.round(box.v)); },
        onComplete: function () { el.textContent = String(target); },
      });
    });

    /* ------------------------------------------------------------------------
       B3. 浮动卡常驻呼吸
       目的：Delight。营销页允许；幅度必须小（6–9px）、周期必须慢（3.5s+），
       否则会变成"抢注意力"的抖动。
       ------------------------------------------------------------------------ */
    gsap.utils.toArray('.float-card').forEach(function (card, i) {
      gsap.to(card, {
        y: i % 2 === 0 ? -9 : -7,
        duration: 3.5 + i * 0.4,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        delay: 1.6 + i * 0.2,
      });
    });

    /* ------------------------------------------------------------------------
       B4. 背景光斑缓慢漂浮
       目的：Explanation（氛围）。用 xPercent/yPercent 而非 x/y，随视口自适应。
       ------------------------------------------------------------------------ */
    gsap.utils.toArray('[data-m="float"]').forEach(function (glow) {
      var span = Number(glow.dataset.speed) || 12;
      gsap.to(glow, {
        xPercent: span,
        yPercent: -span * 0.6,
        duration: 9,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });

    /* ------------------------------------------------------------------------
       B5. 通用入场揭示
       目的：Preventing a jarring change —— 内容不是"砰"地出现，而是滑到位。
       用 ScrollTrigger.batch 而非 IntersectionObserver：同一时刻进入视口的元素
       会被合并成一个批次，从而可以做统一 stagger，而不是各动各的。
       once: true —— 回滚上去不重播，避免用户来回滚动时内容反复闪。
       ------------------------------------------------------------------------ */
    ScrollTrigger.batch('[data-m="reveal"]', {
      start: 'top 86%',
      once: true,
      onEnter: function (batch) {
        gsap.fromTo(batch,
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.09, overwrite: true });
      },
    });

    // 取名卡片：单独一批，错峰更细
    ScrollTrigger.batch('[data-m="stagger-item"]', {
      start: 'top 88%',
      once: true,
      onEnter: function (batch) {
        gsap.fromTo(batch,
          { opacity: 0, y: 22, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out', stagger: 0.07, overwrite: true });
      },
    });

    /* ------------------------------------------------------------------------
       B6. 记忆引擎：钉住 + scrub 对比
       目的：Explanation。把"无记忆 vs 有记忆"的差异做成一段可被滚动"读"的叙事，
       用户滚得越多，右边亮起的条目越多——这是在用动效讲产品差异，不是装饰。
       注意：pin 要求滚动容器不能是 overflow:hidden，
       所以 body 用的是 overflow-x: clip（见 site.css）。
       ------------------------------------------------------------------------ */
    var compareTl = gsap.timeline({
      scrollTrigger: {
        // 用 data-m 钩子而不是 #memory —— 全站动效一律走 data-m，保持一致
        trigger: '[data-m="pin-compare"]',
        start: 'top top',
        end: '+=65%',      // 钉住约 0.65 屏的滚动距离
        pin: true,
        scrub: 0.6,        // 数值 = 追赶延迟（秒），比 true 更有"重量感"
        anticipatePin: 1,  // 提前一帧应用 pin，消除进入时的轻微跳动
      },
    });

    compareTl
      // 左边：逐条褪色，表示"这些是老做法"
      .fromTo('.compare__col--bad .compare__item',
        { opacity: 1 },
        { opacity: 0.3, duration: 0.7, stagger: 0.3 }, 0)
      // 右边：逐条从暗淡里亮起来
      .fromTo('.compare__col--good .compare__item',
        { opacity: 0.18, y: 12 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.3 }, 0.18);

    /* ------------------------------------------------------------------------
       B7. 配图视差
       目的：Explanation（空间纵深）。幅度按 data-speed 给，取 ±26px 以内——
       再大就会让人觉得"图没对齐"，反而显得廉价。
       ease: 'none' 是滚动关联动画的硬性要求，否则位置和滚动进度对不上。
       ------------------------------------------------------------------------ */
    gsap.utils.toArray('[data-m="parallax"]').forEach(function (el) {
      var speed = Number(el.dataset.speed) || -24;
      gsap.fromTo(el,
        { y: -speed * 0.5 },
        {
          y: speed * 0.5,
          ease: 'none',
          scrollTrigger: {
            trigger: el,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        });
    });

    /* ------------------------------------------------------------------------
       B8. 对话序列（功能区块 01）
       ------------------------------------------------------------------------ */
    gsap.fromTo('[data-m="chat-seq"]',
      { opacity: 0, y: 16 },
      {
        opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.14,
        scrollTrigger: { trigger: '.chat', start: 'top 78%', once: true },
      });

    /* ------------------------------------------------------------------------
       B9. 手机 mock：气泡逐条"打字"出现
       这里刻意用 scrub（跟手）而不是 once（播一次）：
       用户慢慢往下滚，气泡一条条出现，像对话正在发生。
       ------------------------------------------------------------------------ */
    gsap.fromTo('[data-m="phone-seq"]',
      { opacity: 0, y: 14 },
      {
        opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.35,
        scrollTrigger: {
          trigger: '[data-m="phone"]',
          start: 'top 72%',
          end: 'bottom 62%',
          scrub: 0.5,
        },
      });

    /* ------------------------------------------------------------------------
       B10. 时间线：横线扫过 + 节点依次亮起
       线的进度通过 CSS 变量 --tl-x 驱动（::before 伪元素无法被 GSAP 直接选中）。
       竖屏时同一条 CSS 规则换成 scaleY，变量名不变。
       ------------------------------------------------------------------------ */
    var tlSection = document.querySelector('[data-m="timeline"]');
    var tlEl = tlSection ? tlSection.querySelector('.tl') : null;
    if (tlEl && tlSection) {
      gsap.fromTo(tlEl,
        { '--tl-x': 0 },
        {
          '--tl-x': 1,
          ease: 'none',
          scrollTrigger: {
            trigger: tlSection,
            start: 'top 78%',
            end: 'bottom 68%',
            scrub: 0.5,
          },
        });

      gsap.fromTo('.tl__item',
        { opacity: 0, y: 20 },
        {
          opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', stagger: 0.14,
          scrollTrigger: { trigger: tlSection, start: 'top 80%', once: true },
        });
    }

    /* ------------------------------------------------------------------------
       B11. 常见问题：展开动画
       <details> 原生是瞬间展开的，会"跳"。这里给答案区做高度过渡。
       折手风琴是 height 动画被允许的唯一场景（没有 transform 等价物）。
       ------------------------------------------------------------------------ */
    gsap.utils.toArray('.faq__item').forEach(function (item) {
      var answer = item.querySelector('.faq__a');
      if (!answer) return;

      item.addEventListener('toggle', function () {
        // 刻意**不设** "正在动画中" 的布尔守卫：那会**丢掉**快速连点时的事件，
        // 留下残留内联样式（实测残留 opacity:1）和错误的展开高度（138px vs 完整 219px）。
        // 改用 killTweensOf 直接打断上一段 —— GSAP 本来就能从当前中间态接着走。
        gsap.killTweensOf(answer);

        if (item.open) {
          gsap.fromTo(answer,
            { height: 0, opacity: 0 },
            {
              height: 'auto', opacity: 1, duration: 0.32, ease: 'power2.out',
              // 收尾清掉内联高度，让内容自然撑开（否则窗口缩放后高度会僵在旧值）
              onComplete: function () { gsap.set(answer, { clearProps: 'height' }); },
            });
        } else {
          // 收起交给原生行为：<details> 一关内容立即隐藏，对隐藏元素做高度动画没有意义。
          // 这里只需保证不留上一段动画的内联残留。
          gsap.set(answer, { clearProps: 'height,opacity' });
        }
      });
    });

    docEl.classList.add('motion-ready');
  });

  /* ==========================================================================
     C. 收尾
     ========================================================================== */
  // 刻意**不在这里**无条件打 motion-ready（审-1 指出原写法让看门狗形同虚设）：
  // site.js 的看门狗靠"3.5 秒后仍没有 motion-ready"来判断动效初始化失败，
  // 若这里无条件打上，任何分支抛错都会被掩盖成"一切正常"。
  // motion-ready 只由上面两个 matchMedia 分支各自在成功跑完后打。
})();
