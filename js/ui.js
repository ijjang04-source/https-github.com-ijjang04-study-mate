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

  SM.ui = { el, clear, mount, markTab, toast, debounce, confirmDialog, promptDialog, savedIndicator };

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
