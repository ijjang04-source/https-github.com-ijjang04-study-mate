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

// ---------- SM.feedback: 주간 점검 피드백(규칙 기반, DOM 없음) ----------
(function (SM) {
  'use strict';

  const MAX_RULES = 2;
  const GOOD = 0.7;

  const PLACE_LABEL = { home: '집 책상', class: '교실', library: '도서관·자습실', academy: '학원', cafe: '카페', other: '기타 장소' };

  // B 문항별 잘한 점 문장
  const SCORE_PRAISE = {
    b1: '이번 주 계획을 내 상황에 맞게 세운 게 좋았어.',
    b2: '추천 전략을 하는 법대로 해 본 게 멋져.',
    b3: '책을 덮고 떠올리는 시간을 많이 가진 게 좋았어.',
    b4: '여러 날에 나눠 복습한 게 좋았어.',
    b5: '약점을 보완하는 습관을 실천한 게 멋져.',
    b6: '나한테 맞는 장소와 방식을 찾은 게 좋았어.',
    b7: '모르는 부분을 구체적으로 찾아낸 게 좋았어.',
    b8: '막혔을 때 도움을 구한 게 멋져.'
  };

  const BLOCKER_TIP = {
    phone: (n) => `휴대폰이 ${n}번 방해했어. 다음 주엔 공부할 때 휴대폰을 다른 방에 둬 보자.`,
    sleepy: (n) => `졸린 순간이 ${n}번 있었어. 어려운 과목은 집중이 잘 되는 시간대로 옮겨 보자.`,
    noise: (n) => `소음 때문에 ${n}번 흐트러졌어. 다음엔 조용한 장소로 바꿔 보자.`,
    hard: (n) => `내용이 어려운 순간이 ${n}번 있었어. 선생님·친구에게 묻거나 풀이 예제부터 보자.`,
    other: (n) => `같은 방해가 ${n}번 있었어. 미리 막을 방법을 하나 정해 보자.`
  };

  const pct = (x) => Math.round(x * 100) + '%';
  const scoreOf = (checkin, k) => {
    const v = checkin && checkin.scores ? Number(checkin.scores[k]) : NaN;
    return v >= 1 && v <= 5 ? v : null;
  };

  function strategyName(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : id;
  }

  function josa(word) {
    return SM.planner && SM.planner.objectJosa ? SM.planner.objectJosa(word) : word + '을(를)';
  }

  /** 첫 문장: 가장 높은 지표(0~1)나 점수(5점 → 1.0) 기준. 높은 게 없으면 기본 칭찬 */
  function opening(checkin, mw) {
    const t = (mw && mw.total) || {};
    const cands = [];
    if (t.executionRate !== null && t.executionRate !== undefined) cands.push({ v: t.executionRate, text: `계획한 블록의 ${pct(t.executionRate)}를 실행했어. 꾸준히 한 게 보여!` });
    if (t.amountRate !== null && t.amountRate !== undefined) cands.push({ v: Math.min(1, t.amountRate), text: `목표 분량의 ${pct(t.amountRate)}를 해냈어. 잘했어!` });
    if (t.strategyRate !== null && t.strategyRate !== undefined) cands.push({ v: t.strategyRate, text: `전략 적용률이 ${pct(t.strategyRate)}야. 전략을 실제로 써 본 게 멋져!` });
    Object.keys(SCORE_PRAISE).forEach((k) => {
      const s = scoreOf(checkin, k);
      if (s !== null) cands.push({ v: s / 5, text: SCORE_PRAISE[k] });
    });
    // 같은 값이면 앞의 것(지표 → 문항 순서)
    const best = cands.reduce((a, c) => (!a || c.v > a.v ? c : a), null);
    if (!best || best.v < 0.5) return '이번 주 점검표를 끝까지 쓴 것부터 잘했어.';
    return best.text;
  }

  /**
   * 규칙 평가(위에서부터 최대 2개)
   * → [{ rule, text, strategyId? }]
   */
  function evaluate(checkin, mw) {
    const out = [];
    const t = (mw && mw.total) || {};
    const push = (r) => { if (out.length < MAX_RULES) out.push(r); };

    // 1. 계획이 벅참
    const b1 = scoreOf(checkin, 'b1');
    if (t.executionRate !== null && t.executionRate !== undefined && t.executionRate < 0.5 && b1 !== null && b1 <= 2) {
      push({ rule: 'plan', text: '계획이 조금 벅찼던 것 같아. 다음 주는 블록을 하나 줄여 볼까?' });
    }

    // 2. 적용률 낮은 전략(가장 낮은 것 하나)
    const bs = (mw && mw.byStrategy) || {};
    const low = Object.keys(bs).filter((id) => bs[id] < 0.4).sort((a, b) => bs[a] - bs[b])[0];
    if (low) push({ rule: 'strategy', strategyId: low, text: `${strategyName(low)} 적용률이 ${pct(bs[low])}였어. 하는 법을 더 작게 쪼개 볼까?` });

    // 3. 분산 학습
    const b4 = scoreOf(checkin, 'b4');
    const clump = (mw && mw.clumpBySubject) || {};
    const clumped = Object.keys(clump).filter((s) => clump[s] >= 0.7).sort((a, b) => clump[b] - clump[a])[0];
    if ((b4 !== null && b4 <= 2) || clumped) {
      push({
        rule: 'spacing',
        text: clumped
          ? `${josa(clumped)} 하루에 몰아서 했어. 다음 주엔 월·수·금처럼 나눠 보자.`
          : '한 과목을 여러 날에 나눠 복습하면 더 오래 기억나. 예를 들어 월·수·금에 30분씩 나눠 보자.'
      });
    }

    // 4. 같은 방해 요인 3회 이상
    const top = mw && mw.blockersTop && mw.blockersTop[0];
    if (top && top.count >= 3) push({ rule: 'blocker', blocker: top.id, text: (BLOCKER_TIP[top.id] || BLOCKER_TIP.other)(top.count) });

    // 5. 집중이 잘된 장소(다른 모든 장소보다 1점 이상 높음)
    const fp = (mw && mw.focusByPlace) || {};
    const places = Object.keys(fp).sort((a, b) => fp[b] - fp[a]);
    if (places.length >= 2 && fp[places[0]] - fp[places[1]] >= 1) {
      push({ rule: 'place', place: places[0], text: `${PLACE_LABEL[places[0]] || places[0]}에서 집중이 제일 잘됐어. 어려운 과목을 거기서 해 보자.` });
    }

    // 6. 모든 지표 70% 이상
    if (['executionRate', 'amountRate', 'strategyRate'].every((k) => t[k] !== null && t[k] !== undefined && t[k] >= GOOD)) {
      push({ rule: 'allGood', strategyId: 'pretest', text: '모든 지표가 70%를 넘었어! 다음엔 배우기 전에 문제부터 풀어 보는 사전 시험에 도전해 볼까?' });
    }
    return out;
  }

  /** 2~3문장: 잘한 점 1 + 규칙 최대 2(없으면 격려 1) */
  function weekly(checkin, mw) {
    const lines = [opening(checkin, mw)];
    evaluate(checkin, mw).forEach((r) => lines.push(r.text));
    if (lines.length === 1) {
      const next = checkin && checkin.reflect && String(checkin.reflect.nextChange || '').trim();
      lines.push(next ? '다음 주에 바꿀 한 가지를 플래너에 넣어 뒀어. 그대로 해 보자.' : '다음 주도 지금처럼 기록을 이어 가 보자.');
    }
    return lines.slice(0, 3);
  }

  SM.feedback = { weekly, evaluate, opening, PLACE_LABEL };
})(window.SM = window.SM || {});

