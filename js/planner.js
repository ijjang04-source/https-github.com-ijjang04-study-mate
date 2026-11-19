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

    /** 이번 주(또는 지정 주)에 과목 전략 연결. 과목당 2개까지 → { added, full, exists } */
    function addWeeklyStrategy(subject, id, isoWeek) {
      const w = isoWeek || SM.date.isoWeek(SM.date.today());
      const week = normalizeWeek(getWeek(w));
      const r = addStrategyToWeek(week, subject, id);
      if (r.added) saveWeek(w, week);
      return r;
    }

    /** 10단계에서 쌓인 plan.plannerQueue를 이번 주로 옮긴다. 옮긴 개수를 돌려준다. */
    function drainQueue(planKey, isoWeek) {
      const plan = store.get(planKey, null);
      if (!plan || !Array.isArray(plan.plannerQueue) || !plan.plannerQueue.length) return 0;
      const w = isoWeek || SM.date.isoWeek(SM.date.today());
      const week = normalizeWeek(getWeek(w));
      let n = 0;
      plan.plannerQueue.forEach((q) => { if (addStrategyToWeek(week, q.subject, q.id).added) n++; });
      saveWeek(w, week);
      plan.plannerQueue = [];
      store.set(planKey, plan);
      return n;
    }

    return { load, save, getWeek, saveWeek, getDay, saveDay, nextDday, addWeeklyStrategy, drainQueue };
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
    } else if (view === 'week') {
      const r = weekView(ctx);
      body = r.node; viewCleanup = r.cleanup;
    } else {
      body = el('div', { class: 'card stack' },
        el('h3', { text: `일간 플래너 · ${SM.date.formatKorean(cur)}` }),
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

  // =====================================================================
  // 주간 플래너
  // weeks[isoWeek] = {
  //   goals: [{ subject, text }], extraSubjects: [과목],
  //   strategies: { 과목: [id, id] },           // 과목당 1~2개
  //   grid: { mon: ['수학:interleave', ...], ... },
  //   intentions: [{ text, from: 'lastWeek'|'seven'|null }],  // 1~3개
  //   obstacle: '', public: false, publicRate: false
  //   (16단계) review.nextChange: '다음 주에 바꿀 한 가지'
  // }
  // =====================================================================

  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const MAX_WEEK_STRATEGIES = 2;
  const MAX_INTENTIONS = 3;
  const GOAL_HINTS = {
    수학: '예) 이차함수 문제 40개',
    영어: '예) 단어 150개, 지문 10개',
    국어: '예) 비문학 지문 6개',
    과학: '예) 화학 2단원 개념 정리',
    사회: '예) 한국사 연표 1회 정리'
  };
  // 자동 나누기 간격(이틀 간격 3일). 원래 요일이 들어 있는 첫 패턴을 쓴다.
  const SPREAD_PATTERNS = [
    ['mon', 'wed', 'fri'], ['tue', 'thu', 'sat'], ['wed', 'fri', 'sun'], ['mon', 'thu', 'sun']
  ];

  function normalizeWeek(w) {
    const d = w && typeof w === 'object' ? w : {};
    const grid = {};
    DAY_KEYS.forEach((k) => { grid[k] = Array.isArray(d.grid && d.grid[k]) ? d.grid[k].slice() : []; });
    const strategies = {};
    Object.keys(d.strategies || {}).forEach((s) => {
      if (Array.isArray(d.strategies[s])) strategies[s] = d.strategies[s].slice(0, MAX_WEEK_STRATEGIES);
    });
    return Object.assign({}, d, {
      goals: Array.isArray(d.goals) ? d.goals.map((g) => ({ subject: g.subject, text: String(g.text || '') })) : [],
      extraSubjects: Array.isArray(d.extraSubjects) ? d.extraSubjects.slice() : [],
      strategies,
      grid,
      intentions: Array.isArray(d.intentions) ? d.intentions.map((x) => ({ text: String(x.text || ''), from: x.from || null })) : [],
      obstacle: String(d.obstacle || ''),
      public: !!d.public,
      publicRate: !!d.publicRate
    });
  }

  /** 과목에 전략 연결(과목당 2개까지). week를 바꾼다. */
  function addStrategyToWeek(week, subject, id) {
    const list = week.strategies[subject] = week.strategies[subject] || [];
    if (list.indexOf(id) !== -1) return { added: false, exists: true, full: false };
    if (list.length >= MAX_WEEK_STRATEGIES) return { added: false, exists: false, full: true };
    list.push(id);
    return { added: true, exists: false, full: false };
  }

  /** 'mon' 칸에서 그 과목의 전략 id 목록 */
  function cellEntries(grid, day, subject) {
    const pre = subject + ':';
    return ((grid && grid[day]) || []).filter((e) => e.indexOf(pre) === 0).map((e) => e.slice(pre.length));
  }

  /** 그 과목이 배치된 요일 목록 */
  function subjectDays(grid, subject) {
    return DAY_KEYS.filter((d) => cellEntries(grid, d, subject).length > 0);
  }

  /** 몰림: 목표 분량이 적혀 있는데 배치된 요일이 하루뿐인 과목 → [{ subject, day }] */
  function clumped(week) {
    const w = normalizeWeek(week);
    return w.goals
      .filter((g) => g.text.trim())
      .map((g) => ({ subject: g.subject, days: subjectDays(w.grid, g.subject) }))
      .filter((x) => x.days.length === 1)
      .map((x) => ({ subject: x.subject, day: x.days[0] }));
  }

  /** 자동 나누기 제안: 원래 요일을 포함하는 이틀 간격 3일 */
  function spreadSuggestion(day) {
    return (SPREAD_PATTERNS.find((p) => p.indexOf(day) !== -1) || SPREAD_PATTERNS[0]).slice();
  }

  /** 몰린 칸의 전략을 제안 요일들로 옮긴 새 grid(다른 과목은 그대로) */
  function applySpread(grid, subject) {
    const days = subjectDays(grid, subject);
    if (days.length !== 1) return grid;
    const ids = cellEntries(grid, days[0], subject);
    const target = spreadSuggestion(days[0]);
    const out = {};
    DAY_KEYS.forEach((d) => {
      const others = ((grid && grid[d]) || []).filter((e) => e.indexOf(subject + ':') !== 0);
      out[d] = target.indexOf(d) !== -1 ? others.concat(ids.map((id) => `${subject}:${id}`)) : others;
    });
    return out;
  }

  function nextChangeOf(week) {
    const v = week && week.review && week.review.nextChange;
    return v ? String(v).trim() : '';
  }

  function prevWeek(isoWeek) {
    return SM.date.isoWeek(SM.date.addDays(SM.date.weekDays(isoWeek)[0], -7));
  }

  /** 지난주 복사: 적용 전략·배치표·실행 의도(목표는 비움) */
  function copyFromLastWeek(current, last) {
    const c = normalizeWeek(current);
    const l = normalizeWeek(last);
    return Object.assign(c, {
      goals: c.goals.map((g) => ({ subject: g.subject, text: '' })),
      extraSubjects: Array.from(new Set(c.extraSubjects.concat(l.extraSubjects))),
      strategies: JSON.parse(JSON.stringify(l.strategies)),
      grid: JSON.parse(JSON.stringify(l.grid)),
      intentions: l.intentions.filter((x) => x.from !== 'lastWeek').map((x) => ({ text: x.text, from: x.from }))
    });
  }

  /** 요일별 일간 블록 요약 → [{ day, date, planned, done }] */
  function blockSummary(isoWeek, getDay) {
    return SM.date.weekDays(isoWeek).map((iso, i) => {
      const blocks = getDay(iso) || [];
      return { day: DAY_KEYS[i], date: iso, planned: blocks.length, done: blocks.filter((b) => b && (b.done === true || b.status === 'done')).length };
    });
  }

  /** "나는 저녁 9시가 되면 영단어를 외운다." → "만약 저녁 9시가 되면 영단어를 외운다" */
  function ruleToIntention(text) {
    const t = String(text || '').trim().replace(/^나는\s+/, '').replace(/[.。]+$/, '').trim();
    return t ? '만약 ' + t : '';
  }

  /** 과목의 전략 선택지: 이달 집중 전략 → 없으면 plan 추천(그 과목 → 전체) */
  function strategyChoices(monthFocus, plan, subject) {
    if (monthFocus && monthFocus.length) return monthFocus.slice();
    const s = plan && plan.strategies;
    if (!s) return [];
    if (s[subject] && s[subject].length) return s[subject].slice();
    const all = [];
    Object.keys(s).forEach((k) => (s[k] || []).forEach((id) => { if (all.indexOf(id) === -1) all.push(id); }));
    return all;
  }

  /** 받침에 따라 '을/를' */
  function objectJosa(word) {
    const w = String(word || '');
    const code = w.charCodeAt(w.length - 1) - 0xac00;
    if (code < 0 || code > 11171) return w + '을(를)';
    return w + (code % 28 ? '을' : '를');
  }

  /** 칸에 쓸 전략 약칭(4자 이내, 서로 다름) */
  const ABBR = {
    chunking: '묶기', acronym: '두문자', loci: '장소법', keyword: '핵심단어', automation: '자동화',
    elaboration: '정교화', elabQuestion: '왜질문', selfExplain: '자기설명', examples: '예시', workedExample: '예제',
    refutation: '반박', teach: '설명', organize: '조직화', conceptMap: '개념도', dualCoding: '그림+글',
    imagery: '심상', retrieval: '인출', spacing: '분산', interleave: '교차', pretest: '사전시험',
    errorLog: '오답', metacog: '메타인지', planDoc: '계획서', ifThen: '실행의도', woop: 'WOOP',
    timeEnv: '환경', effort: '노력', helpSeek: '질문', havruta: '하브루타', coop: '협동',
    expressiveWriting: '글쓰기', reciprocal: '상보독해'
  };
  function abbr(id) {
    if (ABBR[id]) return ABBR[id];
    const name = strategyName(id).replace(/s/g, '');
    return name.slice(0, 4);
  }

  // ---------- 칸 선택 시트 ----------

  function openSheet(title, options, selected) {
    const el = SM.ui.el;
    return new Promise((resolve) => {
      const chosen = selected.slice();
      const prevFocus = document.activeElement;
      const chips = options.map((o) => el('button', {
        type: 'button', class: 'chip' + (chosen.indexOf(o.id) !== -1 ? ' chip-on' : ''),
        'aria-pressed': String(chosen.indexOf(o.id) !== -1), text: o.label,
        onClick(e) {
          const at = chosen.indexOf(o.id);
          if (at === -1) chosen.push(o.id); else chosen.splice(at, 1);
          e.currentTarget.classList.toggle('chip-on', at === -1);
          e.currentTarget.setAttribute('aria-pressed', String(at === -1));
        }
      }));
      const backdrop = el('div', { class: 'modal-backdrop' });
      const box = el('div', { class: 'modal sheet stack', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('h3', { text: title }),
        options.length
          ? el('div', { class: 'chip-row', role: 'group', 'aria-label': '전략' }, chips)
          : el('p', { class: 'muted', text: '먼저 위에서 이 과목의 이번 주 전략을 골라 줘.' }),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn', text: '비우기', onClick: () => close([]) }),
          el('button', { type: 'button', class: 'btn btn-primary', text: '완료', onClick: () => close(chosen) })
        )
      );
      backdrop.appendChild(box);
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Tab') {
          const f = box.querySelectorAll('button');
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      function close(v) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(v);
      }
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      (box.querySelector('.chip') || box.querySelector('.btn-primary')).focus();
    });
  }

  // ---------- 화면: 주간 ----------

  function weekView(ctx) {
    const { cur: wk, today, plan, saved, el } = ctx;
    const profile = SM.auth.current();
    const planKey = SM.keys.plan(profile.sid);
    const moved = instance.drainQueue(planKey, SM.date.isoWeek(today));
    if (moved) setTimeout(() => SM.ui.toast(`전략 화면에서 넣은 전략 ${moved}개를 이번 주에 연결했어.`), 0);

    let week = normalizeWeek(instance.getWeek(wk));
    const days = SM.date.weekDays(wk);
    const short = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}`;
    const monthFocus = instance.load(monthKeyForWeek(wk)).month.focusStrategies;
    const result = latestResult();

    // 지난주 '다음 주에 바꿀 한 가지'를 실행 의도 맨 위에(16단계에서 채워짐)
    const carry = nextChangeOf(instance.getWeek(prevWeek(wk)));
    if (carry && !week.intentions.some((x) => x.from === 'lastWeek')) {
      week.intentions.unshift({ text: carry, from: 'lastWeek' });
      week.intentions = week.intentions.slice(0, MAX_INTENTIONS);
    }

    let dirty = false;
    const persist = SM.ui.debounce(() => { instance.saveWeek(wk, week); dirty = false; saved.set('saved'); }, 500);
    function changed() { dirty = true; saved.set('saving'); persist(); }
    function flush() { persist.cancel(); instance.saveWeek(wk, week); dirty = false; saved.set('saved'); }

    function subjects() {
      const base = (result && result.subjects) || [];
      const list = base.slice();
      week.extraSubjects.forEach((s) => { if (list.indexOf(s) === -1) list.push(s); });
      return list;
    }
    function syncGoals() {
      subjects().forEach((s) => { if (!week.goals.some((g) => g.subject === s)) week.goals.push({ subject: s, text: '' }); });
    }
    syncGoals();

    const root = el('div', { class: 'stack' });
    const goalsSec = el('section', { class: 'card stack' });
    const stratSec = el('section', { class: 'card stack' });
    const gridSec = el('section', { class: 'card stack' });
    const spreadBox = el('div', { class: 'stack', 'aria-live': 'polite' });
    const intentSec = el('section', { class: 'card stack' });

    function renderAll() {
      renderGoals(); renderStrategies(); renderGrid(); renderSpread(); renderIntentions();
    }

    // --- 이번 주 목표 ---
    function renderGoals() {
      SM.ui.clear(goalsSec);
      goalsSec.appendChild(el('h3', { text: '이번 주 목표' }));
      const base = (result && result.subjects) || [];
      subjects().forEach((s) => {
        const g = week.goals.find((x) => x.subject === s);
        const id = 'wgoal-' + s;
        const input = el('input', {
          type: 'text', id, maxlength: 60, placeholder: GOAL_HINTS[s] || '예) 문제 20개',
          onInput(e) { g.text = e.target.value; changed(); renderSpread(); }
        });
        input.value = g.text;
        goalsSec.appendChild(el('div', { class: 'field' },
          el('label', { for: id, text: s }),
          el('div', { class: 'row' }, input,
            base.indexOf(s) === -1
              ? el('button', {
                type: 'button', class: 'btn btn-ghost', text: '빼기', 'aria-label': `${s} 빼기`,
                onClick() {
                  week.extraSubjects = week.extraSubjects.filter((x) => x !== s);
                  week.goals = week.goals.filter((x) => x.subject !== s);
                  flush(); renderAll();
                }
              })
              : null)
        ));
      });
      const rest = SM.config.subjects.filter((s) => subjects().indexOf(s) === -1);
      if (rest.length) {
        goalsSec.appendChild(el('details', null,
          el('summary', { text: '+ 과목 추가' }),
          el('div', { class: 'chip-row', role: 'group', 'aria-label': '추가할 과목' }, rest.map((s) => el('button', {
            type: 'button', class: 'chip', text: s,
            onClick() { week.extraSubjects.push(s); syncGoals(); flush(); renderAll(); const i = document.getElementById('wgoal-' + s); if (i) i.focus(); }
          })))
        ));
      }
    }

    // --- 이번 주 적용 전략 ---
    function renderStrategies() {
      SM.ui.clear(stratSec);
      stratSec.append(
        el('h3', { text: '이번 주 적용 전략' }),
        el('p', { class: 'muted', text: monthFocus.length ? '이달 집중 전략에서 과목마다 1~2개를 골라.' : '추천 전략에서 과목마다 1~2개를 골라.' })
      );
      subjects().forEach((s) => {
        const picked = week.strategies[s] || [];
        const choices = strategyChoices(monthFocus, plan, s);
        picked.forEach((id) => { if (choices.indexOf(id) === -1) choices.push(id); });
        const chip = (id) => {
          const on = picked.indexOf(id) !== -1;
          return el('button', {
            type: 'button', class: 'chip' + (on ? ' chip-on' : ''), 'aria-pressed': String(on), text: strategyName(id),
            onClick() {
              if (on) {
                week.strategies[s] = picked.filter((x) => x !== id);
                // 배치표에서도 뺀다
                DAY_KEYS.forEach((d) => { week.grid[d] = week.grid[d].filter((e) => e !== `${s}:${id}`); });
              } else if (!addStrategyToWeek(week, s, id).added) {
                SM.ui.toast('과목마다 2개까지 연결할 수 있어.'); return;
              }
              flush(); renderStrategies(); renderGrid(); renderSpread();
            }
          });
        };
        stratSec.appendChild(el('div', { class: 'stack week-subject' },
          el('h4', { text: `${s} (${picked.length}/2)` }),
          choices.length ? el('div', { class: 'chip-row', role: 'group', 'aria-label': `${s} 전략` }, choices.map(chip)) : null,
          el('details', null,
            el('summary', { text: '기타: 전체 32개에서 고르기' }),
            el('div', { class: 'chip-row', role: 'group', 'aria-label': `${s} 전체 전략` },
              SM.data.strategies.filter((x) => choices.indexOf(x.id) === -1).map((x) => chip(x.id)))
          )
        ));
      });
    }

    // --- 요일별 배치표 ---
    const mq = window.matchMedia ? window.matchMedia('(max-width: 599px)') : null;
    let mobileDay = DAY_KEYS[Math.max(0, days.indexOf(today))] || 'mon';

    async function editCell(day, subject) {
      const options = (week.strategies[subject] || []).map((id) => ({ id, label: strategyName(id) }));
      const dayIdx = DAY_KEYS.indexOf(day);
      const res = await openSheet(`${SM.date.WEEKDAY_KO[dayIdx]}요일 · ${subject}`, options, cellEntries(week.grid, day, subject));
      if (res === null) return;
      week.grid[day] = week.grid[day].filter((e) => e.indexOf(subject + ':') !== 0).concat(res.map((id) => `${subject}:${id}`));
      flush(); renderGrid(); renderSpread();
    }

    function cellButton(day, subject) {
      const ids = cellEntries(week.grid, day, subject);
      const dayName = SM.date.WEEKDAY_KO[DAY_KEYS.indexOf(day)];
      return el('button', {
        type: 'button', class: 'grid-cell' + (ids.length ? ' grid-on' : ''),
        'aria-label': `${dayName}요일 ${subject}: ${ids.length ? ids.map(strategyName).join(', ') : '비어 있음'}`,
        onClick: () => editCell(day, subject)
      }, ids.length ? ids.map((id) => el('span', { class: 'grid-tag', text: abbr(id) })) : el('span', { class: 'muted', text: '+', 'aria-hidden': 'true' }));
    }

    function renderGrid() {
      SM.ui.clear(gridSec);
      gridSec.append(
        el('h3', { text: '요일별 배치표' }),
        el('p', { class: 'muted', text: '칸을 눌러 그날 쓸 전략을 골라.' })
      );
      const subs = subjects();
      if (!subs.length) { gridSec.appendChild(el('p', { class: 'muted', text: '위에서 과목을 먼저 추가해 줘.' })); return; }
      if (mq && mq.matches) {
        const tabs = el('div', { class: 'tabs day-tabs', role: 'tablist', 'aria-label': '요일' },
          DAY_KEYS.map((d, i) => el('button', {
            type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(d === mobileDay),
            'aria-label': `${SM.date.WEEKDAY_KO[i]}요일 ${short(days[i])}`,
            text: SM.date.WEEKDAY_KO[i],
            onClick() { mobileDay = d; renderGrid(); gridSec.querySelector('[aria-selected="true"]').focus(); }
          })));
        const i = DAY_KEYS.indexOf(mobileDay);
        gridSec.append(tabs,
          el('p', { class: 'muted', text: `${SM.date.formatKorean(days[i])}` }),
          el('ul', { class: 'day-list', role: 'tabpanel' }, subs.map((s) => el('li', { class: 'row' },
            el('span', { class: 'day-subject', text: s }), cellButton(mobileDay, s)))));
      } else {
        const head = [el('div', { class: 'grid-head', 'aria-hidden': 'true' })].concat(DAY_KEYS.map((d, i) =>
          el('div', { class: 'grid-head' + (days[i] === today ? ' grid-today' : ''), 'aria-hidden': 'true' },
            el('span', { text: SM.date.WEEKDAY_KO[i] }), el('span', { class: 'muted', text: short(days[i]) }))));
        const rows = [];
        subs.forEach((s) => {
          rows.push(el('div', { class: 'grid-subject', text: s }));
          DAY_KEYS.forEach((d) => rows.push(cellButton(d, s)));
        });
        gridSec.appendChild(el('div', { class: 'week-grid' }, head, rows));
      }
      gridSec.appendChild(spreadBox);
    }

    function renderSpread() {
      SM.ui.clear(spreadBox);
      clumped(week).forEach((c) => {
        const names = spreadSuggestion(c.day).map((d) => SM.date.WEEKDAY_KO[DAY_KEYS.indexOf(d)]).join('·');
        spreadBox.appendChild(el('div', { class: 'notice card stack' },
          el('p', { text: `💡 ${objectJosa(c.subject)} 하루에 몰아서 하네. 며칠에 나눠 보면 어때?` }),
          el('button', {
            type: 'button', class: 'btn', text: `자동으로 나누기 (${names})`,
            onClick() { week.grid = applySpread(week.grid, c.subject); flush(); renderGrid(); renderSpread(); SM.ui.toast(`${names}로 나눴어.`); }
          })
        ));
      });
    }

    // --- 실행 의도 ---
    function renderIntentions() {
      SM.ui.clear(intentSec);
      if (!week.intentions.length) week.intentions.push({ text: '', from: null });
      intentSec.append(
        el('h3', { text: '실행 의도' }),
        el('p', { class: 'muted', text: '"만약 [상황]이면 [행동]" 형식으로 1~3개.' })
      );
      week.intentions.forEach((it, i) => {
        const id = 'intent-' + i;
        const ta = el('input', {
          type: 'text', id, maxlength: 100, placeholder: '예) 만약 학원에서 늦게 오면 단어 20개만 떠올린다',
          'aria-label': `실행 의도 ${i + 1}`,
          onInput(e) { it.text = e.target.value; changed(); }
        });
        ta.value = it.text;
        intentSec.appendChild(el('div', { class: 'stack' },
          it.from === 'lastWeek' ? el('span', { class: 'tag', text: '지난주에 바꾸기로 한 것' }) : null,
          el('div', { class: 'row' }, ta,
            el('button', {
              type: 'button', class: 'btn btn-ghost', text: '삭제', 'aria-label': `실행 의도 ${i + 1} 삭제`,
              onClick() { week.intentions.splice(i, 1); flush(); renderIntentions(); }
            }))
        ));
      });
      const full = week.intentions.length >= MAX_INTENTIONS;
      const rules = ((plan && plan.sevenRules) || []).filter((r) => r && String(r.text || '').trim());
      intentSec.appendChild(el('button', {
        type: 'button', class: 'btn', text: '+ 실행 의도 추가', disabled: full,
        onClick() { week.intentions.push({ text: '', from: null }); flush(); renderIntentions(); const inputs = intentSec.querySelectorAll('input'); inputs[inputs.length - 1].focus(); }
      }));
      intentSec.appendChild(el('details', null,
        el('summary', { text: '나만의 일곱 가지 전략에서 불러오기' }),
        rules.length
          ? el('ul', { class: 'pick-list' }, rules.map((r) => el('li', null, el('button', {
            type: 'button', class: 'btn btn-ghost pick', text: ruleToIntention(r.text),
            onClick() {
              const text = ruleToIntention(r.text);
              const empty = week.intentions.find((x) => !x.text.trim() && x.from !== 'lastWeek');
              if (empty) { empty.text = text; empty.from = 'seven'; }
              else if (week.intentions.length >= MAX_INTENTIONS) { SM.ui.toast('실행 의도는 3개까지야.'); return; }
              else week.intentions.push({ text, from: 'seven' });
              flush(); renderIntentions();
            }
          }))))
          : el('p', null, '아직 없어. ', el('a', { href: '#/strategy/seven', text: '만들러 가기' }))
      ));
    }

    // --- 예상 장애물 ---
    const obstacle = el('textarea', {
      id: 'week-obstacle', rows: 2, maxlength: 200, placeholder: '예) 학원 보강 있는 목요일',
      onInput(e) { week.obstacle = e.target.value; changed(); }
    });
    obstacle.value = week.obstacle;

    // --- 공개 ---
    const rateBox = el('input', {
      type: 'checkbox', id: 'week-public-rate', checked: week.publicRate, disabled: !week.public,
      onChange(e) { week.publicRate = e.target.checked; flush(); }
    });
    const pubState = el('strong', { text: week.public ? '켜짐' : '꺼짐' });
    const pub = el('input', {
      type: 'checkbox', id: 'week-public', role: 'switch', checked: week.public,
      onChange(e) {
        week.public = e.target.checked;
        if (!week.public) { week.publicRate = false; rateBox.checked = false; }
        rateBox.disabled = !week.public;
        pubState.textContent = week.public ? '켜짐' : '꺼짐';
        flush();
      }
    });

    // --- 지난주 복사 ---
    async function copyLast() {
      const last = instance.getWeek(prevWeek(wk));
      const l = normalizeWeek(last);
      const hasLast = Object.keys(l.strategies).some((s) => l.strategies[s].length) ||
        DAY_KEYS.some((d) => l.grid[d].length) || l.intentions.some((x) => x.text.trim());
      if (!hasLast) { SM.ui.toast('지난주에 적은 내용이 없어.'); return; }
      const hasNow = Object.keys(week.strategies).some((s) => week.strategies[s].length) ||
        DAY_KEYS.some((d) => week.grid[d].length) || week.intentions.some((x) => x.text.trim() && x.from !== 'lastWeek');
      if (hasNow) {
        const ok = await SM.ui.confirmDialog('이번 주에 적은 전략·배치표·실행 의도를 지난주 것으로 바꿀까?', { okText: '바꾸기', cancelText: '그대로 두기' });
        if (!ok) return;
      }
      const keepCarry = week.intentions.filter((x) => x.from === 'lastWeek');
      week = copyFromLastWeek(week, last);
      week.intentions = keepCarry.concat(week.intentions).slice(0, MAX_INTENTIONS);
      syncGoals();
      flush(); renderAll();
      SM.ui.toast('지난주 계획을 가져왔어. 목표는 새로 적어 줘.');
    }

    // --- 일간 블록 요약 ---
    const summary = blockSummary(wk, instance.getDay);
    const summarySec = el('section', { class: 'card stack' },
      el('h3', { text: '이번 주 일간 블록' }),
      el('ul', { class: 'block-summary' }, summary.map((s, i) => el('li', null,
        el('a', { href: `#/planner/day?d=${s.date}`, class: 'block-day' + (s.date === today ? ' grid-today' : '') },
          el('span', { text: `${SM.date.WEEKDAY_KO[i]} ${short(s.date)}` }),
          el('span', { class: 'muted', text: s.planned ? `${s.done}/${s.planned} 완료` : '계획 없음' }))
      ))),
      el('p', { class: 'muted', text: '일간 플래너에서 블록을 만들면 여기에 쌓여.' })
    );

    function onMedia() { renderGrid(); }
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMedia); else if (mq.addListener) mq.addListener(onMedia); }

    root.append(
      el('div', { class: 'row' },
        el('h3', { class: 'month-title grow', text: `${wk} (${short(days[0])}~${short(days[6])})` }),
        el('button', { type: 'button', class: 'btn', text: '지난주 복사', onClick: copyLast })
      ),
      goalsSec, stratSec, gridSec, intentSec,
      el('section', { class: 'card stack' },
        el('label', { for: 'week-obstacle' }, el('h3', { text: '예상 장애물' })),
        obstacle
      ),
      el('div', { class: 'card stack' },
        el('div', { class: 'row toggle-row' }, el('label', { for: 'week-public', text: '이번 주 계획을 우리 반에 공개' }), pub, pubState),
        el('div', { class: 'row toggle-row' }, el('label', { for: 'week-public-rate', text: '실천률도 공개' }), rateBox)
      ),
      summarySec
    );
    renderAll();

    return {
      node: root,
      cleanup() {
        if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onMedia); else if (mq.removeListener) mq.removeListener(onMedia); }
        if (dirty) flush(); else persist.cancel();
      }
    };
  }

  SM.createPlanner = createPlanner;
  SM.planner = Object.assign(instance, {
    monthKeyForWeek, shiftMonth, calendarRows, ddayFrom, normalize, ddayEl, stripEl, query,
    EVENT_KINDS, EXAM_KINDS,
    DAY_KEYS, normalizeWeek, addStrategyToWeek, cellEntries, subjectDays, clumped, spreadSuggestion, applySpread,
    copyFromLastWeek, blockSummary, ruleToIntention, strategyChoices, abbr, objectJosa, nextChangeOf, prevWeek
  });

  if (typeof SM.route === 'function') {
    SM.route('#/planner/:view(month|week|day)', { title: '플래너', tab: 'planner', render: plannerScreen });
    SM.route('#/planner', {
      title: '플래너', tab: 'planner',
      render() { location.replace('#/planner/day'); return SM.ui.el('div'); }
    });
  }
})(window.SM = window.SM || {});
