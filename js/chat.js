(function (SM) {
  'use strict';

  const DEFAULT_BOT_NAME = '공부 메이트';
  const BOT_NAME_MAX = 12;
  const STEP_DELAY = 400;
  const MAX_HISTORY = 100;
  const MAX_INPUT = 200;

  // ---------- 흐름 데이터 ----------
  // step: { say } | { card: { title, lines, actions:[{label, go}] } }
  //     | { choices: [{ label, go } | { label, next } | { label, action } | { label, href }] }

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
      { say: '나는 너의 {botName}야. 진단 → 전략 → 계획 → 점검을 같이 해 볼 거야.' },
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

  /** 받침이 있으면 a, 없으면 b. 한글이 아닌 글자로 끝나면 b. */
  function josa(word, a, b) {
    const s = String(word || '');
    const code = s.charCodeAt(s.length - 1);
    if (code >= 0xac00 && code <= 0xd7a3) return s + ((code - 0xac00) % 28 ? a : b);
    return s + b;
  }

  /** 공백을 모두 지우고 소문자로 */
  function normalize(text) {
    return String(text || '').replace(/\s+/g, '').toLowerCase();
  }

  function intentsData() { return SM.data.intents; }

  /** 입력에서 과목 찾기 → config.subjects 이름 또는 null. 앞쪽에 나온 과목이 우선. */
  function findSubject(text, intents) {
    const norm = normalize(text);
    const aliases = (intents || intentsData()).subjectAliases || {};
    let best = null;
    Object.keys(aliases).forEach((subject) => {
      aliases[subject].forEach((w) => {
        const at = norm.indexOf(normalize(w));
        if (at !== -1 && (!best || at < best.at)) best = { subject, at };
      });
    });
    return best ? best.subject : null;
  }

  /** 전략 이름·별칭 찾기 → 전략 id 또는 null. 더 긴 이름이 우선(‘교차 연습’ > ‘교차’). */
  function findStrategy(text, intents, strategies) {
    const norm = normalize(text);
    const aliases = (intents || intentsData()).strategyAliases || {};
    let best = null;
    (strategies || SM.data.strategies).forEach((s) => {
      [s.name].concat(aliases[s.id] || []).forEach((w) => {
        const n = normalize(w);
        if (n && norm.indexOf(n) !== -1 && (!best || n.length > best.len)) best = { id: s.id, len: n.length };
      });
    });
    return best ? best.id : null;
  }

  /**
   * 자유 입력 → { intent, subject, strategyId, view, anxious }
   * intent: 'crisis' | intents.order 중 하나 | 'unknown'
   * 위기 표현은 다른 낱말이 함께 있어도 가장 먼저 본다.
   */
  function matchIntent(text, intents, strategies) {
    const I = intents || intentsData();
    const norm = normalize(text);
    const has = (w) => norm.indexOf(normalize(w)) !== -1;
    const out = { intent: 'unknown', subject: findSubject(norm, I), strategyId: findStrategy(norm, I, strategies), view: null, anxious: false };
    if (!norm) return out;
    if ((I.crisis || []).some(has)) { out.intent = 'crisis'; return out; }
    for (const name of I.order) {
      let hit = false;
      if (name === 'strategyName') hit = !!out.strategyId;
      else hit = ((I.keywords || {})[name] || []).some(has) ||
        (((I.exact || {})[name] || []).some((w) => norm === normalize(w)));
      if (hit) { out.intent = name; break; }
    }
    if (out.intent === 'distress') out.anxious = (I.anxious || []).some(has);
    if (out.intent === 'planner') {
      const v = (I.plannerViews || []).find(([w]) => has(w));
      out.view = v ? v[1] : 'day';
    }
    return out;
  }

  /**
   * 첫 인사 고르기(위에서부터 처음 맞는 것 하나).
   * state = {
   *   today: 'YYYY-MM-DD', hasResult, testInProgress, hasPlanStrategies,
   *   weekSubmitted, yesterdayUnrecorded: 숫자, todayBlocks: 숫자, todayGridEntries: 숫자,
   *   unread: { count, names: [닉네임] }, dday: { label } | null, todayStrategy: '전략 이름' | null,
   *   retest: SM.recommend.shouldRetest 결과 배열
   * }
   * → { id, lines: [문장], choices: [칩] }  (재진단 제안이 있으면 lines·choices 뒤에 덧붙인다)
   */
  function pickGreeting(state) {
    const s = state || {};
    const today = s.today || SM.date.today();
    let g;
    if (!s.hasResult || s.testInProgress) {
      g = {
        id: 'test',
        lines: ['반가워! 먼저 너의 공부 스타일부터 알아볼까?'],
        choices: [s.testInProgress ? { label: '이어서 하기', go: '#/test' } : { label: '시작하기', go: '#/test' }]
      };
      return g; // 진단 전에는 재진단 제안을 붙이지 않는다
    } else if (!s.hasPlanStrategies) {
      g = { id: 'strategy', lines: ['추천 전략을 아직 플래너에 안 넣었어.'], choices: [{ label: '전략 보기', go: '#/strategy' }] };
    } else if (SM.date.weekday(today) === 6 && !s.weekSubmitted) {
      g = {
        id: 'checkin',
        lines: ['이번 주 돌아보기 할 시간이야. 3분이면 돼.'],
        choices: [{ label: '점검하기', go: '#/check/week' }, { label: '나중에', next: 'menu' }]
      };
    } else if ((s.yesterdayUnrecorded || 0) > 0) {
      g = {
        id: 'record',
        lines: ['어제 공부 어땠어? 기록을 남겨 보자.'],
        choices: [{ label: '기록하기', go: '#/planner/day?d=' + SM.date.addDays(today, -1) }]
      };
    } else if (!s.todayBlocks) {
      g = {
        id: 'today',
        lines: ['오늘 계획을 아직 안 세웠어. 주간 배치표에서 불러올까?'],
        // 배치표가 비었으면 '불러오기'는 주간 배치표로 보낸다
        choices: [
          { label: '불러오기', go: s.todayGridEntries ? '#/planner/day' : '#/planner/week' },
          { label: '직접 쓰기', action: 'blankDay' }
        ]
      };
    } else if (s.unread && s.unread.count > 0) {
      const names = s.unread.names || [];
      const who = names.length > 1 ? `${names[0]} 외 ${names.length - 1}명이` : josa(names[0] || '친구', '이', '가');
      g = { id: 'comment', lines: [`${who} 네 계획에 댓글을 남겼어!`], choices: [{ label: '보러 가기', go: '#/class' }] };
    } else {
      const parts = [];
      if (s.dday && s.dday.label) parts.push(`${s.dday.label}까지 같이 가 보자.`);
      parts.push(s.todayStrategy ? `오늘의 핵심 전략은 ${s.todayStrategy}!` : '오늘도 한 블록씩 해 보자!');
      g = {
        id: 'daily',
        lines: [parts.join(' ')],
        choices: [{ label: '오늘 계획', go: '#/planner/day' }, { label: '우리 반 보기', go: '#/class' }]
      };
    }
    const r = (s.retest || [])[0];
    if (r) {
      g.lines = g.lines.concat([r.text]);
      g.choices = g.choices.concat([{ label: r.type === 'retest' ? '다시 진단하기' : '전략 바꿔 보기', go: r.go }]);
      g.retest = r.type;
    }
    return g;
  }

  // ---------- 상태 ----------

  let view = null;      // { log, chips, input, sendBtn } — 채팅 화면이 열려 있을 때만
  let flowToken = 0;

  function me() { return SM.auth && SM.auth.current(); }

  function botName(profile) {
    const p = profile === undefined ? me() : profile;
    const n = p && typeof p.botName === 'string' ? p.botName.trim() : '';
    return n || (SM.config && SM.config.botName) || DEFAULT_BOT_NAME;
  }

  function historyKey(sid) {
    if (sid) return SM.keys.chat(sid);
    const p = me();
    return p ? SM.keys.chat(p.sid) : null;
  }

  function loadHistory() {
    const key = historyKey();
    return key ? SM.store.get(key, []) : [];
  }

  function saveMessage(msg, sid) {
    const key = historyKey(sid);
    if (!key) return;
    SM.store.update(key, (list) => pushHistory(list, msg), []);
  }

  /** 자리 표시 값. SM.chat.varProviders에 함수를 추가해 확장한다. */
  const varProviders = [];
  function vars() {
    const p = me();
    const out = { nickname: p ? p.nickname : '', botName: botName(p), subject: '', dday: '' };
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
    if (msg.type === 'notice') {
      return el('div', { class: 'msg msg-notice' }, el('p', { class: 'chat-notice', text: msg.text }));
    }
    const bot = msg.from === 'bot';
    const name = el('span', { class: 'msg-name', text: bot ? botName() : '나' });
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

  function showChoices(list) {
    if (!view) return;
    SM.ui.clear(view.chips);
    (list || []).forEach((c) => {
      // 전화 걸기처럼 앱 밖으로 나가는 칩은 링크로 둔다(tel:만 허용)
      if (c.href && /^tel:[0-9]+$/.test(c.href)) {
        view.chips.appendChild(SM.ui.el('a', { class: 'chip', href: c.href, text: c.label }));
        return;
      }
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

  /**
   * 다른 화면에서 일어난 일을 챗봇 기록에 짧게 남긴다(알림 줄).
   * options.sid: 다른 학생의 기록에 남길 때(예: 내 댓글 → 계획 주인). 기본은 지금 입장한 학생.
   */
  function notify(text, options) {
    const t = String(text || '').trim();
    if (!t) return null;
    const o = options || {};
    const p = me();
    const msg = { from: 'bot', type: 'notice', text: t, at: Date.now() };
    if (o.sid && (!p || o.sid !== p.sid)) { saveMessage(msg, o.sid); return msg; }
    return addMessage(msg);
  }

  function userSays(text) {
    if (view) SM.ui.clear(view.chips);
    return addMessage({ from: 'me', type: 'text', text: String(text), at: Date.now() });
  }

  async function typing() {
    if (!view || reducedMotion()) return;
    const dots = SM.ui.el('div', { class: 'msg msg-bot typing', 'aria-hidden': 'true' },
      SM.ui.el('p', { class: 'bubble', text: '…' }));
    view.log.appendChild(dots);
    scrollToBottom();
    await sleep(STEP_DELAY);
    dots.remove();
  }

  /** 단계 목록 실행. 화면을 떠나거나 다른 흐름이 시작되면 남은 단계는 멈춘다. */
  async function runSteps(steps, options) {
    const token = ++flowToken;
    // instant: 위기 응답처럼 기다리게 하면 안 되는 말은 '입력 중…' 없이 바로 보낸다
    const visible = !!view && !(options && options.instant);
    if (view) SM.ui.clear(view.chips);
    for (const step of steps) {
      if (visible) {
        await typing();
        if (token !== flowToken || !view) return;
      }
      if (step.say !== undefined) say(step.say);
      else if (step.card) card(step.card);
      else if (step.choices) choices(step.choices);
    }
  }

  function run(name) {
    const steps = SM.flows[name];
    if (!steps) { console.warn('[chat] 없는 흐름: ' + name); return Promise.resolve(); }
    return runSteps(steps);
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

  // ---------- 상태 모으기(저장소 → pickGreeting 입력) ----------

  function strategyName(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : null;
  }

  function firstStrategyOf(map) {
    const subj = Object.keys(map || {}).find((k) => Array.isArray(map[k]) && map[k].length);
    return subj ? map[subj][0] : null;
  }

  function collectState(profile, now) {
    const sid = profile.sid;
    const date = now instanceof Date ? now : new Date();
    const today = SM.date.today(date);
    const results = SM.store.get(SM.keys.results(sid), []);
    const plan = SM.store.get(SM.keys.plan(sid), null);
    const checkins = SM.store.get(SM.keys.checkin(sid), []);
    const wk = SM.date.isoWeek(today);
    const week = SM.planner.normalizeWeek(SM.planner.getWeek(wk));
    const todayBlocks = SM.planner.getDay(today);
    const yesterday = SM.planner.getDay(SM.date.addDays(today, -1));
    const dayKey = SM.planner.DAY_KEYS[SM.date.weekday(today)];
    const entry = SM.checkin.find(checkins, wk);

    const fromBlock = todayBlocks.find((b) => b.strategy);
    const todayStrategy = strategyName(fromBlock ? fromBlock.strategy : null) ||
      strategyName(firstStrategyOf(week.strategies)) ||
      strategyName(firstStrategyOf(plan && plan.strategies));

    return {
      today,
      hasResult: Array.isArray(results) && results.length > 0,
      testInProgress: !!SM.store.get(SM.keys.testProgress(sid), null),
      hasPlanStrategies: !!(plan && firstStrategyOf(plan.strategies)),
      weekSubmitted: !!(entry && entry.submittedAt),
      yesterdayUnrecorded: yesterday.filter((b) => !b.done).length,
      todayBlocks: todayBlocks.length,
      todayGridEntries: ((week.grid || {})[dayKey] || []).length,
      unread: { count: SM.feed.unreadFor(sid), names: SM.feed.unreadFrom(sid) },
      dday: SM.planner.nextDday(today),
      todayStrategy,
      retest: SM.recommend.shouldRetest(results, checkins, date)
    };
  }

  function metaKey(sid) { return SM.keys.chatMeta(sid); }

  /** 하루 한 번 첫 인사. 이미 했으면 false. */
  function greet(options) {
    const p = me();
    if (!p) return Promise.resolve(false);
    const o = options || {};
    const today = SM.date.today();
    const meta = SM.store.get(metaKey(p.sid), {}) || {};
    if (!o.force && meta.greetedOn === today) return Promise.resolve(false);
    SM.store.set(metaKey(p.sid), Object.assign({}, meta, { greetedOn: today }));
    let g;
    try {
      g = pickGreeting(collectState(p));
    } catch (e) {
      console.warn('[chat] 인사 상태 계산 실패', e);
      g = { lines: ['무엇을 해 볼까?'], choices: MENU_CHOICES };
    }
    return runSteps(g.lines.map((l) => ({ say: l })).concat([{ choices: g.choices }])).then(() => true);
  }

  // 오늘 블록을 비운 채로 시작(배치표에서 미리 만들지 않음)
  actions.blankDay = function () {
    const iso = SM.date.today();
    const d = SM.planner.getDayData(iso);
    SM.planner.saveDayData(iso, Object.assign({}, d, { prefilled: true }));
    location.hash = '#/planner/day';
  };

  // 지금부터 10분짜리 작은 블록 하나
  actions.smallBlock = function () {
    const iso = SM.date.today();
    const d = SM.planner.getDayData(iso);
    const now = new Date();
    const hm = (t) => String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const r = SM.planner.addBlock(d.blocks, SM.planner.newBlock({
      start: hm(now), end: hm(new Date(now.getTime() + 10 * 60000)), topic: '10분만 해 보기'
    }));
    if (!r.added) { say('오늘 블록이 꽉 찼어. 하나만 골라서 10분만 해 보자.'); return; }
    SM.planner.saveDayData(iso, Object.assign({}, d, { blocks: r.blocks, prefilled: true }));
    location.hash = '#/planner/day';
  };

  // ---------- 자유 입력 ----------

  function strategyCard(id, go) {
    const s = SM.data.strategies.find((x) => x.id === id);
    if (!s) return null;
    return { title: s.name, lines: [s.why].concat(s.howTo.slice(0, 3)), actions: [{ label: '전략 화면에서 보기', go: go || '#/strategy' }] };
  }

  /** 자유 입력 → 보낼 단계 목록. 저장소를 읽기만 한다. */
  function replyFor(text, profile) {
    const m = matchIntent(text);
    const sid = profile ? profile.sid : null;
    const results = sid ? SM.store.get(SM.keys.results(sid), []) : [];
    const latest = results.length ? results[results.length - 1] : null;
    const plan = sid ? SM.store.get(SM.keys.plan(sid), null) : null;

    switch (m.intent) {
      case 'crisis': {
        const c = (SM.config && SM.config.crisis) || {};
        return (c.lines || []).map((l) => ({ say: l })).concat(c.choices && c.choices.length ? [{ choices: c.choices }] : []);
      }
      case 'distress':
        if (m.anxious) {
          return [
            { say: '불안한 마음 들 수 있어. 말해 줘서 고마워.' },
            { say: '걱정을 10분 동안 종이에 그대로 써 보면 마음이 좀 가벼워지기도 해.' },
            { choices: [{ label: '표현적 글쓰기 보기', action: 'showStrategy', id: 'expressiveWriting' }, { label: '10분 블록 만들기', action: 'smallBlock' }] }
          ];
        }
        return [
          { say: '그럴 때 있지. 많이 지쳤구나.' },
          { say: '10분짜리 작은 블록부터 해 볼까?' },
          { choices: [{ label: '10분 블록 만들기', action: 'smallBlock' }, { label: '오늘은 쉴래', next: 'rest' }] }
        ];
      case 'history':
        if (!latest) {
          return [{ say: '아직 진단 결과가 없어. 진단을 하면 결과가 기록으로 쌓여.' }, { choices: [{ label: '진단 시작하기', go: '#/test' }] }];
        }
        return [{
          card: {
            title: '결과 기록',
            lines: results.length > 1
              ? [`지금까지 진단을 ${results.length}번 했어.`, '지난 결과와 차원별로 비교해 볼 수 있어.']
              : ['아직 결과가 하나야.', '4주쯤 뒤에 다시 검사하면 여기서 비교할 수 있어.'],
            actions: results.length > 1
              ? [{ label: '지난번과 비교하기', go: '#/result/history?compare=1' }, { label: '결과 기록 보기', go: '#/result/history' }]
              : [{ label: '결과 기록 보기', go: '#/result/history' }]
          }
        }];
      case 'test':
        if (!latest) {
          return [{ say: '아직 진단을 안 했어. 10분 정도면 끝나.' }, { choices: [{ label: '진단 시작하기', go: '#/test' }] }];
        }
        return [{
          card: {
            title: '나의 학습 스타일',
            lines: [SM.test.summary(latest), `진단한 날: ${String(latest.takenAt || '').slice(0, 10) || '기록 없음'}`],
            actions: [{ label: '결과 자세히 보기', go: '#/result' }, { label: '다시 진단하기', go: '#/test' }]
          }
        }];
      case 'strategy': {
        if (m.strategyId) return [{ card: strategyCard(m.strategyId) }];
        if (!latest) {
          return [{ say: '진단을 하면 너한테 맞는 전략을 골라 줄게.' }, { choices: [{ label: '진단 시작하기', go: '#/test' }] }];
        }
        const subjects = Object.keys((plan && plan.strategies) || {}).concat(latest.subjects || []);
        const subject = m.subject || subjects[0] || SM.config.subjects[0];
        const saved = plan && plan.strategies && plan.strategies[subject];
        const ids = (saved && saved.length ? saved : SM.recommend.forSubject(latest, subject).map((x) => x.id)).slice(0, 3);
        return [{
          card: {
            title: `${subject} 추천 전략`,
            lines: ids.map((id) => {
              const s = SM.data.strategies.find((x) => x.id === id);
              return s ? `${s.name}: ${s.howTo[0]}` : '';
            }).filter(Boolean),
            actions: [{ label: '전략 화면에서 보기', go: '#/strategy?s=' + encodeURIComponent(subject) }]
          }
        }];
      }
      case 'planner': {
        const label = { day: '오늘', week: '이번 주', month: '이번 달' }[m.view];
        return [{ say: `${label} 플래너를 열어 볼까?` }, { choices: [{ label: `${label} 플래너 열기`, go: '#/planner/' + m.view }] }];
      }
      case 'check':
        return [{ say: '한 주를 돌아보면 다음 주 계획이 쉬워져.' }, {
          choices: [{ label: '날마다 기록 보기', go: '#/check' }, { label: '이번 주 점검표', go: '#/check/week' }, { label: '월간 리포트', go: '#/check/month' }]
        }];
      case 'class':
        return [{ say: '우리 반 친구들이 공개한 계획을 볼 수 있어.' }, { choices: [{ label: '우리 반 보기', go: '#/class' }] }];
      case 'settings':
        return [{ say: '설정에서 내 이름을 바꿀 수 있어.' }, { choices: [{ label: '설정 열기', go: '#/settings' }] }];
      case 'strategyName':
        return [{ card: strategyCard(m.strategyId) }];
      default:
        return [{ say: '잘 못 알아들었어. 이 중에 골라 줄래?' }, { choices: MENU_CHOICES }];
    }
  }

  SM.flows.rest = [
    { say: '좋아, 쉬는 것도 중요해. 내일 다시 같이 하자.' },
    { choices: MENU_CHOICES }
  ];

  actions.showStrategy = function (choice) {
    const c = strategyCard(choice.id);
    if (c) runSteps([{ card: c }]);
  };

  /** 자유 입력 처리 */
  function route(text) {
    const crisis = matchIntent(text).intent === 'crisis';
    return runSteps(replyFor(text, me()), { instant: crisis });
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
        SM.chat.route(text);
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

    setTimeout(async () => {
      if (!view || view.log !== log) return;
      scrollToBottom();
      if (profile && profile.greeted === false) {
        SM.store.update(SM.keys.profile(profile.sid), (p) => Object.assign({}, p, { greeted: true }), profile);
        const meta = SM.store.get(metaKey(profile.sid), {}) || {};
        SM.store.set(metaKey(profile.sid), Object.assign({}, meta, { greetedOn: SM.date.today() }));
        run('welcome');
        return;
      }
      if (await greet()) return;
      if (!view || view.log !== log) return;
      if (last && last.type === 'choices') showChoices(last.choices);
      else run('menu');
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
    say, card, choices, notify, run, route, greet,
    vars, varProviders, actions, botName,
    fill, fillCard, pushHistory, josa, normalize,
    findSubject, findStrategy, matchIntent, pickGreeting, replyFor, collectState,
    MAX_HISTORY, BOT_NAME_MAX, DEFAULT_BOT_NAME
  };

  if (typeof SM.route === 'function') {
    SM.route('#/chat', { title: '챗봇', render: chatScreen });
  }
})(window.SM = window.SM || {});
