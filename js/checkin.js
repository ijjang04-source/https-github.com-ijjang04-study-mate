// ---------- SM.metrics: 플래너 지표(순수 계산, DOM 없음) ----------
// 모든 비율은 0~1 숫자. 화면에서 %로 바꾼다. 계산할 수 없으면 null(0이 아님).
(function (SM) {
  'use strict';

  const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  const APPLIED_SCORE = { yes: 1, partial: 0.5, no: 0 };
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const BLOCKER_ORDER = ['phone', 'sleepy', 'noise', 'hard', 'other'];

  /** 'HH:MM'~'HH:MM' 분(자정을 넘기면 다음 날). 비었거나 잘못되면 0 */
  function minutes(start, end) {
    if (!TIME.test(String(start || '')) || !TIME.test(String(end || ''))) return 0;
    return SM.date.minutesBetween(start, end);
  }

  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const isRecorded = (b) => !!(b && b.done);

  /** 블록 하나의 달성 비율(0~1, 1을 넘을 수 있음). 없으면 null */
  function blockAmount(block) {
    const t = block && block.target ? num(block.target.n) : null;
    const n = block && block.done ? num(block.done.n) : null;
    if (!(t > 0) || n === null) return null;
    return n / t;
  }

  /** 블록 달성률(%) — 화면 표시용 정수 */
  function achievement(block) {
    const r = blockAmount(block);
    return r === null ? null : Math.round(r * 100);
  }

  /** 분량 비율: 단위가 모두 같으면 Σn/Σtarget, 섞이면 블록별 비율 평균 */
  function amountRate(recordedBlocks) {
    const ok = recordedBlocks.filter((b) => blockAmount(b) !== null);
    if (!ok.length) return null;
    const units = new Set(ok.map((b) => b.target.unit || ''));
    if (units.size === 1) {
      const sn = ok.reduce((s, b) => s + num(b.done.n), 0);
      const st = ok.reduce((s, b) => s + num(b.target.n), 0);
      return sn / st;
    }
    return mean(ok.map(blockAmount));
  }

  /** 전략 적용률: 전략이 있는 기록 블록 중 (예×1 + 부분×0.5) / 개수 */
  function strategyRateOf(recordedBlocks) {
    const list = recordedBlocks.filter((b) => b.strategy && APPLIED_SCORE[b.done.applied] !== undefined);
    if (!list.length) return null;
    return list.reduce((s, b) => s + APPLIED_SCORE[b.done.applied], 0) / list.length;
  }

  /**
   * 하루(또는 블록 묶음) 지표
   * → { planned, recorded, executionRate, amountRate, strategyRate, plannedMin, actualMin, avgFocus }
   */
  function day(blocks) {
    const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
    const rec = list.filter(isRecorded);
    const focus = rec.map((b) => num(b.done.focus)).filter((f) => f !== null && f >= 1 && f <= 5);
    return {
      planned: list.length,
      recorded: rec.length,
      executionRate: list.length ? rec.length / list.length : null,
      amountRate: amountRate(rec),
      strategyRate: strategyRateOf(rec),
      plannedMin: list.reduce((s, b) => s + minutes(b.start, b.end), 0),
      actualMin: rec.reduce((s, b) => s + minutes(b.done.start, b.done.end), 0),
      avgFocus: focus.length ? mean(focus) : null
    };
  }

  function defaultGetDay(iso) {
    return SM.planner && typeof SM.planner.getDay === 'function' ? SM.planner.getDay(iso) : [];
  }

  /**
   * 한 주 지표. getDay(iso) → blocks 를 넣으면 저장소 없이 계산할 수 있다.
   * → { isoWeek, days: [{ date, day, ...day() }], total: day(주 전체),
   *     byStrategy: { id: rate }, blockersTop: [{ id, count }] (상위 3),
   *     focusByPlace: { place: 평균 }, minutesBySubject: { 과목: 분 }, clumpBySubject: { 과목: 0~1 } }
   */
  function week(isoWeek, getDay) {
    const get = getDay || defaultGetDay;
    const dates = SM.date.weekDays(isoWeek);
    const perDay = dates.map((iso) => (get(iso) || []).filter(Boolean));
    const all = [].concat(...perDay);
    const rec = all.filter(isRecorded);

    const byStrategy = {};
    const sGroups = {};
    rec.forEach((b) => { if (b.strategy) (sGroups[b.strategy] = sGroups[b.strategy] || []).push(b); });
    Object.keys(sGroups).forEach((id) => {
      const r = strategyRateOf(sGroups[id]);
      if (r !== null) byStrategy[id] = r;
    });

    const counts = {};
    rec.forEach((b) => (b.done.blockers || []).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
    const order = (k) => { const i = BLOCKER_ORDER.indexOf(k); return i === -1 ? 99 : i; };
    const blockersTop = Object.keys(counts)
      .map((id) => ({ id, count: counts[id] }))
      .sort((a, b) => b.count - a.count || order(a.id) - order(b.id))
      .slice(0, 3);

    const placeFocus = {};
    rec.forEach((b) => {
      const place = b.done.place || b.place;
      const f = num(b.done.focus);
      if (!place || f === null) return;
      (placeFocus[place] = placeFocus[place] || []).push(f);
    });
    const focusByPlace = {};
    Object.keys(placeFocus).forEach((p) => { focusByPlace[p] = mean(placeFocus[p]); });

    // 과목별 실제 공부 시간과 하루 몰림 비율(가장 많은 날 / 주 합)
    const minutesBySubject = {};
    const perDaySubject = perDay.map((blocks) => {
      const m = {};
      blocks.filter(isRecorded).forEach((b) => {
        if (!b.subject) return;
        const t = minutes(b.done.start, b.done.end);
        m[b.subject] = (m[b.subject] || 0) + t;
      });
      return m;
    });
    perDaySubject.forEach((m) => Object.keys(m).forEach((s) => { minutesBySubject[s] = (minutesBySubject[s] || 0) + m[s]; }));
    const clumpBySubject = {};
    Object.keys(minutesBySubject).forEach((s) => {
      const total = minutesBySubject[s];
      if (total > 0) clumpBySubject[s] = Math.max(...perDaySubject.map((m) => m[s] || 0)) / total;
    });

    return {
      isoWeek,
      days: dates.map((iso, i) => Object.assign({ date: iso, day: DAY_KEYS[i] }, day(perDay[i]))),
      total: day(all),
      byStrategy, blockersTop, focusByPlace, minutesBySubject, clumpBySubject
    };
  }

  /** 그 달에 걸친 주차 목록(월요일 시작) */
  function weeksOfMonth(monthKey) {
    const out = [];
    SM.date.monthDays(monthKey).forEach((iso) => {
      const w = SM.date.isoWeek(iso);
      if (out.indexOf(w) === -1) out.push(w);
    });
    return out;
  }

  /** 한 달: 주차별 week() 요약 배열 */
  function month(monthKey, getDay) {
    return weeksOfMonth(monthKey).map((w) => week(w, getDay));
  }

  /** 0~1 → '73%', null → 대체 문구 */
  function pct(x, none) {
    return x === null || x === undefined ? (none === undefined ? '기록 없음' : none) : Math.round(x * 100) + '%';
  }

  /** 달력 칸 단계: 'none'(기록 없음) | 'zero' | 'low' | 'mid' | 'high' | 'nostrategy'(기록은 있는데 전략 없음) */
  function level(m) {
    if (!m || !m.recorded) return 'none';
    if (m.strategyRate === null) return 'nostrategy';
    const p = Math.round(m.strategyRate * 100);
    if (p >= 70) return 'high';
    if (p >= 40) return 'mid';
    if (p >= 1) return 'low';
    return 'zero';
  }

  SM.metrics = {
    minutes, achievement, blockAmount, amountRate, day, week, month, weeksOfMonth, pct, level,
    APPLIED_SCORE
  };
})(window.SM = window.SM || {});

// ---------- #/check 자기 점검 ----------
(function (SM) {
  'use strict';

  const TABS = [['day', '일간'], ['week', '주간 점검표'], ['month', '월간 리포트']];
  const APPLIED_TEXT = { yes: '전략 적용', partial: '전략 부분 적용', no: '전략 미적용' };

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

  function validMonth(s) { try { SM.date.monthDays(s); return true; } catch (e) { return false; } }
  function validIso(s) { try { SM.date.weekday(s); return true; } catch (e) { return false; } }

  function strategyName(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : id;
  }

  function minutesText(m) {
    if (!m) return '0분';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}시간${r ? ' ' + r + '분' : ''}` : `${r}분`;
  }

  function checkScreen(params) {
    const el = SM.ui.el;
    const tab = params.tab || 'day';

    const tabs = el('nav', { class: 'tabs', 'aria-label': '점검 보기' },
      TABS.map(([v, label]) => el('a', { href: `#/check/${v}`, class: 'tab', text: label, 'aria-current': v === tab ? 'page' : null })));

    let body;
    if (tab === 'day') body = dayTab();
    else {
      body = el('div', { class: 'card stack' },
        el('h3', { text: tab === 'week' ? '주간 점검표' : '월간 리포트' }),
        el('p', { class: 'muted', text: '곧 열려. 지금은 일간 탭에서 날마다 기록을 볼 수 있어.' }),
        el('a', { href: '#/check/day', class: 'btn', text: '일간 보기' }));
    }
    return el('section', { class: 'check stack' }, el('h2', { class: 'visually-hidden', text: '자기 점검' }), tabs, body);
  }

  // ---------- 일간 탭 ----------

  function dayTab() {
    const el = SM.ui.el;
    const q = query();
    const today = SM.date.today();
    const mk = validMonth(q.m) ? q.m : (validIso(q.d) ? SM.date.monthKey(q.d) : SM.date.monthKey(today));
    let selected = validIso(q.d) && SM.date.monthKey(q.d) === mk ? q.d : (SM.date.monthKey(today) === mk ? today : null);

    const metricsOf = {};
    SM.date.monthDays(mk).forEach((iso) => { metricsOf[iso] = SM.metrics.day(SM.planner.getDay(iso)); });

    function go(m, d) {
      location.hash = `#/check/day?m=${m}${d ? '&d=' + d : ''}`;
    }

    const [y, mo] = mk.split('-');
    const nav = el('div', { class: 'planner-nav' },
      el('button', { type: 'button', class: 'btn', 'aria-label': '이전 달', text: '◀', onClick: () => go(SM.planner.shiftMonth(mk, -1)) }),
      el('strong', { class: 'grow center', text: `${y}년 ${+mo}월` }),
      el('button', { type: 'button', class: 'btn', text: '오늘', onClick: () => go(SM.date.monthKey(today), today) }),
      el('button', { type: 'button', class: 'btn', 'aria-label': '다음 달', text: '▶', onClick: () => go(SM.planner.shiftMonth(mk, 1)) })
    );

    const calBox = el('div');
    const detail = el('div', { 'aria-live': 'polite' });
    const chartBox = el('div');

    function cellText(m) {
      const lv = SM.metrics.level(m);
      if (lv === 'none') return '·';
      if (lv === 'nostrategy') return '기록';
      return SM.metrics.pct(m.strategyRate);
    }

    function renderCalendar() {
      SM.ui.clear(calBox);
      const head = SM.date.WEEKDAY_KO.map((w) => el('div', { class: 'cal-head', text: w, 'aria-hidden': 'true' }));
      const cells = [];
      SM.planner.calendarRows(mk).forEach((row) => row.forEach((iso) => {
        if (!iso) { cells.push(el('div', { class: 'cal-cell cal-empty', 'aria-hidden': 'true' })); return; }
        const m = metricsOf[iso];
        const lv = SM.metrics.level(m);
        const label = `${SM.date.formatKorean(iso)}${iso === today ? ', 오늘' : ''}, ` +
          (lv === 'none' ? '기록 없음' : lv === 'nostrategy' ? `기록 ${m.recorded}개, 전략 없음` : `전략 적용률 ${SM.metrics.pct(m.strategyRate)}`);
        cells.push(el('button', {
          type: 'button',
          class: `cal-cell rate-${lv}` + (iso === today ? ' cal-today' : '') + (iso === selected ? ' cal-selected' : ''),
          'aria-label': label, 'aria-pressed': String(iso === selected),
          onClick() {
            selected = iso;
            history.replaceState(null, '', `#/check/day?m=${mk}&d=${iso}`);
            renderCalendar(); renderDetail(); renderChart();
            const b = calBox.querySelector('[aria-pressed="true"]'); if (b) b.focus();
          }
        },
          el('span', { class: 'cal-num', text: String(+iso.slice(8)) }),
          el('span', { class: 'cal-rate', text: cellText(m) })
        ));
      }));
      calBox.append(
        el('div', { class: 'cal-grid' }, head, cells),
        el('ul', { class: 'rate-legend', 'aria-label': '범례' },
          el('li', null, el('span', { class: 'swatch rate-high' }), '70% 이상'),
          el('li', null, el('span', { class: 'swatch rate-mid' }), '40~69%'),
          el('li', null, el('span', { class: 'swatch rate-low' }), '1~39%'),
          el('li', null, el('span', { class: 'swatch rate-zero' }), '0%'),
          el('li', null, el('span', { class: 'swatch rate-none' }), '· 기록 없음'))
      );
    }

    function renderDetail() {
      SM.ui.clear(detail);
      if (!selected) { detail.appendChild(el('p', { class: 'muted', text: '날짜를 누르면 그날 요약을 볼 수 있어.' })); return; }
      const blocks = SM.planner.getDay(selected);
      const m = SM.metrics.day(blocks);
      const P = SM.metrics.pct;
      const rows = [
        ['계획 시간', minutesText(m.plannedMin)],
        ['실제 시간', m.recorded ? minutesText(m.actualMin) : '기록 없음'],
        ['이행률', m.planned ? `${P(m.executionRate)} (${m.recorded}/${m.planned}블록)` : '기록 없음'],
        ['달성률', P(m.amountRate)],
        ['전략 적용률', P(m.strategyRate)],
        ['평균 집중도', m.avgFocus === null ? '기록 없음' : `${m.avgFocus.toFixed(1)} / 5`]
      ];
      detail.appendChild(el('section', { class: 'card stack' },
        el('h3', { text: `${SM.date.formatKorean(selected)} 요약` }),
        el('dl', { class: 'stat-list' }, rows.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        blocks.length
          ? el('ul', { class: 'block-lines' }, blocks.map((b, i) => {
            const parts = [`${i + 1}. ${b.subject || '과목 미정'}`];
            if (b.strategy) parts.push(strategyName(b.strategy));
            if (b.done) {
              const a = SM.metrics.achievement(b);
              parts.push('완료' + (a !== null ? ` ${a}%` : ''));
              if (b.strategy && b.done.applied) parts.push(APPLIED_TEXT[b.done.applied]);
            } else parts.push('기록 전');
            return el('li', { text: parts.join(' · ') });
          }))
          : el('p', { class: 'muted', text: '이날은 블록이 없어.' }),
        el('a', { href: `#/planner/day?d=${selected}`, class: 'btn btn-primary', text: '그날 플래너 열기' })
      ));
    }

    function renderChart() {
      SM.ui.clear(chartBox);
      const base = selected || today;
      const w = SM.metrics.week(SM.date.isoWeek(base));
      const max = Math.max(60, ...w.days.map((d) => d.actualMin));
      chartBox.appendChild(el('section', { class: 'card stack' },
        el('h3', { text: `이번 주 실제 공부 시간 (${w.isoWeek})` }),
        el('ul', { class: 'mini-bars', 'aria-label': '요일별 실제 공부 시간' },
          w.days.map((d, i) => el('li', { class: 'mini-bar' + (d.date === base ? ' mini-on' : '') },
            el('span', { class: 'mini-label', text: SM.date.WEEKDAY_KO[i] }),
            el('span', { class: 'mini-track', 'aria-hidden': 'true' },
              el('span', { class: 'mini-fill', style: { width: `${Math.round(d.actualMin / max * 100)}%` } })),
            el('span', { class: 'mini-value', text: d.actualMin ? minutesText(d.actualMin) : '—' })
          ))),
        el('p', { class: 'muted', text: `합계 ${minutesText(w.total.actualMin)} · 전략 적용률 ${SM.metrics.pct(w.total.strategyRate)}` })
      ));
    }

    renderCalendar(); renderDetail(); renderChart();
    return el('div', { class: 'stack' }, nav, el('section', { class: 'card stack' }, el('h3', { text: '날마다 전략 적용률' }), calBox), detail, chartBox);
  }

  if (typeof SM.route === 'function') {
    SM.route('#/check', { title: '자기 점검', tab: 'check', render: () => checkScreen({ tab: 'day' }) });
    SM.route('#/check/:tab(day|week|month)', { title: '자기 점검', tab: 'check', render: checkScreen });
  }
})(window.SM = window.SM || {});
