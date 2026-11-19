(function (SM) {
  'use strict';

  const BOT_NAME = '공부 메이트';
  const STEP_DELAY = 400;
  const MAX_HISTORY = 100;
  const MAX_INPUT = 200;

  // ---------- 흐름 데이터 ----------
  // step: { say } | { card: { title, lines, actions:[{label, go}] } }
  //     | { choices: [{ label, go } | { label, next } | { label, action }] }
  // 9.3·9.4의 나머지 흐름은 19단계에서 추가한다.

  const MENU_CHOICES = [
    { label: '진단', go: '#/test' },
    { label: '전략', go: '#/strategy' },
    { label: '오늘 계획', go: '#/planner/day' },
    { label: '점검', go: '#/check' },
    { label: '우리 반', go: '#/class' }
  ];

  SM.flows = Object.assign(SM.flows || {}, {
    welcome: [
      { say: '반가워, {nickname}!' },
      { say: '나는 너의 공부 메이트야. 진단 → 전략 → 계획 → 점검을 같이 해 볼 거야.' },
      {
        choices: [
          { label: '나의 학습 스타일은 무엇일까?', go: '#/test' },
          { label: '나중에 할래', next: 'menu' }
        ]
      }
    ],
    menu: [
      { say: '무엇을 해 볼까?' },
      { choices: MENU_CHOICES }
    ]
  });

  // chip의 action: 'fnName'이 부를 함수. 다른 파일에서 SM.chat.actions.이름 = fn 으로 추가한다.
  const actions = {};

  // ---------- 순수 함수(테스트 대상) ----------

  /** '{nickname}' 같은 자리 표시를 vars 값으로 바꾼다. 없는 값은 빈 문자열. 결과는 항상 일반 문자열. */
  function fill(template, vars) {
    return String(template === undefined || template === null ? '' : template)
      .replace(/\{(\w+)\}/g, (m, key) => {
        const v = vars ? vars[key] : undefined;
        return v === undefined || v === null ? '' : String(v);
      });
  }

  function fillCard(card, vars) {
    return {
      title: fill(card.title, vars),
      lines: (card.lines || []).map((l) => fill(l, vars)),
      actions: (card.actions || [])
        .filter((a) => a && typeof a.go === 'string' && a.go.startsWith('#/'))
        .map((a) => ({ label: fill(a.label, vars), go: a.go }))
    };
  }

  /** 새 배열을 돌려준다. 최근 max개만 남긴다. */
  function pushHistory(list, msg, max = MAX_HISTORY) {
    const next = (Array.isArray(list) ? list : []).concat([msg]);
    return next.length > max ? next.slice(next.length - max) : next;
  }

  // ---------- 상태 ----------

  let view = null;      // { log, chips, input, sendBtn } — 채팅 화면이 열려 있을 때만
  let flowToken = 0;

  function me() { return SM.auth && SM.auth.current(); }

  function historyKey() {
    const p = me();
    return p ? SM.keys.chat(p.sid) : null;
  }

  function loadHistory() {
    const key = historyKey();
    return key ? SM.store.get(key, []) : [];
  }

  function saveMessage(msg) {
    const key = historyKey();
    if (!key) return;
    SM.store.update(key, (list) => pushHistory(list, msg), []);
  }

  /** 자리 표시 값. 19단계 등에서 SM.chat.varProviders에 함수를 추가해 확장한다. */
  const varProviders = [];
  function vars() {
    const p = me();
    const out = { nickname: p ? p.nickname : '', subject: '', dday: '' };
    varProviders.forEach((fn) => {
      try { Object.assign(out, fn(p) || {}); } catch (e) { console.warn('[chat] vars 오류', e); }
    });
    return out;
  }

  function reducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- 그리기 ----------

  function renderMessage(msg) {
    const el = SM.ui.el;
    const bot = msg.from === 'bot';
    const name = el('span', { class: 'msg-name', text: bot ? BOT_NAME : '나' });
    let body;
    if (msg.type === 'card' && msg.card) {
      const c = msg.card;
      body = el('div', { class: 'bubble card-msg' },
        c.title ? el('h3', { text: c.title }) : null,
        c.lines && c.lines.length ? el('ul', null, c.lines.map((l) => el('li', { text: l }))) : null,
        c.actions && c.actions.length
          ? el('div', { class: 'row' }, c.actions.map((a) => el('button', {
            type: 'button', class: 'btn', text: a.label,
            onClick: () => { location.hash = a.go; }
          })))
          : null
      );
    } else {
      body = el('p', { class: 'bubble', text: msg.text });
    }
    return el('div', { class: 'msg ' + (bot ? 'msg-bot' : 'msg-me') }, name, body);
  }

  function scrollToBottom() {
    if (!view) return;
    const last = view.log.lastElementChild;
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'end' });
    // 입력창에 가리지 않도록 페이지 끝까지
    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function appendToLog(msg) {
    if (!view) return;
    view.log.appendChild(renderMessage(msg));
    scrollToBottom();
  }

  function showChoices(choices) {
    if (!view) return;
    SM.ui.clear(view.chips);
    (choices || []).forEach((c) => {
      view.chips.appendChild(SM.ui.el('button', {
        type: 'button', class: 'chip', text: c.label,
        onClick: () => pick(c)
      }));
    });
  }

  // ---------- 공개 동작 ----------

  function addMessage(msg) {
    saveMessage(msg);
    appendToLog(msg);
    return msg;
  }

  /** 챗봇이 말한다(자리 표시 치환 포함). */
  function say(text) {
    return addMessage({ from: 'bot', type: 'text', text: fill(text, vars()), at: Date.now() });
  }

  /** 카드형 메시지 { title, lines:[], actions:[{label, go}] } */
  function card(obj) {
    return addMessage({ from: 'bot', type: 'card', card: fillCard(obj || {}, vars()), at: Date.now() });
  }

  /** 빠른 답변 칩을 보여 준다. 기록에도 남겨서 다시 들어오면 복원한다. */
  function choices(list) {
    const clean = (list || []).map((c) => Object.assign({}, c, { label: fill(c.label, vars()) }));
    saveMessage({ from: 'bot', type: 'choices', choices: clean, at: Date.now() });
    showChoices(clean);
  }

  function userSays(text) {
    if (view) SM.ui.clear(view.chips);
    return addMessage({ from: 'me', type: 'text', text: String(text), at: Date.now() });
  }

  async function typing(token) {
    if (!view || reducedMotion()) return;
    const dots = SM.ui.el('div', { class: 'msg msg-bot typing', 'aria-hidden': 'true' },
      SM.ui.el('p', { class: 'bubble', text: '…' }));
    view.log.appendChild(dots);
    scrollToBottom();
    await sleep(STEP_DELAY);
    dots.remove();
  }

  /** 흐름 실행. 화면을 떠나면 남은 단계는 멈춘다. */
  async function run(name) {
    const steps = SM.flows[name];
    if (!steps) { console.warn('[chat] 없는 흐름: ' + name); return; }
    const token = ++flowToken;
    const visible = !!view;
    if (view) SM.ui.clear(view.chips);
    for (const step of steps) {
      if (visible) {
        await typing(token);
        if (token !== flowToken || !view) return;
      }
      if (step.say !== undefined) say(step.say);
      else if (step.card) card(step.card);
      else if (step.choices) choices(step.choices);
    }
  }

  function pick(choice) {
    userSays(choice.label);
    if (choice.go) {
      location.hash = choice.go;
    } else if (choice.next) {
      run(choice.next);
    } else if (choice.action) {
      const fn = actions[choice.action];
      if (typeof fn === 'function') fn(choice);
      else console.warn('[chat] 없는 action: ' + choice.action);
    }
  }

  /** 자유 입력 처리. 19단계에서 키워드 규칙으로 바꾼다. */
  async function route(text) {
    const token = ++flowToken;
    await typing(token);
    if (token !== flowToken) return;
    say('아직 배우는 중이야. 아래에서 골라 줄래?');
    choices(MENU_CHOICES);
  }

  // ---------- 화면: #/chat ----------

  function chatScreen() {
    const el = SM.ui.el;
    const profile = me();

    const log = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': '대화' });
    const chips = el('div', { class: 'chip-row', role: 'group', 'aria-label': '빠른 답변' });
    const input = el('input', {
      type: 'text', maxlength: MAX_INPUT, autocomplete: 'off',
      placeholder: '메시지 입력', 'aria-label': '메시지 입력'
    });
    const sendBtn = el('button', { type: 'submit', class: 'btn btn-primary', text: '보내기' });
    const form = el('form', {
      class: 'composer-input',
      onSubmit(e) {
        e.preventDefault();
        const text = input.value.trim().slice(0, MAX_INPUT);
        if (!text) return;
        input.value = '';
        userSays(text);
        (SM.chat.route || route)(text);
      }
    }, input, sendBtn);

    const node = el('section', { class: 'chat' },
      el('h2', { class: 'visually-hidden', text: '챗봇 대화' }),
      log,
      el('div', { class: 'composer' }, chips, form)
    );

    view = { log, chips, input, sendBtn };

    // 기록 복원
    const history = loadHistory();
    history.forEach((m) => { if (m.type !== 'choices') log.appendChild(renderMessage(m)); });
    const last = history[history.length - 1];

    setTimeout(() => {
      if (!view || view.log !== log) return;
      scrollToBottom();
      if (profile && profile.greeted === false) {
        SM.store.update(SM.keys.profile(profile.sid), (p) => Object.assign({}, p, { greeted: true }), profile);
        run('welcome');
      } else if (last && last.type === 'choices') {
        showChoices(last.choices);
      } else {
        run('menu');
      }
    }, 0);

    return {
      node,
      cleanup() {
        flowToken++;
        view = null;
      }
    };
  }

  SM.chat = {
    say, card, choices, run, route,
    vars, varProviders, actions,
    fill, fillCard, pushHistory,
    MAX_HISTORY
  };

  if (typeof SM.route === 'function') {
    SM.route('#/chat', { title: '챗봇', render: chatScreen });
  }
})(window.SM = window.SM || {});
