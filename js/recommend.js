(function (SM) {
  'use strict';

  // 기능 2 추천 계산(순수 함수, DOM 사용 금지). 같은 결과면 항상 같은 추천을 낸다.

  const CORE = ['retrieval', 'spacing']; // 상위 3개에 꼭 하나는 들어가야 하는 전략
  const SUBJECT_PREFIX = { 수학: 'MATH_', 영어: 'ENG_', 국어: 'KOR_', 과학: 'SCI_', 사회: 'SOC_' };
  const ANXIETY = 'ANY_ANXIETY';

  function strategyById(id) {
    return SM.data.strategies.find((s) => s.id === id) || null;
  }

  function dimMap() {
    const m = {};
    SM.data.styleDims.forEach((d) => { m[d.id] = d; });
    return m;
  }

  /** 극 키 → '~하는 편' 표현 */
  function poleLean(key) {
    const [dimId, side] = String(key).split(':');
    const dims = dimMap();
    const d = dims[dimId];
    if (SM.data.poleLeans[key]) return SM.data.poleLeans[key];
    if (!d) return '';
    if (d.left && (side === 'L' || side === 'R')) return (side === 'L' ? d.left : d.right).lean;
    if (dimId === 'vark' && d.channels[side]) return d.channels[side].lean;
    if (dimId === 'approach' && d.parts[side]) return d.parts[side].lean;
    if (dimId === 'chrono') return (side === 'morning' ? d.left : d.right).lean;
    return '';
  }

  function weaknessCodes(result, subject) {
    const w = ((result && result.weakness) || []).find((x) => x.subject === subject);
    return w ? w.codes : [];
  }

  /** 후보: subjects가 'all'이거나 해당 과목을 포함하는 전략(데이터 순서 유지) */
  function candidates(subject) {
    return SM.data.strategies
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.subjects === 'all' || (Array.isArray(s.subjects) && s.subjects.indexOf(subject) !== -1));
  }

  /** 약점 일치: 1순위 3, 2순위 2, 같은 과목의 다른 약점 1, 없으면 0. 불안 플래그 +1(최대 3). */
  function weaknessMatch(s, result, subject) {
    const codes = weaknessCodes(result, subject);
    const prefix = SUBJECT_PREFIX[subject];
    let m = 0;
    if (codes[0] && s.weakness.indexOf(codes[0]) !== -1) m = 3;
    else if (codes[1] && s.weakness.indexOf(codes[1]) !== -1) m = 2;
    else if (prefix && s.weakness.some((c) => c.indexOf(prefix) === 0)) m = 1;
    if (result && result.anxiety && s.weakness.indexOf(ANXIETY) !== -1) m = Math.min(3, m + 1);
    return m;
  }

  /** 스타일 적합: 겹치는 극이 strong이면 1, mild만 있으면 0.5, 없으면 0. 대표 극도 돌려준다. */
  function styleFit(s, poles) {
    const hit = poles.filter((p) => s.fitsStyle.indexOf(p.key) !== -1);
    if (!hit.length) return { fit: 0, pole: null };
    const strong = hit.find((p) => p.band === 'strong');
    return strong ? { fit: 1, pole: strong.key } : { fit: 0.5, pole: hit[0].key };
  }

  function reasonsFor(s, result, subject, w, fit) {
    const reasons = [];
    const codes = weaknessCodes(result, subject);
    const hit = [codes[0], codes[1]].find((c) => c && s.weakness.indexOf(c) !== -1);
    const prefix = SUBJECT_PREFIX[subject];
    if (hit && SM.data.weaknessYou[hit]) {
      reasons.push(`${SM.data.weaknessYou[hit]} 너에게 딱 맞는 연습이야.`);
    } else if (prefix && s.weakness.some((c) => c.indexOf(prefix) === 0)) {
      reasons.push(`${subject}에서 자주 막히는 부분을 다루는 방법이야.`);
    }
    if (result && result.anxiety && s.weakness.indexOf(ANXIETY) !== -1) {
      reasons.push('시험 긴장을 다루는 데도 도움이 돼.');
    }
    if (fit.pole) {
      const lean = poleLean(fit.pole);
      if (lean) reasons.push(`${lean}인 너에게 잘 맞는 방식이야.`);
    }
    if (s.evidence >= 2.5) reasons.push('효과가 여러 연구에서 확인된 방법이야.');
    if (!reasons.length) reasons.push('어떤 과목에서든 기본이 되는 공부법이야.');
    return reasons;
  }

  /** 과목의 전체 순위. 점수 내림차순 → evidence 내림차순 → 데이터 순서. */
  function rank(result, subject) {
    const poles = SM.score.poles(result);
    const items = candidates(subject).map(({ s, i }) => {
      const w = weaknessMatch(s, result, subject);
      const fit = styleFit(s, poles);
      return {
        id: s.id,
        order: i,
        score: s.evidence + w + fit.fit,
        parts: { evidence: s.evidence, weakness: w, style: fit.fit },
        pole: fit.pole,
        reasons: reasonsFor(s, result, subject, w, fit)
      };
    });
    items.sort((a, b) => (b.score - a.score) || (b.parts.evidence - a.parts.evidence) || (a.order - b.order));
    return items;
  }

  /** 상위 3개에 retrieval·spacing이 없으면 둘 중 순위가 높은 것을 3위 자리에 넣는다. */
  function applyCore(ranked) {
    const top = ranked.slice(0, 3);
    if (top.some((x) => CORE.indexOf(x.id) !== -1)) return top;
    const core = ranked.find((x) => CORE.indexOf(x.id) !== -1);
    if (core && top.length) top[Math.min(2, top.length - 1)] = core;
    return top;
  }

  function strip(x) {
    return { id: x.id, score: x.score, parts: x.parts, pole: x.pole, reasons: x.reasons };
  }

  /** 상위 3개 [{ id, score, parts:{evidence, weakness, style}, pole, reasons }] */
  function forSubject(result, subject) {
    return applyCore(rank(result, subject)).map(strip);
  }

  /** 순위 목록에서 한 전략의 점수·이유(교체해 들어온 전략 표시용) */
  function explain(result, subject, id) {
    const x = rank(result, subject).find((r) => r.id === id);
    return x ? strip(x) : null;
  }

  /**
   * '다른 전략 보기': current[idx]를 바꿀 전략 id. 없으면 null.
   * 후보는 지금 보이는 3개를 뺀 순위 4~6위. 바꾼 뒤 retrieval·spacing이 하나도 없게 되면
   * 그 둘 중 아직 안 보이는 것으로만 바꾼다(강제 규칙 유지).
   */
  function alternative(result, subject, current, idx) {
    const ranked = rank(result, subject).map((r) => r.id);
    const others = current.filter((_, i) => i !== idx);
    const needCore = !others.some((id) => CORE.indexOf(id) !== -1);
    const notShown = ranked.filter((id) => current.indexOf(id) === -1);
    const options = needCore ? notShown.filter((id) => CORE.indexOf(id) !== -1) : notShown.slice(0, 3);
    return options.length ? options[0] : null;
  }

  /** 보완 습관 최대 2개: strong 극 우선, 모자라면 mild 극에서 채운다. */
  function habits(result) {
    const poles = SM.score.poles(result);
    const ordered = poles.filter((p) => p.band === 'strong').concat(poles.filter((p) => p.band !== 'strong'));
    const out = [];
    ordered.forEach((p) => {
      if (out.length >= 2) return;
      const h = SM.data.habits.find((x) => x.poles.indexOf(p.key) !== -1 && out.indexOf(x) === -1);
      if (h) out.push(h);
    });
    return out;
  }

  /** 추천 장소·혼자/함께·시간대 */
  function environment(result) {
    const poles = SM.score.poles(result);
    const find = (prefix) => poles.find((p) => p.key.indexOf(prefix + ':') === 0);
    const ways = SM.data.styleWays;

    const fd = find('fieldDep');
    const pr = find('processing');
    const ch = find('chrono');

    const place = fd && ways[fd.key].place ? ways[fd.key].place : null;
    const withWho = pr && ways[pr.key].with ? ways[pr.key].with : (fd && ways[fd.key].with) || null;
    const time = ch ? (ch.key === 'chrono:morning' ? '아침·오전' : '저녁') : null;

    const lines = [
      place ? `추천 장소: ${place}` : '편한 곳 아무 데나 괜찮아.',
      withWho ? `방식: ${withWho} 할 때 잘 맞는 편이야.` : '혼자든 함께든 편한 대로 해도 괜찮아.',
      time ? `시간대: 어려운 과목은 ${time}에 해 봐.`
        : (result && result.extended ? '시간대는 편한 때 아무 때나 괜찮아.' : '시간대는 심화 검사를 하면 알려 줄게.')
    ];
    return { place, with: withWho, time, lines };
  }

  /** 카드의 '내 스타일로 하는 법'에 쓸 극: 전략과 맞는 극, 없으면 가장 뚜렷한 극 */
  function cardPole(result, matchedPole) {
    if (matchedPole) return matchedPole;
    const poles = SM.score.poles(result);
    const strong = poles.find((p) => p.band === 'strong');
    return strong ? strong.key : poles.length ? poles[0].key : null;
  }

  // ---------- 나만의 일곱 가지 전략 ----------

  const SEVEN = 7;
  const MAX_STRATEGIES = 6;
  const MAX_HABITS = 2;

  function chronoOf(result) {
    const p = SM.score.poles(result).find((x) => x.key.indexOf('chrono:') === 0);
    return p ? p.key.split(':')[1] : null;
  }

  function makeText(when, act, subject) {
    return `나는 ${when} ${act.replace(/\{subject\}/g, subject || '').replace(/\s+/g, ' ').trim()}.`;
  }

  /**
   * 후보 목록(순서 고정).
   * 전략: 과목별 plan 전략(없으면 추천 상위 3) → 이어지는 순위, 과목을 번갈아 가며. 같은 전략은 한 번만.
   * 습관: strong 극 우선 → mild 극.
   * → [{ kind:'strategy'|'habit', id, subject, when(키), act, name }]
   */
  function sevenPool(result, plan) {
    const parts = SM.data.sevenRuleParts;
    const subjects = (result && result.subjects) || [];
    const lists = subjects.map((s) => {
      const picked = (plan && plan.strategies && plan.strategies[s]) || forSubject(result, s).map((x) => x.id);
      const rest = rank(result, s).map((x) => x.id).filter((id) => picked.indexOf(id) === -1);
      return { subject: s, ids: picked.concat(rest) };
    });
    const strategies = [];
    const seen = {};
    const longest = Math.max(0, ...lists.map((l) => l.ids.length));
    for (let i = 0; i < longest; i++) {
      lists.forEach((l) => {
        const id = l.ids[i];
        if (!id || seen[id] || !parts.strategies[id]) return;
        seen[id] = true;
        const st = SM.data.strategies.find((x) => x.id === id);
        strategies.push({ kind: 'strategy', id, subject: l.subject, when: parts.strategies[id].when, act: parts.strategies[id].act, name: st.name });
      });
    }

    const poles = SM.score.poles(result);
    const ordered = poles.filter((p) => p.band === 'strong').concat(poles.filter((p) => p.band !== 'strong'));
    const habitList = [];
    ordered.forEach((p) => {
      SM.data.habits.forEach((h) => {
        if (h.poles.indexOf(p.key) !== -1 && habitList.indexOf(h) === -1 && parts.habits[h.id]) habitList.push(h);
      });
    });
    const habitItems = habitList.map((h) => ({ kind: 'habit', id: h.id, subject: null, when: parts.habits[h.id].when, act: parts.habits[h.id].act, name: h.name }));
    return { strategies, habits: habitItems };
  }

  /** 후보 하나를 문장으로. timeWhen이 있으면 상황을 그 시간 표현으로 바꾼다. */
  function draftOf(item, timeWhen) {
    const when = timeWhen || SM.data.ruleSituations[item.when] || '';
    return {
      text: makeText(when, item.act, item.subject),
      strategyId: item.kind === 'strategy' ? item.id : null,
      habitId: item.kind === 'habit' ? item.id : null,
      name: item.name
    };
  }

  /**
   * 초안 7개 이하: 보완 습관 최대 2개 + 전략 최대 6개(합 7 이하). 중복 없음.
   * chrono 극이 있으면 '공부를 시작하는 상황(home)' 문장을 그 시간대로 바꾼다(없으면 첫 문장).
   */
  function sevenDrafts(result, plan) {
    const pool = sevenPool(result, plan);
    const habitsPicked = pool.habits.slice(0, MAX_HABITS);
    const stratPicked = pool.strategies.slice(0, Math.min(MAX_STRATEGIES, SEVEN - habitsPicked.length));
    const items = stratPicked.concat(habitsPicked);

    const chrono = chronoOf(result);
    const times = chrono ? SM.data.ruleTimes[chrono].slice() : [];
    let timeTargets = [];
    if (times.length) {
      timeTargets = items.map((it, i) => (it.when === 'home' ? i : -1)).filter((i) => i !== -1).slice(0, times.length);
      if (!timeTargets.length && items.length) timeTargets = [0];
    }
    return items.map((it, i) => {
      const t = timeTargets.indexOf(i);
      return draftOf(it, t !== -1 ? times[t] : null);
    });
  }

  /** '다시 만들기': 지금 쓰고 있지 않은 다음 후보로 만든 초안. 없으면 null. */
  function nextDraft(result, plan, rules, idx) {
    const pool = sevenPool(result, plan);
    const all = pool.strategies.concat(pool.habits);
    const used = {};
    (rules || []).forEach((r, i) => {
      if (i === idx || !r) return;
      if (r.strategyId) used['s:' + r.strategyId] = true;
      if (r.habitId) used['h:' + r.habitId] = true;
    });
    const cur = rules && rules[idx];
    const curKey = cur ? (cur.strategyId ? 's:' + cur.strategyId : cur.habitId ? 'h:' + cur.habitId : null) : null;
    const keyOf = (it) => (it.kind === 'strategy' ? 's:' : 'h:') + it.id;
    const free = all.filter((it) => !used[keyOf(it)]);
    if (!free.length) return null;
    // 지금 것 다음 후보부터 돌아가며 고른다.
    const at = free.findIndex((it) => keyOf(it) === curKey);
    const pick = free[(at + 1) % free.length];
    if (keyOf(pick) === curKey) return null;
    return draftOf(pick, null);
  }

  /** 문장 형식 점검: '~면'(또는 '~전에') 조건절과 그 뒤 행동이 있는지. 저장은 막지 않는다. */
  function checkRule(text) {
    const t = String(text || '').trim();
    if (!t) return { ok: true, missing: null, empty: true };
    if (/(면|전에)[\s,.]*$/.test(t)) return { ok: false, missing: 'act', empty: false };
    const m = /(면|전에)[\s,]+(.+)$/.exec(t);
    if (!m) return { ok: false, missing: 'when', empty: false };
    const act = m[2].replace(/[.\s]+$/, '');
    if (act.length < 2) return { ok: false, missing: 'act', empty: false };
    return { ok: true, missing: null, empty: false };
  }

  SM.recommend = {
    forSubject, rank, explain, alternative, habits, environment, cardPole,
    weaknessMatch, styleFit, poleLean, candidates, CORE,
    sevenPool, sevenDrafts, nextDraft, checkRule
  };
})(window.SM = window.SM || {});
