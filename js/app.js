(function (SM) {
  'use strict';

  const DEFAULT_PATH = '#/chat';
  const LOGIN_PATH = '#/login';
  const APP_NAME = '공부 메이트';

  // ---------- 순수 함수(테스트 대상) ----------

  /** '#/planner/day?x=1' → ['planner', 'day'] */
  function splitHash(hash) {
    return String(hash || '')
      .replace(/^#/, '')
      .split('?')[0]
      .split('/')
      .filter(Boolean);
  }

  /** 패턴 한 칸: 'planner' | ':view' | ':view(month|week|day)' */
  function matchSegment(pattern, actual, params) {
    const m = /^:(\w+)(?:\(([^)]+)\))?$/.exec(pattern);
    if (!m) return pattern === actual;
    let value;
    try { value = decodeURIComponent(actual); } catch (e) { return false; }
    if (m[2] && m[2].split('|').indexOf(value) === -1) return false;
    params[m[1]] = value;
    return true;
  }

  /** hash와 맞는 경로를 찾는다. 반환: { route, params } 또는 null */
  function match(hash, routes) {
    const parts = splitHash(hash);
    const table = routes || SM.routes;
    // 고정 경로를 :param 경로보다 먼저 본다.
    const keys = Object.keys(table).sort((a, b) => (a.indexOf(':') !== -1) - (b.indexOf(':') !== -1));
    for (const key of keys) {
      const pattern = splitHash(key);
      if (pattern.length !== parts.length) continue;
      const params = {};
      if (pattern.every((p, i) => matchSegment(p, parts[i], params))) {
        return { route: table[key], params };
      }
    }
    return null;
  }

  /**
   * 무엇을 할지 정한다.
   * { type: 'render', route, params } | { type: 'redirect', to }
   */
  function decide(hash, isAuthed, routes) {
    const found = match(hash, routes);
    if (!found) return { type: 'redirect', to: DEFAULT_PATH };
    if (found.route.auth && !isAuthed) return { type: 'redirect', to: LOGIN_PATH };
    return { type: 'render', route: found.route, params: found.params };
  }

  // ---------- 실행부(DOM 필요) ----------

  let currentCleanup = null;
  let renderToken = 0;
  let currentKeys = new Set();

  function runCleanup() {
    const fn = currentCleanup;
    currentCleanup = null;
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[router] cleanup 오류', e); }
    }
  }

  function errorCard(err) {
    const el = SM.ui.el;
    return el('div', { class: 'card stack' },
      el('h2', { text: '화면을 불러오지 못했어' }),
      el('p', { class: 'muted', text: '새로고침하거나 다른 탭으로 이동해 줘.' }),
      el('p', { class: 'muted', text: String(err && err.message || err) })
    );
  }

  async function render() {
    const token = ++renderToken;
    const decision = decide(location.hash, !!SM.auth.current());

    if (decision.type === 'redirect') {
      if (location.hash !== decision.to) {
        location.replace(decision.to); // 기록을 쌓지 않고 바꾼다 → hashchange로 다시 render
        return;
      }
    }
    if (decision.type !== 'render') return;

    const { route, params } = decision;
    runCleanup();

    // 이 화면이 읽는 키를 모은다(다른 창에서 바뀌면 다시 그리려고)
    currentKeys = SM.store.track ? SM.store.track() : new Set();
    let result;
    try {
      result = await route.render(params);
    } catch (e) {
      console.error('[router] render 오류', e);
      result = errorCard(e);
    }
    if (token !== renderToken) {
      // 기다리는 사이 다른 화면으로 이동했다.
      if (result && typeof result.cleanup === 'function') result.cleanup();
      return;
    }

    const node = result && result.node ? result.node : result;
    currentCleanup = result && typeof result.cleanup === 'function' ? result.cleanup : null;

    const me = SM.auth.current();
    document.body.dataset.auth = me ? 'in' : 'out';
    const nick = document.getElementById('nickname');
    if (nick) nick.textContent = me ? me.nickname : '';
    document.title = (route.title ? route.title + ' · ' : '') + APP_NAME;
    SM.ui.mount(node);
    SM.ui.markTab(route.tab || splitHash(route.path)[0]);

    const view = document.getElementById('view');
    if (!view.hasAttribute('tabindex')) view.setAttribute('tabindex', '-1');
    try { view.focus({ preventScroll: true }); } catch (e) { view.focus(); }
  }

  function navigate(path) {
    if (location.hash === path) render();
    else location.hash = path;
  }

  let started = false;
  function start() {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', render);
    render();
  }

  // ---------- 다른 창(탭)에서 바뀐 내용 ----------

  // 이 키들은 화면 내용이 아니라서 다시 그리지 않는다.
  const IGNORED_KEYS = ['meta', 'device'];

  /** 다른 창에서 바뀐 key 때문에 지금 화면을 다시 그려야 하나 */
  function needsRefresh(key, keys) {
    return !!key && IGNORED_KEYS.indexOf(key) === -1 && !!keys && keys.has(key);
  }

  /** 지금 #view 안에서 무언가를 입력하는 중인가 */
  function isEditing() {
    const a = document.activeElement;
    const view = document.getElementById('view');
    if (!a || !view || !view.contains(a)) return false;
    return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable ||
      (a.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'range'].indexOf(a.type) === -1);
  }

  const pendingKeys = new Set();
  let refreshTimer = null;

  // 입력이 끝난(포커스가 빠진) 뒤 500ms 디바운스 저장이 먼저 끝나도록 조금 기다린다.
  const REFRESH_AFTER_EDIT_MS = 700;

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!pendingKeys.size) return;
      if (isEditing()) return; // 입력 중이면 덮어쓰지 않는다. focusout 때 다시 시도
      // 다시 그리기 전에 이 창의 '처음 읽은 값'을 잊어서 새 값을 기준으로 삼게 한다.
      pendingKeys.forEach((k) => { if (SM.store.forget) SM.store.forget(k); });
      pendingKeys.clear();
      render();
      SM.ui.toast('다른 창에서 바뀐 내용을 불러왔어.');
    }, delay);
  }

  function onExternalChange(key) {
    if (key === null || key === SM.keys.session()) { render(); return; }
    if (!needsRefresh(key, currentKeys)) {
      // 지금 화면이 안 쓰는 키: 다음에 읽을 때 새 값을 기준으로
      if (SM.store.forget) SM.store.forget(key);
      return;
    }
    pendingKeys.add(key);
    scheduleRefresh(isEditing() ? REFRESH_AFTER_EDIT_MS : 50);
  }

  // ---------- 전역 오류 ----------

  let lastErrorToast = 0;
  function reportError(kind, detail) {
    // 저장된 데이터는 건드리지 않고, 알리기만 한다.
    console.error('[공부 메이트] ' + kind, detail);
    const now = Date.now();
    if (now - lastErrorToast < 5000) return;
    lastErrorToast = now;
    try { SM.ui.toast('문제가 생겼어. 새로고침해 볼래?', 4000); } catch (e) { /* 무시 */ }
  }

  function bindGlobalErrors() {
    window.addEventListener('error', (e) => {
      reportError('오류', e && (e.error || { message: e.message, at: e.filename + ':' + e.lineno }));
    });
    window.addEventListener('unhandledrejection', (e) => {
      reportError('처리되지 않은 Promise 오류', e && e.reason);
    });
  }

  function showPersistBanner() {
    if (SM.store.isPersistent || document.getElementById('persist-banner')) return;
    const bar = SM.ui.el('div', { id: 'persist-banner', class: 'persist-banner', role: 'alert', text: '이 창을 닫으면 기록이 사라져요. 일반 창에서 열어 주세요.' });
    const top = document.getElementById('topbar');
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  SM.router = { match, decide, render, navigate, start, needsRefresh, DEFAULT_PATH, LOGIN_PATH };

  // ---------- 임시 화면("준비 중") ----------

  function placeholder(title, describe) {
    return function (params) {
      const el = SM.ui.el;
      return el('section', { class: 'card stack' },
        el('h2', { text: title }),
        el('p', { class: 'muted', text: '준비 중이에요.' }),
        describe ? el('p', { class: 'muted', text: describe(params) }) : null
      );
    };
  }

  const PLACEHOLDERS = [
    ['#/chat', { title: '챗봇' }],
    ['#/test', { title: '학습 스타일 진단' }],
    ['#/result', { title: '진단 결과', tab: 'test' }],
    ['#/strategy', { title: '맞춤 전략' }],
    ['#/planner/:view(month|week|day)', {
      title: '플래너',
      describe: (p) => ({ month: '월간', week: '주간', day: '일간' })[p.view] + ' 보기'
    }],
    ['#/check', { title: '자기 점검' }],
    ['#/class', { title: '우리 반' }],
    ['#/settings', { title: '설정' }]
  ];

  PLACEHOLDERS.forEach(([path, def]) => {
    const key = '/' + path.replace(/^#?\//, '');
    if (SM.routes[key]) return; // 기능 파일이 이미 등록했으면 그대로 둔다.
    SM.route(path, {
      title: def.title,
      auth: def.auth !== false,
      tab: def.tab,
      render: placeholder(def.title, def.describe)
    });
  });

  // ---------- 앱 시작 ----------

  function bindTopbar() {
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        const yes = await SM.ui.confirmDialog('나갈까? 적어 둔 내용은 이 기기에 그대로 남아 있어.', { okText: '나가기', cancelText: '취소' });
        if (!yes) return;
        SM.auth.logout();
        navigate(LOGIN_PATH);
      });
    }
  }

  function boot() {
    bindGlobalErrors();
    SM.store.init();
    showPersistBanner();
    SM.auth.restore();
    bindTopbar();
    // 설정한 시간(기본 30분) 동안 아무것도 안 하면 자동으로 나간다.
    SM.auth.watch(() => {
      SM.ui.toast('오래 쉬어서 자동으로 나갔어. 다시 입장해 줘.', 3000);
      navigate(LOGIN_PATH);
    });
    // 다른 탭에서 입장·나가기를 하거나, 지금 화면이 쓰는 키를 바꾸면 이 탭도 맞춘다.
    SM.store.onChange(onExternalChange);
    document.addEventListener('focusout', () => {
      if (pendingKeys.size) scheduleRefresh(REFRESH_AFTER_EDIT_MS);
    });
    start();
  }

  // node 테스트(문서 없음)와 tests.html(SM_NO_AUTOSTART)에서는 시작하지 않는다.
  if (typeof document !== 'undefined' && !window.SM_NO_AUTOSTART && document.getElementById('view')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(window.SM = window.SM || {});