// ---------- 주간 점검표 저장 도우미(DOM 없음) ----------
(function (SM) {
  'use strict';

  const MAX_INTENTIONS = 3;

  /** 점검표 배열에서 그 주 것을 바꾸거나 넣은 새 배열(주차 순) */
  function upsert(list, entry) {
    const out = (Array.isArray(list) ? list : []).filter((x) => x && x.isoWeek !== entry.isoWeek);
    out.push(entry);
    out.sort((a, b) => (a.isoWeek < b.isoWeek ? -1 : a.isoWeek > b.isoWeek ? 1 : 0));
    return out;
  }

  function find(list, isoWeek) {
    return (Array.isArray(list) ? list : []).find((x) => x && x.isoWeek === isoWeek) || null;
  }

  function nextWeek(isoWeek) {
    return SM.date.isoWeek(SM.date.addDays(SM.date.weekDays(isoWeek)[0], 7));
  }

  /**
   * 다음 주 실행 의도 맨 위에 '다음 주에 바꿀 한 가지'.
   * 이미 지난주 항목이 있으면 글만 바꾸고, 같은 문장이 있으면 그대로 둔다. 3개를 넘으면 맨 뒤를 뺀다.
   */
  function applyNextChange(intentions, text) {
    const list = (Array.isArray(intentions) ? intentions : []).map((x) => ({ text: String(x.text || ''), from: x.from || null }));
    const t = String(text || '').trim();
    if (!t) return list;
    const carry = list.find((x) => x.from === 'lastWeek');
    if (carry) { carry.text = t; return list; }
    if (list.some((x) => x.text.trim() === t)) return list;
    const rest = list.filter((x) => x.text.trim() || x.from);
    return [{ text: t, from: 'lastWeek' }].concat(rest).slice(0, MAX_INTENTIONS);
  }

  /**
   * '작성할 차례' 판정.
   * 제출 안 했고, (그 주 일요일이거나) 그 주에 블록이 있는 마지막 날보다 오늘이 뒤면 true.
   * 지난주라면 블록이 하나라도 있었으면 true.
   */
  function isDue(today, isoWeek, datesWithBlocks, submitted) {
    if (submitted) return false;
    const days = SM.date.weekDays(isoWeek);
    if (today < days[0]) return false;
    if (today === days[6]) return true;
    const last = (datesWithBlocks || []).filter((d) => d >= days[0] && d <= days[6]).sort().pop();
    if (!last) return false;
    return today > last;
  }

  SM.checkin = { upsert, find, nextWeek, applyNextChange, isDue };
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

    const due = dueWeek();
    const tabs = el('nav', { class: 'tabs', 'aria-label': '점검 보기' },
      TABS.map(([v, label]) => el('a', { href: v === 'week' && due ? `#/check/week?w=${due}` : `#/check/${v}`, class: 'tab', 'aria-current': v === tab ? 'page' : null },
        label,
        v === 'week' && due ? el('span', { class: 'badge', text: '작성할 차례' }) : null)));

    let body;
    let cleanup = null;
    if (tab === 'day') body = dayTab();
    else if (tab === 'week') { const r = weekTab(due); body = r.node; cleanup = r.cleanup; }
    else {
      body = el('div', { class: 'card stack' },
        el('h3', { text: '월간 리포트' }),
        el('p', { class: 'muted', text: '곧 열려. 지금은 일간 탭에서 날마다 기록을 볼 수 있어.' }),
        el('a', { href: '#/check/day', class: 'btn', text: '일간 보기' }));
    }
    return {
      node: el('section', { class: 'check stack' }, el('h2', { class: 'visually-hidden', text: '자기 점검' }), tabs, body),
      cleanup: () => { if (cleanup) cleanup(); }
    };
  }

  function sid() { const p = SM.auth.current(); return p ? p.sid : null; }
  function loadCheckins() { return SM.store.get(SM.keys.checkin(sid()), []) || []; }

  function datesWithBlocks(isoWeek) {
    return SM.date.weekDays(isoWeek).filter((iso) => SM.planner.getDay(iso).length > 0);
  }

  /** 작성할 차례인 주(이번 주 → 지난주 순). 없으면 null */
  function dueWeek() {
    const today = SM.date.today();
    const list = loadCheckins();
    const thisW = SM.date.isoWeek(today);
    const lastW = SM.planner.prevWeek(thisW);
    for (const w of [thisW, lastW]) {
      const c = SM.checkin.find(list, w);
      if (SM.checkin.isDue(today, w, datesWithBlocks(w), !!(c && c.submittedAt))) return w;
    }
    return null;
  }

  // ---------- 주간 점검표 탭 ----------

  const B_ITEMS = [
    ['b1', '이번 주 계획을 내 상황에 맞게 현실적으로 세웠다.'],
    ['b2', '추천 전략을 하는 법대로 실제로 해 보았다.'],
    ['b3', '책을 다시 읽기보다 덮고 떠올리는 시간이 더 많았다.'],
    ['b4', '한 과목을 하루에 몰지 않고 여러 날에 나눠 복습했다.'],
    ['b5', '내 스타일의 약점을 보완하는 습관을 실천했다.'],
    ['b6', '공부 장소와 방식이 내게 맞았다.'],
    ['b7', '모르는 부분을 구체적으로 찾아냈다.'],
    ['b8', '막혔을 때 선생님·친구에게 도움을 구했다.']
  ];
  const SEVEN_STATUS = [['kept', '지켰다'], ['sometimes', '가끔'], ['missed', '못 지켰다']];
  const BLOCKER_LABEL = { phone: '휴대폰', sleepy: '졸림', noise: '소음', hard: '내용이 어려움', other: '기타' };

  function stampText(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function weekTab(due) {
    const el = SM.ui.el;
    const q = query();
    const today = SM.date.today();
    let wk;
    try { SM.date.weekDays(q.w); wk = q.w; } catch (e) { wk = due || SM.date.isoWeek(today); }
    const key = SM.keys.checkin(sid());
    const plan = SM.store.get(SM.keys.plan(sid()), null);
    const results = SM.store.get(SM.keys.results(sid()), []) || [];
    const result = results.length ? results[results.length - 1] : null;
    const mw = SM.metrics.week(wk);
    const days = SM.date.weekDays(wk);
    const short = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}`;
    const P = SM.metrics.pct;

    // 점검표(이 주 것). 일곱 가지 전략은 지금 문장을 기준으로 상태를 붙인다.
    const saved = SM.checkin.find(loadCheckins(), wk);
    const entry = Object.assign({
      isoWeek: wk, scores: {}, seven: [], results: {}, reflect: { good: '', bad: '', nextChange: '' },
      submittedAt: null, updatedAt: null, editedAt: null
    }, saved ? JSON.parse(JSON.stringify(saved)) : {});
    entry.scores = entry.scores || {};
    entry.results = entry.results || {};
    entry.reflect = Object.assign({ good: '', bad: '', nextChange: '' }, entry.reflect || {});
    const rules = ((plan && plan.sevenRules) || []).filter((r) => r && String(r.text || '').trim());
    const oldSeven = Array.isArray(entry.seven) ? entry.seven : [];
    if (!entry.submittedAt || !oldSeven.length) {
      entry.seven = rules.map((r) => {
        const prev = oldSeven.find((s) => s.text === r.text);
        return { text: r.text, status: prev ? prev.status : null };
      });
    }

    const indicator = SM.ui.savedIndicator();
    let dirty = false;
    function write() {
      entry.updatedAt = new Date().toISOString();
      if (entry.submittedAt) entry.editedAt = entry.updatedAt;
      SM.store.set(key, SM.checkin.upsert(loadCheckins(), entry));
      dirty = false;
      indicator.set('saved');
    }
    const persist = SM.ui.debounce(write, 500);
    function changed() { dirty = true; indicator.set('saving'); persist(); }
    function flush() { persist.cancel(); write(); }

    function go(w) { location.hash = `#/check/week?w=${w}`; }
    const nav = el('div', { class: 'planner-nav' },
      el('button', { type: 'button', class: 'btn', 'aria-label': '지난주', text: '◀', onClick: () => go(SM.planner.prevWeek(wk)) }),
      el('strong', { class: 'grow center', text: `${wk} (${short(days[0])}~${short(days[6])})` }),
      el('button', { type: 'button', class: 'btn', 'aria-label': '다음 주', text: '▶', onClick: () => go(SM.checkin.nextWeek(wk)) }),
      indicator.node
    );

    // --- A. 자동 요약 ---
    const t = mw.total;
    const bars = Object.keys(mw.byStrategy).map((id) => {
      const r = mw.byStrategy[id];
      const s = SM.data.strategies.find((x) => x.id === id);
      return el('li', { class: 'rate-row' },
        el('span', { class: 'bar-label', text: s ? s.name : id }),
        el('span', { class: 'mini-track', 'aria-hidden': 'true' }, el('span', { class: 'mini-fill', style: { width: `${Math.min(100, Math.round(r * 100))}%` } })),
        el('span', { class: 'mini-value', text: P(r) }));
    });
    const places = Object.keys(mw.focusByPlace);
    const secA = el('section', { class: 'card stack' },
      el('h3', { text: 'A. 이번 주 자동 요약' }),
      el('dl', { class: 'stat-list' },
        el('dt', { text: '계획 이행률' }), el('dd', { text: t.planned ? `${P(t.executionRate)} (${t.recorded}/${t.planned}블록)` : '기록 없음' }),
        el('dt', { text: '분량 달성률' }), el('dd', { text: P(t.amountRate) }),
        el('dt', { text: '전략 적용률' }), el('dd', { text: P(t.strategyRate) }),
        el('dt', { text: '가장 많은 방해' }), el('dd', { text: mw.blockersTop.length ? `${BLOCKER_LABEL[mw.blockersTop[0].id] || mw.blockersTop[0].id} ${mw.blockersTop[0].count}번` : '기록 없음' })
      ),
      bars.length ? el('div', { class: 'stack' }, el('h4', { text: '전략별 적용률' }), el('ul', { class: 'mini-bars' }, bars)) : null,
      places.length ? el('div', { class: 'stack' }, el('h4', { text: '장소별 평균 집중도' }),
        el('ul', { class: 'block-lines' }, places.map((p) => el('li', { text: `${SM.feedback.PLACE_LABEL[p] || p}: ${mw.focusByPlace[p].toFixed(1)} / 5` })))) : null
    );

    // --- B. 자기 평가 ---
    const secB = el('section', { class: 'card stack' },
      el('h3', { text: 'B. 자기 평가' }),
      el('p', { class: 'muted', text: '1 전혀 아니다 · 2 아니다 · 3 보통 · 4 그렇다 · 5 매우 그렇다' }),
      B_ITEMS.map(([k, text], i) => {
        const group = el('div', { class: 'chip-row scale', role: 'group', 'aria-label': `${i + 1}. ${text}` });
        function paint() {
          SM.ui.clear(group);
          [1, 2, 3, 4, 5].forEach((n) => group.appendChild(el('button', {
            type: 'button', class: 'chip' + (entry.scores[k] === n ? ' chip-on' : ''), 'aria-pressed': String(entry.scores[k] === n),
            'aria-label': `${n} ${SM.data.likertLabels[n - 1]}`, text: String(n),
            onClick(e) { entry.scores[k] = entry.scores[k] === n ? null : n; changed(); paint(); group.children[n - 1].focus(); }
          })));
        }
        paint();
        return el('div', { class: 'stack scale-item' }, el('p', { text: `${i + 1}. ${text}` }), group);
      })
    );

    // --- C. 일곱 가지 전략 ---
    const secC = el('section', { class: 'card stack' },
      el('h3', { text: 'C. 나만의 일곱 가지 전략 실천' }),
      entry.seven.length
        ? entry.seven.map((s, i) => {
          const group = el('div', { class: 'chip-row', role: 'group', 'aria-label': s.text });
          function paint() {
            SM.ui.clear(group);
            SEVEN_STATUS.forEach(([v, label], j) => group.appendChild(el('button', {
              type: 'button', class: 'chip' + (s.status === v ? ' chip-on' : ''), 'aria-pressed': String(s.status === v), text: label,
              onClick() { s.status = s.status === v ? null : v; changed(); paint(); group.children[j].focus(); }
            })));
          }
          paint();
          return el('div', { class: 'stack scale-item' }, el('p', { text: `${i + 1}. ${s.text}` }), group);
        })
        : el('p', null, '아직 일곱 가지 전략이 없어. ', el('a', { href: '#/strategy/seven', text: '만들러 가기' }))
    );

    // --- D. 학습 성과(선택) ---
    const subjects = [];
    ((result && result.subjects) || []).concat(Object.keys(mw.minutesBySubject), Object.keys(entry.results)).forEach((s) => { if (s && subjects.indexOf(s) === -1) subjects.push(s); });
    const secD = el('section', { class: 'card stack' },
      el('h3', { text: 'D. 학습 성과 기록 (선택)' }),
      el('p', { class: 'muted', text: '이번 주 쪽지 시험이나 문제집 정답률을 적어 둬. 나만 볼 수 있어.' }),
      subjects.length ? subjects.map((s) => {
        const id = 'res-' + s;
        const input = el('input', {
          type: 'number', id, class: 'num', inputmode: 'numeric', min: 0, max: 100,
          onInput(e) {
            const v = e.target.value;
            if (v === '') delete entry.results[s];
            else entry.results[s] = Math.max(0, Math.min(100, Math.round(Number(v))));
            changed();
          }
        });
        input.value = entry.results[s] !== undefined ? String(entry.results[s]) : '';
        return el('div', { class: 'row' }, el('label', { for: id, class: 'grow', text: s }), input, el('span', { text: '%' }));
      }) : el('p', { class: 'muted', text: '진단에서 과목을 고르면 여기에 나와.' })
    );

    // --- E. 서술형 ---
    const ref = (k, label, hint) => {
      const ta = el('textarea', { id: 'ref-' + k, rows: 2, maxlength: 200, placeholder: hint, onInput(e) { entry.reflect[k] = e.target.value; changed(); } });
      ta.value = entry.reflect[k] || '';
      return el('div', { class: 'field' }, el('label', { for: 'ref-' + k, text: label }), ta);
    };
    const secE = el('section', { class: 'card stack' },
      el('h3', { text: 'E. 돌아보기' }),
      ref('good', '잘된 점 한 가지', '예) 수요일에 단어를 덮고 떠올려 보니 오래 기억났어'),
      ref('bad', '안 된 점과 그 이유', '예) 목요일은 학원 보강 때문에 계획을 못 지켰어'),
      ref('nextChange', '다음 주에 바꿀 한 가지', '예) 목요일엔 블록을 하나만 잡기')
    );

    // --- 제출 + 피드백 ---
    const status = el('p', { class: 'muted', 'aria-live': 'polite' });
    const fbBox = el('div', { 'aria-live': 'polite' });
    const submitBtn = el('button', { type: 'button', class: 'btn btn-primary', onClick: submit });
    function paintStatus() {
      submitBtn.textContent = entry.submittedAt ? '수정한 내용 다시 제출' : '제출';
      status.textContent = entry.submittedAt
        ? `제출함 ${stampText(entry.submittedAt)}${entry.editedAt ? ` · 수정 ${stampText(entry.editedAt)}` : ''}`
        : '아직 제출 전이야. 쓰는 내용은 바로 저장돼.';
    }
    function paintFeedback() {
      SM.ui.clear(fbBox);
      if (!entry.submittedAt) return;
      const lines = SM.feedback.weekly(entry, mw);
      const cards = SM.feedback.evaluate(entry, mw).filter((r) => r.strategyId);
      fbBox.appendChild(el('section', { class: 'card stack feedback' },
        el('h3', { text: '메이트의 한마디' }),
        el('ul', { class: 'feedback-lines' }, lines.map((l) => el('li', { text: l }))),
        cards.map((r) => {
          const s = SM.data.strategies.find((x) => x.id === r.strategyId);
          if (!s) return null;
          return el('article', { class: 'strategy-mini stack' },
            el('h4', { text: (r.rule === 'allGood' ? '다음 단계 전략: ' : '다시 보기: ') + s.name }),
            el('ol', null, s.howTo.map((h) => el('li', { text: h }))));
        })
      ));
    }

    function submit() {
      const first = !entry.submittedAt;
      entry.submittedAt = entry.submittedAt || new Date().toISOString();
      if (first) entry.editedAt = null;
      persist.cancel();
      entry.updatedAt = new Date().toISOString();
      SM.store.set(key, SM.checkin.upsert(loadCheckins(), entry));
      dirty = false;
      indicator.set('saved');

      // 다음 주에 바꿀 한 가지 → 이번 주 review + 다음 주 실행 의도 맨 위
      const next = String(entry.reflect.nextChange || '').trim();
      const thisWeek = SM.planner.getWeek(wk) || {};
      SM.planner.saveWeek(wk, Object.assign({}, thisWeek, { review: Object.assign({}, thisWeek.review || {}, { nextChange: next }) }));
      if (next) {
        const nw = SM.checkin.nextWeek(wk);
        const nextData = SM.planner.normalizeWeek(SM.planner.getWeek(nw));
        nextData.intentions = SM.checkin.applyNextChange(nextData.intentions, next);
        SM.planner.saveWeek(nw, nextData);
      }

      paintStatus();
      paintFeedback();
      // 챗봇에도 같은 메시지
      const fbLines = SM.feedback.weekly(entry, mw);
      const sig = fbLines.join(' / ');
      if (SM.chat && typeof SM.chat.say === 'function' && entry.chatFeedback !== sig) {
        entry.chatFeedback = sig;
        SM.store.set(key, SM.checkin.upsert(loadCheckins(), entry));
        fbLines.forEach((l) => SM.chat.say(l));
        SM.feedback.evaluate(entry, mw).filter((r) => r.strategyId).forEach((r) => {
          const s = SM.data.strategies.find((x) => x.id === r.strategyId);
          if (s && typeof SM.chat.card === 'function') {
            SM.chat.card({ title: s.name, lines: s.howTo.slice(0, 3), actions: [{ label: '전략 화면에서 보기', go: '#/strategy' }] });
          }
        });
      }
      SM.ui.toast(first ? '제출했어. 아래 피드백을 봐 줘!' : '수정한 내용을 다시 제출했어.');
      fbBox.scrollIntoView && fbBox.scrollIntoView({ block: 'nearest' });
    }

    paintStatus();
    paintFeedback();

    return {
      node: el('div', { class: 'stack' },
        nav,
        el('p', { class: 'private-note', text: '🔒 이 점검표는 너만 볼 수 있어. 공개 설정과 관계없이 반 피드에는 올라가지 않아.' }),
        secA, secB, secC, secD, secE,
        el('div', { class: 'card stack' }, status, submitBtn),
        fbBox
      ),
      cleanup() { if (dirty) flush(); else persist.cancel(); }
    };
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
