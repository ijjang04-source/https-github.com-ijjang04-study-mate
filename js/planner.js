(function (SM) {
  'use strict';

  // 기능 3: 월·주·일 플래너
  //
  // 저장 형식: 키 SM.keys.planner(sid, 'YYYY-MM') 하나에 그 달의 데이터
  // {
  //   month: { goals: [문자열], events: [{ id, date, title, kind }], weekFocus: { '2026-W46': 문자열 },
  //            focusStrategies: [전략 id], woop: { wish, outcome, obstacle, plan }, public: false, woopSuggested },
  //   weeks: { '2026-W46': { ... } },     // 주의 월요일이 속한 달 키에 저장(monthKeyForWeek)
  //   days:  { '2026-11-13': { blocks: [...] } }
  // }

  const EVENT_KINDS = ['중간고사', '기말고사', '수행평가', '모의고사', '기타'];
  const EXAM_KINDS = ['중간고사', '기말고사', '수행평가', '모의고사'];
  const MAX_GOALS = 3;
  const MAX_FOCUS = 3;

  // ---------- 순수 함수 ----------

  /** 주의 데이터가 저장될 달 = 그 주 월요일이 속한 달. 이 규칙은 여기서만 처리한다. */
  function monthKeyForWeek(isoWeek) {
    return SM.date.monthKey(SM.date.weekDays(isoWeek)[0]);
  }

  function shiftMonth(key, n) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key));
    if (!m) throw new Error('잘못된 월 형식: ' + key);
    const total = (+m[1]) * 12 + (+m[2] - 1) + n;
    return Math.floor(total / 12) + '-' + String(total % 12 + 1).padStart(2, '0');
  }

  /** 달력 줄: [[iso|null × 7], ...] 월요일 시작 */
  function calendarRows(monthKey) {
    const days = SM.date.monthDays(monthKey);
    const rows = [];
    let row = new Array(SM.date.weekday(days[0])).fill(null);
    days.forEach((iso) => {
      row.push(iso);
      if (row.length === 7) { rows.push(row); row = []; }
    });
    if (row.length) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return rows;
  }

  function emptyMonth() {
    return {
      month: {
        goals: [''], events: [], weekFocus: {}, focusStrategies: [],
        woop: { wish: '', outcome: '', obstacle: '', plan: '' }, public: false
      },
      weeks: {},
      days: {}
    };
  }

  function normalize(data) {
    const base = emptyMonth();
    const d = data && typeof data === 'object' ? data : {};
    const month = Object.assign({}, base.month, d.month || {});
    month.woop = Object.assign({}, base.month.woop, (d.month && d.month.woop) || {});
    if (!Array.isArray(month.goals) || !month.goals.length) month.goals = [''];
    if (!Array.isArray(month.events)) month.events = [];
    if (!Array.isArray(month.focusStrategies)) month.focusStrategies = [];
    return { month, weeks: Object.assign({}, d.weeks || {}), days: Object.assign({}, d.days || {}) };
  }

  /**
   * 가장 가까운 시험 일정(오늘 포함). '기타'는 제외. 같은 날이면 입력 순서.
   * → { date, title, kind, days, label: 'D-15 수학 수행평가' } | null
   */
  function ddayFrom(events, today) {
    const upcoming = (events || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e && EXAM_KINDS.indexOf(e.kind) !== -1 && e.date >= today)
      .sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i));
    if (!upcoming.length) return null;
    const e = upcoming[0].e;
    const days = SM.date.daysBetween(today, e.date);
    const title = String(e.title || '').trim();
    const name = title ? (title.indexOf(e.kind) !== -1 ? title : `${title} ${e.kind}`) : e.kind;
    return { date: e.date, title, kind: e.kind, days, label: `${days === 0 ? 'D-DAY' : 'D-' + days} ${name}` };
  }

  // ---------- 저장(인스턴스) ----------

  function createPlanner(deps) {
    const store = deps.store;
    const sidOf = typeof deps.sid === 'function' ? deps.sid : () => deps.sid;

    function key(monthKey) {
      const sid = sidOf();
      if (!sid) throw new Error('입장한 학생이 없어요.');
      return SM.keys.planner(sid, monthKey);
    }

    function load(monthKey) { return normalize(store.get(key(monthKey), null)); }
    function save(monthKey, data) { return store.set(key(monthKey), normalize(data)); }

    function getWeek(isoWeek) {
      return load(monthKeyForWeek(isoWeek)).weeks[isoWeek] || {};
    }
    function saveWeek(isoWeek, obj) {
      const mk = monthKeyForWeek(isoWeek);
      const data = load(mk);
      data.weeks[isoWeek] = obj;
      return save(mk, data);
    }
    function getDay(iso) {
      const d = load(SM.date.monthKey(iso)).days[iso];
      return d && Array.isArray(d.blocks) ? d.blocks : [];
    }
    function saveDay(iso, blocks) {
      const mk = SM.date.monthKey(iso);
      const data = load(mk);
      data.days[iso] = Object.assign({}, data.days[iso] || {}, { blocks: blocks || [] });
      return save(mk, data);
    }

    /** 저장된 모든 달의 일정에서 가장 가까운 시험 */
    function nextDday(today) {
      const sid = sidOf();
      if (!sid) return null;
      const prefix = `planner:${sid}:`;
      const events = [];
      store.keys(prefix).sort().forEach((k) => {
        const d = store.get(k, null);
        if (d && d.month && Array.isArray(d.month.events)) d.month.events.forEach((e) => events.push(e));
      });
      return ddayFrom(events, today || SM.date.today());
    }

    return { load, save, getWeek, saveWeek, getDay, saveDay, nextDday };
  }

  const instance = createPlanner({
    store: SM.store,
    sid: () => { const p = SM.auth && SM.auth.current(); return p ? p.sid : null; }
  });

  // ---------- 공통 화면 도우미 ----------

  function query() {
    const q = String(location.hash || '').split('?')[1] || '';
    const out = {};
    q.split('&').forEach((pair) => {
      if (!pair) return;
      const [k, v] = pair.split('=');
      try { out[decodeURIComponent(k)] = decodeURIComponent(v || ''); } catch (e) { /* 무시 */ }
    });
    return out;
  }

  function validIso(s) { try { SM.date.weekday(s); return true; } catch (e) { return false; } }
  function validWeek(s) { try { SM.date.weekDays(s); return true; } catch (e) { return false; } }
  function validMonth(s) { try { SM.date.monthDays(s); return true; } catch (e) { return false; } }

  function strategyName(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : id;
  }

  function loadPlan() {
    const p = SM.auth.current();
    return p ? SM.store.get(SM.keys.plan(p.sid), null) : null;
  }

  function hasResult() {
    const p = SM.auth.current();
    const list = p ? SM.store.get(SM.keys.results(p.sid), []) : [];
    return Array.isArray(list) && list.length > 0;
  }

  function latestResult() {
    const p = SM.auth.current();
    const list = p ? SM.store.get(SM.keys.results(p.sid), []) : [];
    return Array.isArray(list) && list.length ? list[list.length - 1] : null;
  }

  /** D-day 컴포넌트(월·주·일 공용) */
  function ddayEl() {
    const el = SM.ui.el;
    const d = instance.nextDday();
    if (!d) return el('p', { class: 'dday dday-none muted', text: '다가오는 시험 일정이 없어. 월간 달력에 넣어 둘 수 있어.' });
    return el('p', { class: 'dday', role: 'status' },
      el('strong', { text: d.label }),
      el('span', { class: 'muted', text: ` · ${SM.date.formatKorean(d.date)}` })
    );
  }

  /** 핵심 전략 띠 + 일곱 가지 전략 접기 */
  function stripEl(plan) {
    const el = SM.ui.el;
    const core = [];
    if (plan && plan.strategies) {
      Object.keys(plan.strategies).forEach((subject) => {
        const id = (plan.strategies[subject] || [])[0];
        if (id && core.length < 3) core.push({ subject, id });
      });
    }
    const rules = ((plan && plan.sevenRules) || []).filter((r) => r && String(r.text || '').trim());
    return el('div', { class: 'planner-strip' },
      core.length
        ? el('div', { class: 'chip-row', 'aria-label': '내 핵심 전략' },
          core.map((c) => el('a', { href: '#/strategy', class: 'chip chip-static', text: `${c.subject} · ${strategyName(c.id)}` })))
        : null,
      el('details', { class: 'seven-fold' },
        el('summary', { text: `나만의 일곱 가지 전략${rules.length ? ` (${rules.length})` : ''}` }),
        rules.length
          ? el('ol', null, rules.map((r) => el('li', { text: r.text })))
          : el('p', null, '아직 없어. ', el('a', { href: '#/strategy/seven', text: '만들러 가기' }))
      )
    );
  }

  // ---------- 화면: 공통 틀 ----------

  const VIEWS = [['month', '월간'], ['week', '주간'], ['day', '일간']];

  function plannerScreen(params) {
    const el = SM.ui.el;
    const view = params.view;
    const q = query();
    const today = SM.date.today();
    const plan = loadPlan();
    const saved = SM.ui.savedIndicator();
    let viewCleanup = null;

    // 기준 날짜
    let cur;
    if (view === 'month') cur = validMonth(q.m) ? q.m : SM.date.monthKey(today);
    else if (view === 'week') cur = validWeek(q.w) ? q.w : SM.date.isoWeek(today);
    else cur = validIso(q.d) ? q.d : today;

    function go(value) {
      const param = view === 'month' ? 'm' : view === 'week' ? 'w' : 'd';
      location.hash = `#/planner/${view}?${param}=${encodeURIComponent(value)}`;
    }
    function step(n) {
      if (view === 'month') go(shiftMonth(cur, n));
      else if (view === 'week') go(SM.date.isoWeek(SM.date.addDays(SM.date.weekDays(cur)[0], n * 7)));
      else go(SM.date.addDays(cur, n));
    }
    function todayValue() {
      return view === 'month' ? SM.date.monthKey(today) : view === 'week' ? SM.date.isoWeek(today) : today;
    }

    const tabs = el('nav', { class: 'tabs', 'aria-label': '플래너 보기' },
      VIEWS.map(([v, label]) => el('a', {
        href: `#/planner/${v}`, class: 'tab', text: label,
        'aria-current': v === view ? 'page' : null
      }))
    );

    const picker = el('input', {
      type: view === 'month' ? 'month' : view === 'week' ? 'week' : 'date',
      value: cur, 'aria-label': view === 'month' ? '달 선택' : view === 'week' ? '주 선택' : '날짜 선택',
      onChange(e) {
        const v = e.target.value;
        if ((view === 'month' && validMonth(v)) || (view === 'week' && validWeek(v)) || (view === 'day' && validIso(v))) go(v);
      }
    });

    const navBar = el('div', { class: 'planner-nav' },
      el('button', { type: 'button', class: 'btn', 'aria-label': '이전', text: '◀', onClick: () => step(-1) }),
      el('button', { type: 'button', class: 'btn', text: '오늘', onClick: () => go(todayValue()) }),
      el('button', { type: 'button', class: 'btn', 'aria-label': '다음', text: '▶', onClick: () => step(1) }),
      picker,
      saved.node
    );

    const notice = !hasResult() || !plan
      ? el('div', { class: 'card notice row' },
        el('p', { text: '전략을 먼저 고르면 플래너가 더 쉬워져.' }),
        el('a', { href: hasResult() ? '#/strategy' : '#/test', class: 'btn', text: hasResult() ? '전략 고르기' : '진단하러 가기' }))
      : null;

    const ctx = { cur, today, plan, saved, el };
    let body;
    if (view === 'month') {
      const r = monthView(ctx);
      body = r.node; viewCleanup = r.cleanup;
    } else {
      body = el('div', { class: 'card stack' },
        el('h3', { text: view === 'week' ? `주간 플래너 · ${cur}` : `일간 플래너 · ${SM.date.formatKorean(cur)}` }),
        el('p', { class: 'muted', text: '준비 중이에요. 월간 플래너는 지금 쓸 수 있어.' }),
        el('a', { href: '#/planner/month', class: 'btn', text: '월간 플래너 보기' })
      );
    }

    const node = el('section', { class: 'planner stack' },
      el('h2', { class: 'visually-hidden', text: '플래너' }),
      tabs,
      stripEl(plan),
      notice,
      navBar,
      ddayEl(),
      body
    );

    return { node, cleanup: () => { if (viewCleanup) viewCleanup(); } };
  }

  // ---------- 화면: 월간 ----------

  function monthView(ctx) {
    const { cur: mk, today, plan, saved, el } = ctx;
    const data = instance.load(mk);
    const M = data.month;
    let dirty = false;

    const persist = SM.ui.debounce(() => { instance.save(mk, data); dirty = false; saved.set('saved'); }, 500);
    function changed() { dirty = true; saved.set('saving'); persist(); }
    function flush() { persist.cancel(); instance.save(mk, data); dirty = false; saved.set('saved'); }

    const [y, m] = mk.split('-');
    const root = el('div', { class: 'stack' });

    // --- 이달의 목표 ---
    const goalsBox = el('div', { class: 'stack' });
    function renderGoals() {
      SM.ui.clear(goalsBox);
      M.goals.forEach((g, i) => {
        const input = el('input', {
          type: 'text', maxlength: 60, 'aria-label': `이달의 목표 ${i + 1}`, placeholder: '예) 수학 이차함수 개념 완성',
          onInput(e) { M.goals[i] = e.target.value; changed(); }
        });
        input.value = g;
        goalsBox.appendChild(el('div', { class: 'row goal-row' },
          el('span', { class: 'seven-num', text: String(i + 1) }),
          input,
          el('button', {
            type: 'button', class: 'btn btn-ghost', text: '삭제', 'aria-label': `목표 ${i + 1} 삭제`,
            onClick() {
              M.goals.splice(i, 1);
              if (!M.goals.length) M.goals.push('');
              flush(); renderGoals();
            }
          })
        ));
      });
      goalsBox.appendChild(el('button', {
        type: 'button', class: 'btn', text: '+ 목표 추가', disabled: M.goals.length >= MAX_GOALS,
        onClick() { M.goals.push(''); flush(); renderGoals(); const inputs = goalsBox.querySelectorAll('input'); inputs[inputs.length - 1].focus(); }
      }));
    }
    renderGoals();

    // --- 달력 ---
    const calBox = el('div');
    const eventBox = el('div', { class: 'stack', 'aria-live': 'polite' });
    let selected = null;

    function eventsOn(iso) { return M.events.filter((e) => e.date === iso); }

    function renderCalendar() {
      SM.ui.clear(calBox);
      const head = SM.date.WEEKDAY_KO.map((w) => el('div', { class: 'cal-head', text: w, 'aria-hidden': 'true' }));
      const cells = [];
      calendarRows(mk).forEach((row) => row.forEach((iso) => {
        if (!iso) { cells.push(el('div', { class: 'cal-cell cal-empty', 'aria-hidden': 'true' })); return; }
        const evs = eventsOn(iso);
        const dayNum = +iso.slice(8);
        const isToday = iso === today;
        const label = `${SM.date.formatKorean(iso)}${isToday ? ', 오늘' : ''}${evs.length ? `, 일정 ${evs.length}개: ${evs.map((e) => e.title || e.kind).join(', ')}` : ''}`;
        cells.push(el('button', {
          type: 'button',
          class: 'cal-cell' + (isToday ? ' cal-today' : '') + (iso === selected ? ' cal-selected' : ''),
          'aria-label': label, 'aria-pressed': String(iso === selected),
          onClick() { selected = iso; renderCalendar(); renderEventPanel(); }
        },
          el('span', { class: 'cal-num', text: String(dayNum) }),
          isToday ? el('span', { class: 'cal-today-text', text: '오늘' }) : null,
          evs.length ? el('span', { class: 'cal-events', 'aria-hidden': 'true' },
            evs.slice(0, 2).map((e) => el('span', { class: 'cal-ev', text: '● ' + (String(e.title || e.kind).trim().charAt(0)) })),
            evs.length > 2 ? el('span', { class: 'cal-ev', text: `+${evs.length - 2}` }) : null
          ) : null
        ));
      }));
      calBox.appendChild(el('div', { class: 'cal-grid' }, head, cells));
    }

    function renderEventPanel() {
      SM.ui.clear(eventBox);
      if (!selected) {
        eventBox.appendChild(el('p', { class: 'muted', text: '날짜를 누르면 일정을 넣을 수 있어.' }));
        return;
      }
      const list = eventsOn(selected);
      let kind = '수행평가';
      const title = el('input', { type: 'text', maxlength: 30, placeholder: '예) 수학', 'aria-label': '일정 제목' });
      const kindChips = EVENT_KINDS.map((k) => el('button', {
        type: 'button', class: 'chip' + (k === kind ? ' chip-on' : ''), 'aria-pressed': String(k === kind), text: k,
        onClick(e) {
          kind = k;
          kindChips.forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('chip-on', on); b.setAttribute('aria-pressed', String(on)); });
        }
      }));
      eventBox.append(
        el('h4', { text: `${SM.date.formatKorean(selected)} 일정` }),
        list.length
          ? el('ul', { class: 'event-list' }, list.map((ev) => el('li', { class: 'row' },
            el('span', { text: `${ev.title ? ev.title + ' · ' : ''}${ev.kind}` }),
            el('button', {
              type: 'button', class: 'btn btn-ghost', text: '삭제', 'aria-label': `${ev.title || ev.kind} 삭제`,
              onClick() {
                M.events = M.events.filter((x) => x.id !== ev.id);
                flush(); renderCalendar(); renderEventPanel(); refreshDday();
              }
            }))))
          : el('p', { class: 'muted', text: '아직 일정이 없어.' }),
        el('form', {
          class: 'stack',
          onSubmit(e) {
            e.preventDefault();
            const t = title.value.trim();
            M.events.push({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: selected, title: t, kind });
            flush(); renderCalendar(); renderEventPanel(); refreshDday();
            SM.ui.toast('일정을 넣었어.');
          }
        },
          el('div', { class: 'field' }, el('label', { text: '제목', for: 'ev-title' }), title),
          el('div', { class: 'chip-row', role: 'group', 'aria-label': '일정 종류' }, kindChips),
          el('button', { type: 'submit', class: 'btn btn-primary', text: '일정 추가' })
        )
      );
      title.id = 'ev-title';
    }

    function refreshDday() {
      const old = document.querySelector('.planner .dday');
      if (old) old.replaceWith(ddayEl());
    }

    renderCalendar();
    renderEventPanel();

    // --- 주차별 초점 ---
    const weekRows = calendarRows(mk).map((row, i) => {
      const firstDay = row.find(Boolean);
      const w = SM.date.isoWeek(firstDay);
      const days = SM.date.weekDays(w);
      const short = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}`;
      const input = el('input', {
        type: 'text', maxlength: 60, 'aria-label': `${i + 1}주차 초점`, placeholder: '예) 수학 이차함수 교차 연습',
        onInput(e) { M.weekFocus[w] = e.target.value; changed(); }
      });
      input.value = M.weekFocus[w] || '';
      return el('div', { class: 'field' },
        el('span', { class: 'label', text: `${i + 1}주차 (${short(days[0])}~${short(days[6])})` }),
        input
      );
    });

    // --- 이달 집중 전략 ---
    const planIds = [];
    if (plan && plan.strategies) Object.keys(plan.strategies).forEach((s) => (plan.strategies[s] || []).forEach((id) => { if (planIds.indexOf(id) === -1) planIds.push(id); }));
    const focusCount = el('p', { class: 'muted', 'aria-live': 'polite' });
    const chipMap = {};
    function focusChip(id) {
      const on = M.focusStrategies.indexOf(id) !== -1;
      const b = el('button', {
        type: 'button', class: 'chip' + (on ? ' chip-on' : ''), 'aria-pressed': String(on), text: strategyName(id),
        onClick() {
          const at = M.focusStrategies.indexOf(id);
          if (at !== -1) M.focusStrategies.splice(at, 1);
          else if (M.focusStrategies.length >= MAX_FOCUS) { SM.ui.toast('3개까지 고를 수 있어.'); return; }
          else M.focusStrategies.push(id);
          syncFocus();
          flush();
        }
      });
      (chipMap[id] = chipMap[id] || []).push(b);
      return b;
    }
    function syncFocus() {
      Object.keys(chipMap).forEach((id) => chipMap[id].forEach((b) => {
        const on = M.focusStrategies.indexOf(id) !== -1;
        b.classList.toggle('chip-on', on);
        b.setAttribute('aria-pressed', String(on));
      }));
      focusCount.textContent = `${M.focusStrategies.length}개 골랐어 (1~3개)`;
    }
    const focusSection = el('section', { class: 'card stack' },
      el('h3', { text: '이달 집중 전략' }),
      el('p', { class: 'muted', text: '여기서 고른 전략이 주간 플래너의 선택지가 돼.' }),
      planIds.length ? el('div', { class: 'chip-row', role: 'group', 'aria-label': '추천 전략' }, planIds.map(focusChip)) : null,
      el('details', null,
        el('summary', { text: '전체 전략 32개에서 고르기' }),
        el('div', { class: 'chip-row', role: 'group', 'aria-label': '전체 전략' },
          SM.data.strategies.filter((s) => planIds.indexOf(s.id) === -1).map((s) => focusChip(s.id)))
      ),
      focusCount
    );
    syncFocus();

    // --- WOOP ---
    const result = latestResult();
    const avoid = result ? SM.score.poles(result).some((p) => p.key === 'goal:avoid') : false;
    const woopField = (k, label, hint) => {
      const ta = el('textarea', {
        id: 'woop-' + k, rows: 2, maxlength: 200, placeholder: hint,
        onInput(e) { M.woop[k] = e.target.value; changed(); }
      });
      ta.value = M.woop[k] || '';
      return el('div', { class: 'field' }, el('label', { for: 'woop-' + k, text: label }), ta);
    };
    const woop = el('details', { class: 'card woop', open: avoid },
      el('summary', { text: 'WOOP: 바라는 것 → 최상의 결과 → 내 안의 장애물 → 계획' }),
      el('div', { class: 'stack' },
        woopField('wish', '소망(Wish)', '이번 달 꼭 이루고 싶은 것'),
        woopField('outcome', '최상의 결과(Outcome)', '이뤄지면 어떤 기분일까?'),
        woopField('obstacle', '내 안의 장애물(Obstacle)', '나를 막는 내 습관이나 마음'),
        woopField('plan', '계획(Plan)', '만약 ~하면 ~한다')
      )
    );
    if (avoid && !M.woopSuggested && SM.chat && typeof SM.chat.say === 'function') {
      SM.chat.say('이번 달 WOOP을 같이 적어 볼래? 플래너 월간 화면에 펼쳐 뒀어.');
      M.woopSuggested = true;
      instance.save(mk, data);
    }

    // --- 공개 여부 ---
    const pub = el('input', {
      type: 'checkbox', id: 'month-public', role: 'switch', checked: !!M.public,
      onChange(e) { M.public = e.target.checked; flush(); state.textContent = M.public ? '켜짐' : '꺼짐'; }
    });
    const state = el('strong', { text: M.public ? '켜짐' : '꺼짐' });

    root.append(
      el('h3', { class: 'month-title', text: `${y}년 ${+m}월` }),
      el('section', { class: 'card stack' }, el('h3', { text: '이달의 목표' }), goalsBox),
      el('section', { class: 'card stack' }, el('h3', { text: '달력' }), calBox, eventBox),
      el('section', { class: 'card stack' }, el('h3', { text: '주차별 초점' }), weekRows),
      focusSection,
      woop,
      el('div', { class: 'card row toggle-row' },
        el('label', { for: 'month-public', text: '이달 목표를 우리 반에 공개' }),
        pub, state
      )
    );

    return {
      node: root,
      cleanup() { if (dirty) flush(); else persist.cancel(); }
    };
  }

  SM.createPlanner = createPlanner;
  SM.planner = Object.assign(instance, {
    monthKeyForWeek, shiftMonth, calendarRows, ddayFrom, normalize, ddayEl, stripEl, query,
    EVENT_KINDS, EXAM_KINDS
  });

  if (typeof SM.route === 'function') {
    SM.route('#/planner/:view(month|week|day)', { title: '플래너', tab: 'planner', render: plannerScreen });
    SM.route('#/planner', {
      title: '플래너', tab: 'planner',
      render() { location.replace('#/planner/day'); return SM.ui.el('div'); }
    });
  }
})(window.SM = window.SM || {});
