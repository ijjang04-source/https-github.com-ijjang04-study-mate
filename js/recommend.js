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

  SM.recommend = {
    forSubject, rank, explain, alternative, habits, environment, cardPole,
    weaknessMatch, styleFit, poleLean, candidates, CORE
  };
})(window.SM = window.SM || {});
