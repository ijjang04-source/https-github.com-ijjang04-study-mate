(function (SM) {
  'use strict';

  // 설정 화면. 지금은 챗봇 이름만 있다(백업·정리 등은 다음 단계에서 더한다).

  /** 챗봇 이름 검사 → { ok, value } | { ok:false, error }. 빈 값이면 기본 이름으로 돌아간다. */
  function checkBotName(text) {
    const v = String(text || '').trim();
    if (!v) return { ok: true, value: '' };
    const max = (SM.chat && SM.chat.BOT_NAME_MAX) || 12;
    if (v.length > max) return { ok: false, error: `${max}자까지 쓸 수 있어.` };
    if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, error: '쓸 수 없는 글자가 있어.' };
    const norm = v.replace(/\s+/g, '').toLowerCase();
    if (((SM.config && SM.config.bannedWords) || []).some((w) => norm.indexOf(String(w).toLowerCase()) !== -1)) {
      return { ok: false, error: '쓸 수 없는 말이 들어 있어.' };
    }
    return { ok: true, value: v };
  }

  function settingsScreen() {
    const el = SM.ui.el;
    const p = SM.auth.current();
    if (!p) return el('p', { text: '먼저 입장해 줘.' });

    const max = SM.chat.BOT_NAME_MAX;
    const status = SM.ui.savedIndicator();
    const err = el('p', { class: 'field-error', role: 'alert' });
    const input = el('input', {
      id: 'bot-name', type: 'text', maxlength: max, autocomplete: 'off',
      value: (p.botName || ''), placeholder: SM.chat.DEFAULT_BOT_NAME
    });

    const save = SM.ui.debounce(() => {
      const chk = checkBotName(input.value);
      if (!chk.ok) { err.textContent = chk.error; status.set('idle'); return; }
      err.textContent = '';
      const ok = SM.store.set(SM.keys.profile(p.sid), Object.assign({}, SM.store.get(SM.keys.profile(p.sid), p), { botName: chk.value }));
      status.set(ok ? 'saved' : 'error');
    }, 500);

    input.addEventListener('input', () => { status.set('saving'); save(); });

    return el('section', { class: 'settings' },
      el('h2', { text: '설정' }),
      el('div', { class: 'card' },
        el('h3', { text: '챗봇 이름' }),
        el('label', { for: 'bot-name', text: `챗봇을 부를 이름(${max}자까지). 비우면 '${SM.chat.DEFAULT_BOT_NAME}'로 돌아가.` }),
        input, err, status.node
      )
    );
  }

  SM.settings = { checkBotName };

  if (typeof SM.route === 'function') {
    SM.route('#/settings', { title: '설정', render: settingsScreen });
  }
})(window.SM = window.SM || {});
