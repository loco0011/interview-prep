(function () {
  'use strict';

  const PB = window.PLAYBOOK;
  const TOPICS = PB.topics;
  const byId = Object.fromEntries(TOPICS.map((t) => [t.id, t]));
  const QINDEX = {}; // question id -> { q, topic }
  TOPICS.forEach((t) => t.sections.forEach((s) => s.qs.forEach((q) => (QINDEX[q.id] = { q, topic: t }))));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = $('#view');
  const root = document.documentElement;

  /* ---------------- storage (safe) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pb:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const learned = new Set(store.get('learned', []));
  const saveLearned = () => store.set('learned', Array.from(learned));

  const filters = Object.assign({ level: 'all', hot: false, hideLearned: false }, store.get('filters', {}));
  const saveFilters = () => store.set('filters', filters);

  /* ---------------- helpers ---------------- */
  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hotIn = (t) => t.sections.reduce((n, s) => n + s.qs.filter((q) => q.hot).length, 0);
  const LEVEL = { basic: 'Basic', mid: 'Mid', senior: 'Senior' };
  const learnedIn = (t) => t.sections.reduce((n, s) => n + s.qs.filter((q) => learned.has(q.id)).length, 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const TOTAL = TOPICS.reduce((n, t) => n + t.count, 0);

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function setAccent(color) {
    root.style.setProperty('--t', color);
  }

  /* ---------------- theme ---------------- */
  const themeBtn = $('#themeBtn');
  const MODES = ['system', 'light', 'dark'];
  function applyTheme(mode) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    themeBtn.dataset.mode = mode;
    themeBtn.title = 'Theme: ' + mode;
  }
  let themeMode = store.get('theme', 'system');
  applyTheme(themeMode);
  themeBtn.addEventListener('click', () => {
    themeMode = MODES[(MODES.indexOf(themeMode) + 1) % MODES.length];
    applyTheme(themeMode);
    store.set('theme', themeMode);
    toast('Theme: ' + themeMode);
  });

  /* ---------------- header height (for sticky offsets) ---------------- */
  const topbar = $('.topbar');
  function measureHeader() {
    root.style.setProperty('--header-h', topbar.offsetHeight + 'px');
  }
  if ('ResizeObserver' in window) new ResizeObserver(measureHeader).observe(topbar);
  window.addEventListener('resize', measureHeader);

  /* ---------------- tabs ---------------- */
  const tabsEl = $('#tabs');
  function renderTabs() {
    const home = `<button class="tab" role="tab" data-route="home" style="--c:var(--brand)">Overview</button>`;
    tabsEl.innerHTML =
      home +
      TOPICS.map(
        (t) =>
          `<button class="tab" role="tab" data-route="${t.id}" style="--c:${t.color}">${escHtml(t.short)}<span class="tab-count">${t.count}</span></button>`
      ).join('') +
      '<span class="tab-ind" id="tabInd"></span>';
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      clearSearch();
      go(b.dataset.route);
    });
  }
  function markTab(routeId) {
    let active = null;
    $$('.tab', tabsEl).forEach((b) => {
      const on = b.dataset.route === routeId;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) active = b;
    });
    const ind = $('#tabInd');
    if (active && ind) {
      ind.style.width = active.offsetWidth + 'px';
      ind.style.transform = `translateX(${active.offsetLeft}px)`;
      ind.style.opacity = '1';
      const left = active.offsetLeft - tabsEl.clientWidth / 2 + active.offsetWidth / 2;
      tabsEl.scrollTo({ left, behavior: 'smooth' });
    } else if (ind) ind.style.opacity = '0';
  }

  /* ---------------- tab strip arrows ---------------- */
  const tabsPrev = $('#tabsPrev');
  const tabsNext = $('#tabsNext');
  function updateTabArrows() {
    const max = tabsEl.scrollWidth - tabsEl.clientWidth;
    const wraps = getComputedStyle(tabsEl).flexWrap === 'wrap';
    tabsPrev.hidden = wraps || tabsEl.scrollLeft <= 4;
    tabsNext.hidden = wraps || tabsEl.scrollLeft >= max - 4;
  }
  tabsPrev.addEventListener('click', () => tabsEl.scrollBy({ left: -tabsEl.clientWidth * 0.7, behavior: 'smooth' }));
  tabsNext.addEventListener('click', () => tabsEl.scrollBy({ left: tabsEl.clientWidth * 0.7, behavior: 'smooth' }));
  tabsEl.addEventListener('scroll', updateTabArrows, { passive: true });
  /* mouse wheel over the strip scrolls it sideways */
  tabsEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || tabsEl.scrollWidth <= tabsEl.clientWidth) return;
    e.preventDefault();
    tabsEl.scrollBy({ left: e.deltaY, behavior: 'instant' });
  }, { passive: false });
  window.addEventListener('resize', updateTabArrows);
  if ('ResizeObserver' in window) new ResizeObserver(updateTabArrows).observe(tabsEl);

  /* ---------------- routing ---------------- */
  let current = { name: null };
  function go(id) {
    if (location.hash === '#' + id) route();
    else location.hash = id;
  }
  function parseHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h || h === 'home') return { name: 'home' };
    if (byId[h]) return { name: 'topic', topic: byId[h] };
    if (QINDEX[h]) return { name: 'topic', topic: QINDEX[h].topic, open: h };
    return { name: 'home' };
  }
  function route() {
    const r = parseHash();
    if (r.name === 'home') renderHome();
    else {
      const same = current.name === 'topic' && current.topic === r.topic;
      if (!same) renderTopic(r.topic);
      if (r.open) openQuestion(r.open, true);
      else if (!same) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      store.set('last', r.topic.id);
    }
  }

  /* ---------------- home ---------------- */
  function renderHome() {
    current = { name: 'home' };
    root.style.removeProperty('--t');
    markTab('home');
    const done = learned.size;
    const hot = TOPICS.reduce((n, t) => n + t.sections.reduce((m, s) => m + s.qs.filter((q) => q.hot).length, 0), 0);
    const last = byId[store.get('last', '')];
    view.innerHTML = `
      <section class="wrap home-top">
        <div class="home-bar glass">
          <div class="home-stats">
            <div class="stat"><b>${TOTAL}</b><span>questions</span></div>
            <div class="stat"><b>${TOPICS.length}</b><span>topics</span></div>
            <div class="stat"><b>${hot}</b><span>asked often</span></div>
            <div class="stat"><b>${pct(done, TOTAL)}%</b><span>learned</span></div>
          </div>
          <div class="home-actions">
            <button class="btn dark sm" type="button" id="randomAll"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5v14l11-7z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>Random question</button>
            ${last ? `<a class="btn primary sm" href="#${last.id}">Continue with ${escHtml(last.short)} →</a>` : `<a class="btn primary sm" href="#${TOPICS[0].id}">Start with ${escHtml(TOPICS[0].short)} →</a>`}
          </div>
        </div>
        <div class="legend">
          <span><span class="chip basic">Basic</span> fresher / warm-up</span>
          <span><span class="chip mid">Mid</span> 2–5 years</span>
          <span><span class="chip senior">Senior</span> design &amp; trade-offs</span>
          <span><span class="chip hot">Asked often</span> prepare first</span>
        </div>
      </section>
      <section class="wrap">
        <div class="section-label"><h2>Topics</h2><span class="muted">${done} of ${TOTAL} learned</span></div>
        <div class="topic-grid">
          ${TOPICS.map((t, i) => {
            const l = learnedIn(t);
            return `<a class="topic-card" href="#${t.id}" style="--c:${t.color};--i:${i}">
              <div class="tc-top">
                <span class="tc-label">${t.count} questions</span>
                <span class="tc-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
              </div>
              <h3>${escHtml(t.title)}</h3>
              <p>${escHtml(t.blurb)}</p>
              <div class="tc-foot">
                <div class="bar"><span data-w="${pct(l, t.count)}"></span></div>
                <span class="tc-pct">${pct(l, t.count)}%</span>
              </div>
            </a>`;
          }).join('')}
        </div>
      </section>`;
    animateIn();
    requestAnimationFrame(() => $$('.bar span[data-w]').forEach((b) => (b.style.width = b.dataset.w + '%')));
    $('#randomAll').addEventListener('click', () => {
      const pool = Object.keys(QINDEX).filter((id) => !learned.has(id));
      const ids = pool.length ? pool : Object.keys(QINDEX);
      go(ids[Math.floor(Math.random() * ids.length)]);
    });
    window.scrollTo(0, 0);
  }

  function animateIn() {
    view.classList.remove('enter');
    void view.offsetWidth;
    view.classList.add('enter');
  }

  /* ---------------- topic ---------------- */
  function qCard(q, i, topic, showTopic) {
    const isL = learned.has(q.id);
    return `<article class="qa${isL ? ' learned' : ''}" id="${q.id}" data-id="${q.id}" data-level="${q.level}" data-hot="${q.hot ? 1 : 0}" style="--i:${i}${showTopic ? ';--t:' + topic.color : ''}">
      <button class="qa-head" type="button" aria-expanded="false" aria-controls="b-${q.id}">
        <span class="qa-num">Q${q.n}</span>
        <span class="qa-q">${q.qh}</span>
        <span class="qa-chips">
          ${showTopic ? `<span class="chip topic" style="--c:${topic.color}">${escHtml(topic.short)}</span>` : ''}
          <span class="chip ${q.level}">${LEVEL[q.level]}</span>
          ${q.hot ? '<span class="chip hot">Asked often</span>' : ''}
          ${isL ? '<span class="chip done">Learned</span>' : ''}
        </span>
        <span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </button>
      <div class="qa-body" id="b-${q.id}" role="region"><div class="qa-inner"></div></div>
    </article>`;
  }

  function renderTopic(t) {
    current = { name: 'topic', topic: t };
    setAccent(t.color);
    markTab(t.id);
    const l = learnedIn(t);
    const C = 2 * Math.PI * 26;
    let i = 0;
    view.innerHTML = `
      <section class="topic-hero">
        <div class="wrap">
          <div class="topic-hero-row">
            <div class="topic-hero-main">
              <div class="eyebrow">${t.count} questions · ${t.sections.length} sections</div>
              <h1>${escHtml(t.title)}</h1>
              <p>${escHtml(t.blurb)}</p>
            </div>
            <div class="ring-box glass">
              <svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" id="ringFg" cx="32" cy="32" r="26" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
              <div class="ring-txt"><b id="ringPct">${pct(l, t.count)}%</b><span id="ringTxt">${l} of ${t.count} learned</span></div>
            </div>
          </div>
          ${t.cheats.length ? `
          <div class="cheats glass" id="cheats" data-collapsed="${store.get('cheats-' + t.id, false)}">
            <div class="cheats-head">
              <h2>Quick revision · ${t.cheats.length} key points</h2>
              <button class="btn sm" type="button" id="cheatToggle">${store.get('cheats-' + t.id, false) ? 'Show' : 'Hide'}</button>
            </div>
            <ul class="cheats-list">${t.cheats.map((c) => `<li>${c}</li>`).join('')}</ul>
          </div>` : ''}
        </div>
      </section>
      <div class="toolbar">
        <div class="wrap"><div class="toolbar-inner glass">
          <div class="seg" role="group" aria-label="Level">
            ${['all', 'basic', 'mid', 'senior'].map((lv) => `<button type="button" data-level="${lv}" aria-pressed="${filters.level === lv}">${lv === 'all' ? 'All' : LEVEL[lv]}</button>`).join('')}
          </div>
          <button class="btn sm" type="button" id="fHot" aria-pressed="${filters.hot}">Asked often</button>
          <button class="btn sm" type="button" id="fLearned" aria-pressed="${filters.hideLearned}">Hide learned</button>
          <span class="spacer"></span>
          <button class="btn sm" type="button" id="quiz">Quiz me</button>
          <button class="btn sm" type="button" id="expandAll">Expand all</button>
          <span class="showing" id="showing"></span>
        </div></div>
      </div>
      <div class="wrap topic-body">
        <aside class="toc glass" aria-label="Sections">
          <h3>Sections</h3>
          ${t.sections.map((s, si) => `<a href="#" data-sec="sec-${si}">${escHtml(s.title)}<span>${s.qs.length}</span></a>`).join('')}
        </aside>
        <div class="topic-main">
          ${t.sections.map((s, si) => `
            <section class="sec" id="sec-${si}">
              <div class="sec-head"><h2>${escHtml(s.title)}</h2><span class="n">${s.qs.length} Q</span></div>
              ${s.intro ? `<div class="sec-intro prose">${s.intro}</div>` : ''}
              <div class="qlist">${s.qs.map((q) => qCard(q, i++, t, false)).join('')}</div>
            </section>`).join('')}
        </div>
      </div>`;
    animateIn();
    requestAnimationFrame(() => updateRing(t));
    bindTopic(t);
    applyFilters();
  }

  function updateRing(t) {
    const fg = $('#ringFg');
    if (!fg) return;
    const l = learnedIn(t);
    const C = 2 * Math.PI * 26;
    fg.style.strokeDashoffset = String(C - (C * l) / t.count);
    $('#ringPct').textContent = pct(l, t.count) + '%';
    $('#ringTxt').textContent = `${l} of ${t.count} learned`;
  }

  function bindTopic(t) {
    const ct = $('#cheatToggle');
    if (ct) ct.addEventListener('click', () => {
      const box = $('#cheats');
      const col = box.dataset.collapsed !== 'true';
      box.dataset.collapsed = String(col);
      ct.textContent = col ? 'Show' : 'Hide';
      store.set('cheats-' + t.id, col);
    });
    $$('.seg button').forEach((b) =>
      b.addEventListener('click', () => {
        filters.level = b.dataset.level;
        $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        saveFilters();
        applyFilters();
      })
    );
    const toggleBtn = (id, key) => {
      const b = $(id);
      b.addEventListener('click', () => {
        filters[key] = !filters[key];
        b.setAttribute('aria-pressed', String(filters[key]));
        saveFilters();
        applyFilters();
      });
    };
    toggleBtn('#fHot', 'hot');
    toggleBtn('#fLearned', 'hideLearned');
    $('#expandAll').addEventListener('click', (e) => {
      const visible = $$('.qa', view).filter((a) => !a.hidden);
      const anyClosed = visible.some((a) => !a.classList.contains('open'));
      visible.forEach((a) => setOpen(a, anyClosed));
      e.currentTarget.textContent = anyClosed ? 'Collapse all' : 'Expand all';
    });
    $('#quiz').addEventListener('click', () => {
      const pool = $$('.qa', view).filter((a) => !a.hidden && !learned.has(a.dataset.id));
      const list = pool.length ? pool : $$('.qa', view).filter((a) => !a.hidden);
      if (!list.length) return toast('No questions match the filters');
      $$('.qa.open', view).forEach((a) => setOpen(a, false));
      const pick = list[Math.floor(Math.random() * list.length)];
      openQuestion(pick.dataset.id, true);
    });
    // TOC
    $$('.toc a').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const s = document.getElementById(a.dataset.sec);
        if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );
    if ('IntersectionObserver' in window) {
      const links = $$('.toc a');
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              links.forEach((l) => l.classList.toggle('active', l.dataset.sec === en.target.id));
            }
          });
        },
        { rootMargin: '-30% 0px -60% 0px' }
      );
      $$('.sec', view).forEach((s) => io.observe(s));
    }
  }

  function applyFilters() {
    let shown = 0;
    let total = 0;
    $$('.sec', view).forEach((sec) => {
      let vis = 0;
      $$('.qa', sec).forEach((a) => {
        total++;
        const ok =
          (filters.level === 'all' || a.dataset.level === filters.level) &&
          (!filters.hot || a.dataset.hot === '1') &&
          (!filters.hideLearned || !learned.has(a.dataset.id) || a.classList.contains('open'));
        a.hidden = !ok;
        if (ok) vis++;
      });
      sec.hidden = vis === 0;
      shown += vis;
      const link = $(`.toc a[data-sec="${sec.id}"]`);
      if (link) link.hidden = vis === 0;
    });
    const s = $('#showing');
    if (s) s.textContent = shown === total ? `${total} questions` : `Showing ${shown} of ${total}`;
  }

  /* ---------------- question open / learned ---------------- */
  function fillAnswer(article) {
    const inner = $('.qa-inner', article);
    if (inner.firstChild) return;
    const { q } = QINDEX[article.dataset.id];
    const isL = learned.has(q.id);
    inner.innerHTML = `<div class="qa-content"><div class="prose">${q.a}</div>
      <div class="qa-foot">
        <button class="btn sm learn-btn" type="button" aria-pressed="${isL}">${isL ? '✓ Learned' : 'Mark as learned'}</button>
        <button class="btn sm next-btn" type="button">Next question ↓</button>
      </div></div>`;
    if (window.hljs) $$('pre code', inner).forEach((c) => { try { window.hljs.highlightElement(c); } catch (e) { /* ignore */ } });
  }

  function setOpen(article, open) {
    if (open) fillAnswer(article);
    article.classList.toggle('open', open);
    $('.qa-head', article).setAttribute('aria-expanded', String(open));
  }

  function openQuestion(id, scroll) {
    const a = document.getElementById(id);
    if (!a) return;
    if (a.hidden) {
      filters.level = 'all'; filters.hot = false; filters.hideLearned = false;
      $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === 'all')));
      ['#fHot', '#fLearned'].forEach((s) => $(s) && $(s).setAttribute('aria-pressed', 'false'));
      saveFilters();
      applyFilters();
    }
    setOpen(a, true);
    if (scroll) {
      setTimeout(() => {
        a.scrollIntoView({ behavior: 'smooth', block: 'start' });
        a.classList.remove('flash');
        void a.offsetWidth;
        a.classList.add('flash');
      }, 60);
    }
  }

  function toggleLearned(article) {
    const id = article.dataset.id;
    const now = !learned.has(id);
    if (now) learned.add(id); else learned.delete(id);
    saveLearned();
    article.classList.toggle('learned', now);
    const b = $('.learn-btn', article);
    if (b) { b.setAttribute('aria-pressed', String(now)); b.textContent = now ? '✓ Learned' : 'Mark as learned'; }
    const chips = $('.qa-chips', article);
    const done = $('.chip.done', chips);
    if (now && !done) chips.insertAdjacentHTML('beforeend', '<span class="chip done">Learned</span>');
    if (!now && done) done.remove();
    if (current.name === 'topic') updateRing(current.topic);
    toast(now ? 'Marked as learned' : 'Moved back to revise');
  }

  view.addEventListener('click', (e) => {
    const head = e.target.closest('.qa-head');
    if (head) {
      const a = head.closest('.qa');
      const open = !a.classList.contains('open');
      setOpen(a, open);
      if (open && history.replaceState) {
        try { history.replaceState(null, '', '#' + a.dataset.id); } catch (err) { /* ignore */ }
      }
      return;
    }
    const lb = e.target.closest('.learn-btn');
    if (lb) return toggleLearned(lb.closest('.qa'));
    const nb = e.target.closest('.next-btn');
    if (nb) {
      const a = nb.closest('.qa');
      const all = $$('.qa', view).filter((x) => !x.hidden);
      const next = all[all.indexOf(a) + 1];
      setOpen(a, false);
      if (next) openQuestion(next.id, true);
      else toast('That was the last question here');
      return;
    }
    const cp = e.target.closest('.copy');
    if (cp) {
      const code = cp.closest('.code').querySelector('code').innerText;
      const done = () => { cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1400); };
      try {
        navigator.clipboard.writeText(code).then(done, () => selectCode(cp));
      } catch (err) { selectCode(cp); }
    }
  });
  function selectCode(btn) {
    const el = btn.closest('.code').querySelector('code');
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    toast('Selected — press Ctrl+C to copy');
  }

  /* ---------------- search ---------------- */
  const searchInput = $('#search');
  let searchTimer;
  let preSearchHash = '';
  function clearSearch() {
    if (searchInput.value) searchInput.value = '';
  }
  function highlight(html, terms) {
    // highlight only in text nodes of the (already escaped) question HTML
    return html.replace(/(^|>)([^<]+)/g, (m, a, txt) => {
      let out = txt;
      terms.forEach((term) => {
        const re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        out = out.replace(re, '<mark>$1</mark>');
      });
      return a + out;
    });
  }
  function renderSearch(query) {
    const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!terms.length) return;
    current = { name: 'search' };
    root.style.removeProperty('--t');
    markTab('__none');
    const results = [];
    TOPICS.forEach((t) =>
      t.sections.forEach((s) =>
        s.qs.forEach((q) => {
          const ql = q.q.toLowerCase();
          let score = 0;
          for (const term of terms) {
            if (ql.includes(term)) score += 5;
            else if (q.t.includes(term)) score += 1;
            else { score = 0; break; }
          }
          if (t.title.toLowerCase().includes(terms[0])) score += 1;
          if (score) results.push({ q, t, score });
        })
      )
    );
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, 80);
    let i = 0;
    const groups = [];
    TOPICS.forEach((t) => {
      const rs = top.filter((r) => r.t === t);
      if (rs.length) groups.push({ t, rs });
    });
    groups.sort((a, b) => b.rs[0].score - a.rs[0].score);
    view.innerHTML = `
      <div class="wrap search-head">
        <div class="eyebrow">Search</div>
        <h1>“${escHtml(query)}”</h1>
        <div class="muted">${results.length} matching question${results.length === 1 ? '' : 's'}${results.length > 80 ? ' · showing the best 80' : ''}</div>
      </div>
      <div class="wrap">
        ${top.length ? `<div class="search-results">
          ${groups.map((g) => `<div class="result-topic">${escHtml(g.t.title)} · ${g.rs.length}</div>` +
            g.rs.map((r) => qCard(Object.assign({}, r.q, { qh: highlight(r.q.qh, terms) }), i++, r.t, true)).join('')).join('')}
        </div>` : `<div class="empty glass"><b>No questions match</b>Try a shorter word, like “event loop”, “queue” or “webhook”.</div>`}
      </div>`;
    animateIn();
  }
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = searchInput.value.trim();
      if (v.length >= 2) {
        if (current.name !== 'search') preSearchHash = location.hash;
        renderSearch(v);
        window.scrollTo(0, 0);
      } else if (current.name === 'search') {
        route();
      }
    }, 160);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
      if (current.name === 'search') route();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ---------------- scroll: progress bar + back to top ---------------- */
  const readBar = $('#readBar');
  const toTop = $('#toTop');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      readBar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
      toTop.hidden = window.scrollY < 700;
      ticking = false;
    });
  }, { passive: true });
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  /* ---------------- hamburger: topic tabs + filter bar ---------------- */
  const menuBtn = $('#menuBtn');
  const isPhone = () => window.matchMedia('(max-width: 640px)').matches;
  function setMenu(open, remember) {
    document.body.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuBtn.setAttribute('aria-label', open ? 'Hide topics and filters' : 'Show topics and filters');
    if (remember) store.set('menu', open ? '1' : '0');
    if (open) {
      requestAnimationFrame(() => {
        const a = $('.tab[aria-selected="true"]', tabsEl);
        if (a) markTab(a.dataset.route);
        updateTabArrows();
      });
    }
  }
  menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open'), true));
  /* on phones the menu closes itself after you pick a topic */
  tabsEl.addEventListener('click', (e) => { if (e.target.closest('.tab') && isPhone()) setMenu(false, false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open') && document.activeElement !== searchInput) setMenu(false, true);
  });
  setMenu(!isPhone() && store.get('menu') === '1', false);

  /* ---------------- boot ---------------- */
  $('#qTotal').textContent = TOTAL;
  renderTabs();
  measureHeader();
  window.addEventListener('hashchange', () => {
    if (current.name === 'search') clearSearch();
    route();
  });
  route();
  window.addEventListener('resize', () => {
    const active = $('.tab[aria-selected="true"]', tabsEl);
    if (active) markTab(active.dataset.route);
  });
})();
