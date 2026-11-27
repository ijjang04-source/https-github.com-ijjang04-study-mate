(function (SM) {
  'use strict';

  // 로드 시점에는 DOM을 건드리지 않는다(node 테스트에서도 로드되도록).

  function appendChildren(parent, children) {
    children.forEach(function add(child) {
      if (child === null || child === undefined || child === false || child === true) return;
      if (Array.isArray(child)) { child.forEach(add); return; }
      if (typeof child === 'string' || typeof child === 'number') {
        parent.appendChild(document.createTextNode(String(child)));
        return;
      }
      parent.appendChild(child);
    });
  }

  /**
   * el('button', { class: 'btn', text: '확인', onClick: fn, 'aria-label': '확인' }, ...children)
   * 사용자 입력은 text나 문자열 children으로 넣는다(항상 텍스트 노드가 된다).
   */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (key === 'innerHTML' || key === 'outerHTML') {
          throw new Error('SM.ui.el: innerHTML은 지원하지 않습니다.');
        }
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') {
          node.textContent = String(value);
        } else if (key === 'class' || key === 'className') {
          node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
        } else if (key === 'dataset') {
          Object.keys(value).forEach((k) => { node.dataset[k] = String(value[k]); });
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(node.style, value);
        } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') {
          node[key] = value;
        } else if (value === true) {
          node.setAttribute(key, '');
        } else {
          // aria-*, role, href, type 등
          node.setAttribute(key, String(value));
        }
      });
    }
    appendChildren(node, children);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(node) {
    const view = document.getElementById('view');
    clear(view);
    if (node) view.appendChild(node);
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    return view;
  }

  /** 하단 탭에서 route('chat', 'test' …)에 해당하는 탭에 aria-current="page"를 붙인다. */
  function markTab(route) {
    const links = document.querySelectorAll('#tabbar a[data-route]');
    Array.prototype.forEach.call(links, (a) => {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  let toastHost = null;
  function toast(message, ms = 2000) {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    const t = el('div', { class: 'toast', text: message });
    toastHost.appendChild(t);
    setTimeout(() => { t.remove(); }, ms);
    return t;
  }

  function debounce(fn, ms) {
    let timer = null;
    function debounced(...args) {
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(self, args); }, ms);
    }
    debounced.cancel = () => { clearTimeout(timer); timer = null; };
    return debounced;
  }

  /** 화면 내 확인 모달. Esc·바깥 클릭·취소 → false, 확인 → true. */
  function confirmDialog(message, options = {}) {
    const okText = options.okText || '확인';
    const cancelText = options.cancelText || '취소';
    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      const msgId = 'dlg-msg-' + Date.now();
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: cancelText });
      const okBtn = el('button', { type: 'button', class: 'btn btn-primary', text: okText });
      const box = el('div', {
        class: 'modal card',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-describedby': msgId,
        tabindex: '-1'
      },
        el('p', { id: msgId, text: message }),
        el('div', { class: 'row' }, cancelBtn, okBtn)
      );
      const backdrop = el('div', { class: 'modal-backdrop' }, box);

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        } else if (e.key === 'Tab') {
          // 포커스를 모달 안 두 버튼 사이에 가둔다.
          const items = [cancelBtn, okBtn];
          const idx = items.indexOf(document.activeElement);
          e.preventDefault();
          const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : (idx + 1) % items.length;
          items[next].focus();
        }
      }

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(backdrop);
      // 실수로 확인하지 않도록 기본 포커스는 '취소'에 둔다.
      cancelBtn.focus();
    });
  }

  /**
   * 글자를 입력받는 모달. 확인 → 입력값, 취소·Esc·바깥 클릭 → null.
   * options: { label, okText, cancelText, placeholder, maxlength }
   */
  function promptDialog(message, options = {}) {
    const previousFocus = document.activeElement;
    return new Promise((resolve) => {
      const id = 'dlg-' + Date.now();
      const input = el('input', { id: id + '-in', type: 'text', autocomplete: 'off', maxlength: options.maxlength || 40, placeholder: options.placeholder || '' });
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: options.cancelText || '취소' });
      const okBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: options.okText || '확인' });
      const form = el('form', {
        class: 'modal card stack', role: 'dialog', 'aria-modal': 'true', 'aria-describedby': id + '-msg',
        onSubmit(e) { e.preventDefault(); close(input.value); }
      },
        el('p', { id: id + '-msg', text: message }),
        options.label ? el('label', { for: id + '-in', text: options.label }) : null,
        input,
        el('div', { class: 'row' }, cancelBtn, okBtn)
      );
      const backdrop = el('div', { class: 'modal-backdrop' }, form);
      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Tab') {
          const items = [input, cancelBtn, okBtn];
          const idx = items.indexOf(document.activeElement);
          e.preventDefault();
          items[e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : (idx + 1) % items.length].focus();
        }
      }
      cancelBtn.addEventListener('click', () => close(null));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      input.focus();
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** const s = savedIndicator(); parent.append(s.node); s.set('saving' | 'saved' | 'error' | 'idle') */
  function savedIndicator() {
    const node = el('span', { class: 'saved-indicator', role: 'status', 'aria-live': 'polite' });
    function set(state) {
      node.dataset.state = state;
      if (state === 'saving') {
        node.textContent = '저장 중…';
      } else if (state === 'saved') {
        const now = new Date();
        node.textContent = '저장됨 ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      } else if (state === 'error') {
        node.textContent = '저장 실패 — 다시 시도해 줘';
      } else {
        node.textContent = '';
      }
    }
    return { node, set };
  }

  // --- gloss: 용어 풀이 (시작) ---
  // 화면 글자 속 사전 용어(SM.data.glossary)를 카드(또는 문단)마다 처음 한 번만 점선 밑줄 버튼으로 바꾼다.
  // 누르면 그 자리에 풀이 상자가 열리고, 다시 누르거나 Esc로 닫힌다.
  // 글자는 항상 텍스트 노드로만 다룬다(splitText·createTextNode·el). HTML 문자열로 넣지 않는다.

  const GLOSS_SKIP = 'button, a, label, summary, option, select, textarea, input, script, style, canvas, svg, [contenteditable], [aria-hidden="true"], .term-pop, .no-gloss';
  // 카드가 있으면 카드 전체(안의 details 출처까지)가 한 범위, 카드 밖이면 문단마다
  const GLOSS_SCOPE = '.card, .gloss-scope';
  const GLOSS_PARA = 'p, li, dd, dt, h2, h3, h4, td, th';
  let glossSeq = 0;

  function glossTerms(glossary) {
    // 긴 용어가 먼저('정교화 질문' > '정교화')
    return Object.keys(glossary || SM.data && SM.data.glossary || {}).sort((a, b) => b.length - a.length);
  }

  /**
   * 순수 함수: 문자열을 [{ text }] / [{ term }] 조각으로. used(Set)에 있는 용어는 건너뛰고, 쓴 용어는 used에 넣는다.
   * 용어마다 처음 나온 곳 하나만 고른다.
   */
  function glossSplit(text, terms, used) {
    const s = String(text);
    const seen = used || new Set();
    const out = [];
    let pos = 0;
    for (;;) {
      let best = null;
      terms.forEach((t) => {
        if (seen.has(t)) return;
        const at = s.indexOf(t, pos);
        if (at !== -1 && (!best || at < best.at || (at === best.at && t.length > best.term.length))) best = { at, term: t };
      });
      if (!best) break;
      if (best.at > pos) out.push({ text: s.slice(pos, best.at) });
      out.push({ term: best.term });
      seen.add(best.term);
      // 겹치는 짧은 용어('정교화 질문' 안의 '정교화')도 이 자리에서는 쓴 것으로 본다
      terms.forEach((t) => { if (best.term.indexOf(t) !== -1) seen.add(t); });
      pos = best.at + best.term.length;
    }
    if (pos < s.length || !out.length) out.push({ text: s.slice(pos) });
    return out;
  }

  function closeGloss(btn) {
    const pop = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', 'false');
    if (pop) pop.hidden = true;
  }

  /** 용어 버튼 + 바로 뒤 풀이 상자 → [button, span] */
  function termNodes(term, entry) {
    const id = 'term-pop-' + (++glossSeq);
    const pop = el('span', { class: 'term-pop', id, role: 'note', hidden: true },
      el('strong', { text: term }), ' ', entry.easy,
      entry.example ? el('span', { class: 'term-ex', text: '예) ' + entry.example }) : null);
    const btn = el('button', {
      type: 'button', class: 'term', 'aria-expanded': 'false', 'aria-controls': id, text: term,
      onClick() {
        const open = btn.getAttribute('aria-expanded') === 'true';
        if (open) { closeGloss(btn); return; }
        btn.setAttribute('aria-expanded', 'true');
        pop.hidden = false;
      }
    });
    return [btn, pop];
  }

  function glossScopeOf(node, root) {
    const host = node.parentNode;
    const scope = host.closest(GLOSS_SCOPE) || host.closest(GLOSS_PARA);
    return scope && root.contains(scope) ? scope : root;
  }

  /** root 안의 글자에 용어 버튼을 붙인다. 이미 붙인 곳은 건드리지 않아 여러 번 불러도 된다. → 새로 붙인 개수 */
  function glossify(root, glossary) {
    const G = glossary || (SM.data && SM.data.glossary);
    if (!root || !G || typeof document === 'undefined') return 0;
    if (root.closest && root.closest('.no-gloss')) return 0;
    const terms = glossTerms(G);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() && n.parentNode && !n.parentNode.closest(GLOSS_SKIP)) nodes.push(n);
    }
    const usedBy = new Map();   // scope → Set(이미 밑줄 그은 용어)
    const usedOf = (scope) => {
      if (!usedBy.has(scope)) {
        const set = new Set();
        scope.querySelectorAll('button.term').forEach((b) => {
          const t = b.textContent;
          set.add(t);
          terms.forEach((x) => { if (t.indexOf(x) !== -1) set.add(x); });
        });
        usedBy.set(scope, set);
      }
      return usedBy.get(scope);
    };
    let added = 0;
    nodes.forEach((node) => {
      const parts = glossSplit(node.nodeValue, terms, usedOf(glossScopeOf(node, root)));
      if (parts.length === 1 && parts[0].text !== undefined) return;
      const frag = document.createDocumentFragment();
      parts.forEach((p) => {
        if (p.text !== undefined) { if (p.text) frag.appendChild(document.createTextNode(p.text)); return; }
        termNodes(p.term, G[p.term]).forEach((x) => frag.appendChild(x));
        added++;
      });
      node.parentNode.replaceChild(frag, node);
    });
    return added;
  }

  let glossEscBound = false;
  function bindGlossEsc() {
    if (glossEscBound || typeof document === 'undefined') return;
    glossEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="alertdialog"], [role="dialog"], dialog[open]')) return;   // 확인창이 먼저
      const open = Array.from(document.querySelectorAll('button.term[aria-expanded="true"]'));
      if (!open.length) return;
      open.forEach(closeGloss);
      const last = open[open.length - 1];
      const a = document.activeElement;
      if (!a || a === document.body || (a.closest && a.closest('.term-pop, button.term'))) last.focus();
    });
  }

  /** root를 지켜보다가 새 글자가 생기면 다시 붙인다(화면 일부만 다시 그리는 경우). → 멈추는 함수 */
  function glossWatch(root) {
    if (!root || typeof MutationObserver === 'undefined') return () => {};
    bindGlossEsc();
    glossify(root);
    let timer = null;
    const obs = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; glossify(root); }, 30);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { obs.disconnect(); if (timer) clearTimeout(timer); timer = null; };
  }
  // --- gloss: 용어 풀이 (끝) ---

  SM.ui = { el, clear, mount, markTab, toast, debounce, confirmDialog, promptDialog, savedIndicator, glossSplit, glossify, glossWatch };

  // ---------- 화면 등록 ----------
  // 기능 파일(test.js, planner.js …)이 로드될 때 바로 등록할 수 있도록 ui.js에 둔다.
  // 라우터 실행은 app.js가 맡는다.
  //   SM.route('#/planner/:view(month|week|day)', { title: '플래너', auth: true, tab: 'planner', render(params) { … } })
  //   render는 DOM 노드 또는 { node, cleanup }을 반환한다(Promise도 가능).
  SM.routes = SM.routes || {};
  SM.route = function route(path, def) {
    const key = '/' + String(path).replace(/^#?\/?/, '').replace(/\/+$/, '');
    if (!def || typeof def.render !== 'function') throw new Error('SM.route: render 함수가 필요합니다: ' + path);
    SM.routes[key] = Object.assign({ title: '', auth: true }, def, { path: key });
    return SM.routes[key];
  };
})(window.SM = window.SM || {});
