(function (SM) {
  'use strict';

  // 기능 1: 학습 스타일 진단
  //   SM.score   채점(순수 함수, DOM 사용 금지)
  //   #/test     기본형 진단, #/test/deep 심화형 진단
  //   #/result   결과 화면

  // =====================================================================
  // 채점 SM.score
  // =====================================================================

  const BALANCE = 20;
  const STRONG = 60;
  // 스펙트럼 막대로 보여 주는 양극 차원(기본형). Kolb 두 축은 2×2 그림으로 따로 보여 준다.
  const SPECTRUM_DIMS = ['fieldDep', 'tempo', 'perception', 'reasoning', 'processing', 'input', 'order'];

  function dimMap() {
    const m = {};
    SM.data.styleDims.forEach((d) => { m[d.id] = d; });
    return m;
  }

  function round(x) { return Math.round(x) + 0; } // -0 → 0

  function isLikertValue(v) { return Number.isInteger(v) && v >= 1 && v <= 5; }

  /** likert 차원: v = 응답−3, reverse면 −v. 합 ÷ (문항 수×2) × 100. 답이 없으면 null. */
  function scoreLikert(dimId, answers) {
    let sum = 0, n = 0;
    SM.data.styleQuestions.forEach((q) => {
      if (q.dim !== dimId) return;
      const a = answers[q.id];
      if (!isLikertValue(a)) return;
      const v = a - 3;
      sum += q.reverse ? -v : v;
      n++;
    });
    return n ? round(sum / (n * 2) * 100) : null;
  }

  /** forced 차원: (B 수 − A 수) ÷ 문항 수 × 100. B가 right. */
  function scoreForced(dimId, answers) {
    let a = 0, b = 0;
    SM.data.styleQuestions.forEach((q) => {
      if (q.dim !== dimId) return;
      if (answers[q.id] === 'a') a++;
      else if (answers[q.id] === 'b') b++;
    });
    const n = a + b;
    return n ? round((b - a) / n * 100) : null;
  }

  /** vark: 채널별 선택 횟수, 최댓값의 80% 이상인 채널 모두 선호. */
  function scoreVark(answers) {
    const counts = { V: 0, A: 0, R: 0, K: 0 };
    SM.data.styleQuestions.forEach((q) => {
      if (q.dim !== 'vark' || !Array.isArray(answers[q.id])) return;
      answers[q.id].forEach((k) => { if (k in counts) counts[k]++; });
    });
    const max = Math.max(counts.V, counts.A, counts.R, counts.K);
    const preferred = max > 0 ? ['V', 'A', 'R', 'K'].filter((k) => counts[k] >= max * 0.8) : [];
    return { counts, preferred };
  }

  /**
   * kolb: perceive(구체 − / 추상 +), process(성찰 − / 실험 +).
   * 두 축 모두 |점수| < 20이면 balanced. 0은 + 쪽으로 본다.
   */
  function kolbType(perceive, process) {
    if (perceive === null || process === null || perceive === undefined || process === undefined) return null;
    if (Math.abs(perceive) < BALANCE && Math.abs(process) < BALANCE) return 'balanced';
    const abstract = perceive >= 0;
    const active = process >= 0;
    if (abstract) return active ? 'converging' : 'assimilating';
    return active ? 'accommodating' : 'diverging';
  }

  function band(s) {
    if (s === null || s === undefined || isNaN(s)) return null;
    const a = Math.abs(s);
    return a < BALANCE ? 'balanced' : a < STRONG ? 'mild' : 'strong';
  }

  /** 화면 표시용 판정 문구. order는 strong이어도 '경향'. */
  function bandText(dimId, s) {
    const b = band(s);
    if (b === null) return '응답 없음';
    if (b === 'balanced') return '균형';
    if (dimId === 'order') return '경향';
    return b === 'mild' ? '약한 경향' : '뚜렷한 경향';
  }

  /** 점수 쪽의 left/right. 0이면 null. */
  function sideOf(dim, s) {
    if (!dim || !s) return null;
    return s < 0 ? dim.left : dim.right;
  }

  /** 과목별로 4점 이상인 code를 점수 높은 순, 최대 2개. 동점이면 문항 순서. */
  function scoreWeakness(answers, subjects) {
    const th = SM.data.weaknessThreshold;
    return (subjects || []).map((subject) => {
      const items = SM.data.weaknessQuestions[subject] || [];
      const codes = items
        .map((w, i) => ({ code: w.code, i, v: answers[w.id] }))
        .filter((x) => isLikertValue(x.v) && x.v >= th)
        .sort((x, y) => (y.v - x.v) || (x.i - y.i))
        .slice(0, 2)
        .map((x) => x.code);
      return { subject, codes };
    });
  }

  function scoreAnxiety(answers) {
    const th = SM.data.weaknessThreshold;
    return SM.data.weaknessQuestions['공통'].some((w) => isLikertValue(answers[w.id]) && answers[w.id] >= th);
  }

  function todayIso(now) {
    return SM.date.today(now instanceof Date ? now : (now ? new Date(now) : new Date()));
  }

  /** 기본형 채점 → results 항목 */
  function scoreBasic(answers, subjects, now) {
    const ans = answers || {};
    const styles = {};
    SM.data.styleDims.forEach((d) => {
      if (d.set !== 'basic') return;
      if (d.format === 'likert') styles[d.id] = scoreLikert(d.id, ans);
      else if (d.format === 'forced') styles[d.id] = scoreForced(d.id, ans);
    });
    const perceive = styles.kolbPerceive;
    const process = styles.kolbProcess;
    return {
      version: 1,
      takenAt: todayIso(now),
      subjects: (subjects || []).slice(),
      weakness: scoreWeakness(ans, subjects),
      anxiety: scoreAnxiety(ans),
      styles,
      vark: scoreVark(ans),
      kolb: { perceive, process, type: kolbType(perceive, process) }
    };
  }

  /** 심화형 채점: approach 0~100, goal 1~5, chrono morning|evening|balanced */
  function scoreExtended(answers, now) {
    const ans = answers || {};
    const approach = {};
    ['deep', 'surface', 'achieving'].forEach((part) => {
      const vals = SM.data.styleQuestions
        .filter((q) => q.dim === 'approach' && q.part === part)
        .map((q) => ans[q.id])
        .filter(isLikertValue);
      approach[part] = vals.length ? round((vals.reduce((a, b) => a + b, 0) / vals.length - 1) / 4 * 100) : null;
    });
    const goal = {};
    SM.data.styleQuestions.filter((q) => q.dim === 'goal').forEach((q) => {
      goal[q.part] = isLikertValue(ans[q.id]) ? ans[q.id] : null;
    });
    const chronoScore = scoreForced('chrono', ans);
    const b = band(chronoScore);
    const chrono = b === null ? null : b === 'balanced' ? 'balanced' : chronoScore < 0 ? 'morning' : 'evening';
    return { takenAt: todayIso(now), approach, goal, chrono, chronoScore };
  }

  /** 한 줄 요약. 단일 라벨("○○형") 없이 '~하는 편' 문장으로. */
  function summary(result) {
    const dims = dimMap();
    const styles = (result && result.styles) || {};
    const picks = SPECTRUM_DIMS
      .filter((id) => {
        const b = band(styles[id]);
        return b === 'mild' || b === 'strong';
      })
      .sort((a, b) => Math.abs(styles[b]) - Math.abs(styles[a]))
      .slice(0, 3)
      .map((id) => sideOf(dims[id], styles[id]).phrase);
    if (!picks.length) return '여러 방식을 고르게 쓰는 편이야.';
    return `너는 ${picks.join(', ')} 공부할 때 편한 편이야.`;
  }

  /**
   * 결과에서 추천에 쓸 스타일 극 목록(balanced 제외).
   * → [{ key: 'fieldDep:R', band: 'mild'|'strong' }]
   *  - 양극 차원(SPECTRUM_DIMS): 점수 부호로 L/R, band는 점수로.
   *  - vark: 선호 채널마다. 선호가 하나뿐이면 strong, 여럿이면 mild.
   *  - kolb: type이 balanced가 아니면, 두 축 중 |점수|가 큰 쪽으로 band.
   *  - approach:surface: 심화 결과에서 surface ≥ 60이고 deep보다 높을 때(75 이상 strong).
   *  - goal:avoid: masteryAvoid 또는 performanceAvoid가 4 이상(5면 strong).
   *  - chrono: morning/evening이면 chronoScore로 band.
   */
  function poles(result) {
    const out = [];
    if (!result) return out;
    const styles = result.styles || {};
    SPECTRUM_DIMS.forEach((id) => {
      const s = styles[id];
      const b = band(s);
      if (b === 'mild' || b === 'strong') out.push({ key: `${id}:${s < 0 ? 'L' : 'R'}`, band: b });
    });
    const pref = (result.vark && result.vark.preferred) || [];
    pref.forEach((k) => out.push({ key: `vark:${k}`, band: pref.length === 1 ? 'strong' : 'mild' }));

    const k = result.kolb || {};
    if (k.type && k.type !== 'balanced') {
      const b = band(Math.max(Math.abs(k.perceive || 0), Math.abs(k.process || 0)));
      out.push({ key: `kolb:${k.type}`, band: b === 'strong' ? 'strong' : 'mild' });
    }

    const ext = result.extended;
    if (ext) {
      const ap = ext.approach || {};
      if (typeof ap.surface === 'number' && ap.surface >= 60 && ap.surface > (ap.deep || 0)) {
        out.push({ key: 'approach:surface', band: ap.surface >= 75 ? 'strong' : 'mild' });
      }
      const g = ext.goal || {};
      const avoid = Math.max(g.masteryAvoid || 0, g.performanceAvoid || 0);
      if (avoid >= 4) out.push({ key: 'goal:avoid', band: avoid >= 5 ? 'strong' : 'mild' });
      if (ext.chrono === 'morning' || ext.chrono === 'evening') {
        const b = band(ext.chronoScore);
        out.push({ key: `chrono:${ext.chrono}`, band: b === 'strong' ? 'strong' : 'mild' });
      }
    }
    return out;
  }

  SM.score = {
    likert: scoreLikert, forced: scoreForced, vark: scoreVark, kolbType,
    band, bandText, sideOf, weakness: scoreWeakness, anxiety: scoreAnxiety,
    basic: scoreBasic, extended: scoreExtended, summary, poles,
    SPECTRUM_DIMS, BALANCE, STRONG
  };

  // =====================================================================
  // 진행(기본형·심화형)
  // =====================================================================

  const AUTO_NEXT_MS = 300;
  const MAX_SUBJECTS = 2;
  const COMMON = '공통';
  const RETEST_DAYS = 28;

  const AREA_INTRO = {
    weakness: '고른 과목에서 막히는 점부터 물어볼게!',
    1: '먼저 정보를 어떻게 처리하는지 볼게!',
    2: '이번엔 정보를 어떤 형태로 받기 좋아하는지 볼게!',
    3: '마지막으로 어떤 순서로 배우는지!',
    4: '공부할 때 어떤 마음으로 임하는지 볼게!',
    5: '마지막으로 하루 중 언제 집중이 잘 되는지!'
  };

  let itemIndex = null;
  function buildIndex() {
    if (itemIndex) return itemIndex;
    itemIndex = {};
    const dims = dimMap();
    SM.data.styleQuestions.forEach((q) => {
      itemIndex[q.id] = Object.assign({ kind: 'style', area: dims[q.dim].area }, q);
    });
    Object.keys(SM.data.weaknessQuestions).forEach((subject) => {
      SM.data.weaknessQuestions[subject].forEach((w) => {
        itemIndex[w.id] = Object.assign({ kind: 'weakness', area: 'weakness', format: 'likert', subject }, w);
      });
    });
    return itemIndex;
  }

  function itemById(id) { return buildIndex()[id] || null; }

  function shuffle(list, rng) {
    const r = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function areaIds(set, area) {
    const dims = dimMap();
    return SM.data.styleQuestions
      .filter((q) => q.set === set && dims[q.dim].area === area)
      .map((q) => q.id);
  }

  /** 약점(고른 과목 순) → 공통 1문항 → 기본형 영역 ①→②→③(영역 안에서만 섞음) */
  function buildOrder(subjects, rng) {
    const list = Array.isArray(subjects) ? subjects : [];
    if (list.length < 1 || list.length > MAX_SUBJECTS) throw new Error('과목은 1~2개를 골라야 해요.');
    if (new Set(list).size !== list.length) throw new Error('같은 과목을 두 번 고를 수 없어요.');
    const order = [];
    list.forEach((s) => {
      const items = SM.data.weaknessQuestions[s];
      if (!items || s === COMMON) throw new Error('없는 과목: ' + s);
      items.forEach((w) => order.push(w.id));
    });
    SM.data.weaknessQuestions[COMMON].forEach((w) => order.push(w.id));
    [1, 2, 3].forEach((area) => shuffle(areaIds('basic', area), rng).forEach((id) => order.push(id)));
    return order;
  }

  /** 심화형: 영역 ④ → ⑤(영역 안에서만 섞음) */
  function buildDeepOrder(rng) {
    const order = [];
    [4, 5].forEach((area) => shuffle(areaIds('deep', area), rng).forEach((id) => order.push(id)));
    return order;
  }

  function isAnswered(item, value) {
    if (!item || value === undefined || value === null) return false;
    if (item.format === 'likert') return isLikertValue(value);
    if (item.format === 'forced') return value === 'a' || value === 'b';
    if (item.format === 'multi') {
      const keys = item.options.map((o) => o.key);
      return Array.isArray(value) && value.length > 0 && value.every((k) => keys.indexOf(k) !== -1);
    }
    return false;
  }

  function resumeIndex(progress) {
    if (!progress || !Array.isArray(progress.order)) return 0;
    const answers = progress.answers || {};
    for (let i = 0; i < progress.order.length; i++) {
      if (!isAnswered(itemById(progress.order[i]), answers[progress.order[i]])) return i;
    }
    return progress.order.length;
  }

  function sectionIntro(order, i) {
    const cur = itemById(order[i]);
    if (!cur) return null;
    const prev = i > 0 ? itemById(order[i - 1]) : null;
    if (cur.kind === 'weakness') return !prev || prev.kind !== 'weakness' ? AREA_INTRO.weakness : null;
    return !prev || prev.area !== cur.area ? AREA_INTRO[cur.area] || null : null;
  }

  // ---------- 저장 ----------

  function me() { return SM.auth.current(); }

  function progressKey(mode) {
    const p = me();
    if (!p) return null;
    return mode === 'deep' ? SM.keys.testProgressDeep(p.sid) : SM.keys.testProgress(p.sid);
  }

  function loadResults() {
    const p = me();
    const list = p ? SM.store.get(SM.keys.results(p.sid), []) : [];
    return Array.isArray(list) ? list : [];
  }

  /** 기본형 끝: 채점 → results 끝에 추가 → 진행 기록 삭제 → #/result */
  function finish(progress) {
    const p = me();
    if (!p) return;
    const scored = scoreBasic(progress.answers || {}, progress.subjects || []);
    // 덮어쓰지 않고 배열 끝에 쌓는다. 결과마다 id·kind(기본)
    SM.store.update(SM.keys.results(p.sid), (list) => {
      const arr = Array.isArray(list) ? list : [];
      return arr.concat([Object.assign({ id: SM.schema3.nextResultId(arr, scored.takenAt), kind: 'basic' }, scored)]);
    }, []);
    SM.store.remove(SM.keys.testProgress(p.sid));
    if (SM.chat && typeof SM.chat.notify === 'function') SM.chat.notify('학습 스타일 진단을 마쳤어. 결과를 정리해 뒀어.');
    // 재검사로 결과가 2개 이상이 됐으면 바로 비교를 권한다
    if (SM.chat && typeof SM.chat.offerCompare === 'function') SM.chat.offerCompare(p.sid);
    location.hash = '#/result';
  }

  /** 심화형 끝: 최신 결과의 extended에 병합 → 진행 기록 삭제 → #/result */
  function finishDeep(progress) {
    const p = me();
    if (!p) return;
    const ext = scoreExtended(progress.answers || {});
    SM.store.update(SM.keys.results(p.sid), (list) => {
      const arr = Array.isArray(list) ? list.slice() : [];
      // 심화는 따로 쌓지 않고 가장 최근 기본 결과에 붙인다(기록 목록에 '심화 포함')
      if (arr.length) arr[arr.length - 1] = Object.assign({}, arr[arr.length - 1], { extended: ext, kind: 'deep' });
      return arr;
    }, []);
    SM.store.remove(SM.keys.testProgressDeep(p.sid));
    if (SM.chat && typeof SM.chat.notify === 'function') SM.chat.notify('심화 진단을 마쳤어. 결과에 더해 뒀어.');
    location.hash = '#/result';
  }

  // ---------- 진행 화면 ----------

  function testScreen(params) {
    const mode = params && params.mode === 'deep' ? 'deep' : 'basic';
    const el = SM.ui.el;
    const root = el('section', { class: 'test stack' });
    const key = progressKey(mode);
    let progress = key ? SM.store.get(key, null) : null;
    let timer = null;
    let keyHandler = null;

    function saveProgress() { if (key) SM.store.set(key, progress); }

    function setKeys(fn) {
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      keyHandler = fn;
      if (fn) document.addEventListener('keydown', fn);
    }

    function show(...nodes) {
      clearTimeout(timer);
      setKeys(null);
      SM.ui.clear(root);
      nodes.forEach((n) => { if (n) root.appendChild(n); });
      const focusTarget = root.querySelector('[data-autofocus]');
      if (focusTarget) focusTarget.focus();
    }

    function botBubble(text, attrs) {
      return el('div', { class: 'msg msg-bot' },
        el('span', { class: 'msg-name', text: '공부 메이트' }),
        el('p', Object.assign({ class: 'bubble', text }, attrs || {}))
      );
    }

    function doFinish() {
      if (mode === 'deep') SM.test.finishDeep(progress);
      else SM.test.finish(progress);
    }

    function startNew() {
      if (mode === 'deep') {
        progress = { startedAt: new Date().toISOString(), subjects: [], order: buildDeepOrder(), answers: {}, index: 0 };
        saveProgress();
        showQuestion(0);
      } else {
        showSubjects();
      }
    }

    // --- 시작 화면 ---
    function showIntro() {
      if (mode === 'deep' && !loadResults().length) {
        show(el('div', { class: 'card stack' },
          el('h2', { text: '심화 검사', tabindex: '-1', 'data-autofocus': true }),
          el('p', { text: '심화 검사는 기본 검사를 마친 뒤에 할 수 있어.' }),
          el('a', { href: '#/test', class: 'btn btn-primary', text: '기본 검사 하러 가기' })
        ));
        return;
      }
      const hasProgress = progress && Array.isArray(progress.order) && progress.order.length > 0 &&
        Object.keys(progress.answers || {}).length > 0;
      const done = hasProgress ? resumeIndex(progress) : 0;

      const actions = el('div', { class: 'stack' });
      if (hasProgress && done >= progress.order.length) {
        actions.append(
          el('p', { text: '지난번에 모든 문항에 답했어. 결과를 볼까?' }),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn btn-primary', text: '결과 보기', onClick: doFinish }),
            el('button', { type: 'button', class: 'btn', text: '처음부터', onClick: restart })
          )
        );
      } else if (hasProgress) {
        actions.append(
          el('p', { text: `지난번 ${done}번까지 했어. 이어서 할까?` }),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn btn-primary', text: '이어서 하기', onClick: () => showQuestion(done) }),
            el('button', { type: 'button', class: 'btn', text: '처음부터', onClick: restart })
          )
        );
      } else {
        actions.append(el('button', { type: 'button', class: 'btn btn-primary', text: '시작하기', onClick: startNew }));
      }

      if (mode === 'deep') {
        show(el('div', { class: 'card stack' },
          el('h2', { text: '더 알아보기: 심화 검사', tabindex: '-1', 'data-autofocus': true }),
          el('p', { text: '공부할 때의 마음가짐과 집중이 잘 되는 시간대를 12문항으로 볼게.' }),
          el('p', { text: '이 영역은 타고난 성향이 아니라 지금 상태야. 상황에 따라 얼마든지 달라져.' }),
          el('p', { class: 'muted', text: '예상 시간 3분' }),
          actions
        ));
      } else {
        show(el('div', { class: 'card stack' },
          el('h2', { text: '나의 학습 스타일은 무엇일까?', tabindex: '-1', 'data-autofocus': true }),
          el('p', { text: '이 검사는 너의 공부 선호를 보여주는 거울이야. 좋고 나쁜 유형은 없고, 선호는 바뀔 수 있어.' }),
          el('p', { class: 'muted', text: '예상 시간 10~12분' }),
          actions
        ));
      }
    }

    async function restart() {
      const yes = await SM.ui.confirmDialog('지금까지 한 답이 지워져. 처음부터 할까?', { okText: '처음부터', cancelText: '취소' });
      if (!yes) return;
      progress = null;
      if (key) SM.store.remove(key);
      startNew();
    }

    // --- 1. 취약 과목 선택(기본형만) ---
    function showSubjects() {
      const picked = [];
      const nextBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '다음', disabled: true });
      const count = el('p', { class: 'muted', 'aria-live': 'polite', text: '0개 골랐어 (최대 2개)' });
      const chips = SM.config.subjects.map((s) => el('button', {
        type: 'button', class: 'chip', 'aria-pressed': 'false', text: s,
        onClick(e) {
          const btn = e.currentTarget;
          const at = picked.indexOf(s);
          if (at !== -1) {
            picked.splice(at, 1);
          } else if (picked.length >= MAX_SUBJECTS) {
            SM.ui.toast('집중을 위해 2개까지만 골라 줘');
            return;
          } else {
            picked.push(s);
          }
          const on = picked.indexOf(s) !== -1;
          btn.classList.toggle('chip-on', on);
          btn.setAttribute('aria-pressed', String(on));
          count.textContent = `${picked.length}개 골랐어 (최대 2개)`;
          nextBtn.disabled = picked.length === 0;
        }
      }));
      nextBtn.addEventListener('click', () => {
        if (!picked.length) return;
        progress = {
          startedAt: new Date().toISOString(),
          subjects: picked.slice(),
          order: buildOrder(picked),
          answers: {},
          index: 0
        };
        saveProgress();
        showQuestion(0);
      });

      show(el('div', { class: 'card stack' },
        el('h2', { text: '요즘 공부하기 어려운 과목은?', tabindex: '-1', 'data-autofocus': true }),
        el('p', { class: 'muted', text: '1~2개를 골라 줘. 고른 과목에서 막히는 점을 조금 더 물어볼게.' }),
        el('div', { class: 'row', role: 'group', 'aria-label': '과목' }, chips),
        count,
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn', text: '이전', onClick: showIntro }),
          nextBtn
        )
      ));
    }

    // --- 문항 ---
    function answer(i, value, autoNext) {
      progress.answers[progress.order[i]] = value;
      progress.index = i;
      saveProgress();
      if (autoNext) {
        clearTimeout(timer);
        timer = setTimeout(() => goNext(i), AUTO_NEXT_MS);
      }
    }

    function goNext(i) {
      const next = i + 1;
      if (next >= progress.order.length) {
        progress.index = progress.order.length;
        saveProgress();
        doFinish();
        return;
      }
      progress.index = next;
      saveProgress();
      showQuestion(next);
    }

    function goPrev(i) {
      if (i <= 0) return;
      progress.index = i - 1;
      saveProgress();
      showQuestion(i - 1);
    }

    function progressBar(i, total) {
      const pct = Math.round(((i + 1) / total) * 100);
      return el('div', { class: 'test-progress' },
        el('div', {
          class: 'progress', role: 'progressbar',
          'aria-valuemin': '1', 'aria-valuemax': String(total), 'aria-valuenow': String(i + 1),
          'aria-valuetext': `${total}문항 중 ${i + 1}번째`, 'aria-label': '진행'
        }, el('div', { class: 'progress-fill', style: { width: pct + '%' } })),
        el('span', { class: 'progress-text', text: `${i + 1} / ${total}` })
      );
    }

    function setPressed(buttons, pressed) {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === pressed)));
    }

    function isTyping(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }

    function showQuestion(i) {
      if (!progress || !progress.order || i < 0 || i >= progress.order.length) { showIntro(); return; }
      const item = itemById(progress.order[i]);
      if (!item) { goNext(i); return; }
      const total = progress.order.length;
      const current = progress.answers[item.id];
      const intro = sectionIntro(progress.order, i);

      let questionText = item.text;
      if (item.format === 'forced') questionText = '둘 중 어느 쪽이 더 너에게 가까워?';
      const prefix = item.kind === 'weakness' && item.subject !== COMMON ? `[${item.subject}] ` : '';

      let answers;
      if (item.format === 'likert') {
        const btns = SM.data.likertLabels.map((label, k) => el('button', {
          type: 'button', class: 'answer-btn', 'aria-pressed': String(current === k + 1),
          onClick: (e) => { setPressed(btns, e.currentTarget); answer(i, k + 1, true); }
        }, el('span', { class: 'answer-key', text: String(k + 1) }), label));
        answers = el('div', { class: 'answer-list', role: 'group', 'aria-label': '답 고르기' }, btns);
        setKeys((e) => {
          if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= 5) { e.preventDefault(); btns[n - 1].click(); }
        });
      } else if (item.format === 'forced') {
        const btns = [['a', 'A', item.a], ['b', 'B', item.b]].map(([v, k, text]) => el('button', {
          type: 'button', class: 'answer-btn', 'aria-pressed': String(current === v),
          onClick: (e) => { setPressed(btns, e.currentTarget); answer(i, v, true); }
        }, el('span', { class: 'answer-key', text: k }), text));
        answers = el('div', { class: 'answer-list', role: 'group', 'aria-label': '답 고르기' }, btns);
        setKeys((e) => {
          if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
          const k = e.key.toLowerCase();
          // 한글 자판 상태(ㅁ=A, ㅠ=B)도 받는다.
          if (k === 'a' || k === 'ㅁ') { e.preventDefault(); btns[0].click(); }
          if (k === 'b' || k === 'ㅠ') { e.preventDefault(); btns[1].click(); }
        });
      } else {
        const chosen = Array.isArray(current) ? current.slice() : [];
        const nextBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '다음', disabled: chosen.length === 0, onClick: () => goNext(i) });
        const chips = item.options.map((o) => el('button', {
          type: 'button', class: 'chip' + (chosen.indexOf(o.key) !== -1 ? ' chip-on' : ''),
          'aria-pressed': String(chosen.indexOf(o.key) !== -1), text: o.text,
          onClick(e) {
            const at = chosen.indexOf(o.key);
            if (at === -1) chosen.push(o.key); else chosen.splice(at, 1);
            const on = at === -1;
            e.currentTarget.classList.toggle('chip-on', on);
            e.currentTarget.setAttribute('aria-pressed', String(on));
            nextBtn.disabled = chosen.length === 0;
            if (chosen.length) answer(i, ['V', 'A', 'R', 'K'].filter((k) => chosen.indexOf(k) !== -1), false);
            else { delete progress.answers[item.id]; saveProgress(); }
          }
        }));
        answers = el('div', { class: 'stack' },
          el('p', { class: 'muted', text: '해당하는 걸 모두 골라 줘.' }),
          el('div', { class: 'chip-row', role: 'group', 'aria-label': '답 고르기(여러 개)' }, chips),
          el('div', { class: 'row' }, nextBtn)
        );
      }

      show(
        progressBar(i, total),
        intro ? el('div', { class: 'card area-intro' }, el('p', { text: intro })) : null,
        el('div', { class: 'stack' },
          botBubble(prefix + questionText, { tabindex: '-1', 'data-autofocus': true, id: 'q-text' }),
          answers
        ),
        el('div', { class: 'row test-nav' },
          el('button', { type: 'button', class: 'btn', text: '이전', disabled: i === 0, onClick: () => goPrev(i) }),
          el('span', { class: 'muted', text: item.format === 'likert' ? '숫자키 1~5로도 답할 수 있어' : item.format === 'forced' ? 'A·B 키로도 답할 수 있어' : '' })
        )
      );
    }

    showIntro();

    return {
      node: root,
      cleanup() {
        clearTimeout(timer);
        setKeys(null);
      }
    };
  }

  // =====================================================================
  // 결과 화면 #/result
  // =====================================================================

  const DISCLAIMER = '스타일은 능력이 아니라 선호야. 연구에 따르면 스타일에만 맞추는 것보다, 효과가 확인된 전략을 내 방식으로 쓰는 게 중요해.';

  const KOLB_NAMES = {
    diverging: '직접 겪기 + 지켜보며 생각하기 쪽',
    assimilating: '논리로 따지기 + 지켜보며 생각하기 쪽',
    converging: '논리로 따지기 + 바로 써 보기 쪽',
    accommodating: '직접 겪기 + 바로 써 보기 쪽'
  };

  function signed(n) { return n > 0 ? '+' + n : String(n); }

  function shortDate(iso) {
    try { return SM.date.formatKorean(iso).replace(/\s*\(.\)$/, ''); } catch (e) { return String(iso || ''); }
  }

  function compareLabel(prev, latest) {
    let days = null;
    try { days = SM.date.daysBetween(prev.takenAt, latest.takenAt); } catch (e) { /* 무시 */ }
    if (days !== null && days >= 7) return `${Math.round(days / 7)}주 전과 비교`;
    return '지난 검사와 비교';
  }

  /** '2026-11-13' → '11월 13일' */
  function monthDay(iso) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${+m[1]}월 ${+m[2]}일` : String(iso || '');
  }

  /** #/result?id=… 의 id */
  function viewId() {
    const m = /[?&]id=([^&]+)/.exec(String(location.hash || ''));
    try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }

  /** 결과 화면 위 하위 탭(이번 결과 | 결과 기록) */
  function resultTabs(active) {
    const el = SM.ui.el;
    return el('nav', { class: 'tabs', 'aria-label': '진단 결과 보기' },
      [['current', '#/result', '이번 결과'], ['history', '#/result/history', '결과 기록']].map(([k, href, label]) =>
        el('a', { href, class: 'tab', text: label, 'aria-current': k === active ? 'page' : null })));
  }

  function resultScreen() {
    const el = SM.ui.el;
    const list = loadResults();
    if (!list.length) {
      return el('div', { class: 'card stack' },
        el('h2', { text: '아직 검사 결과가 없어' }),
        el('p', { text: '10분 정도면 나의 공부 선호를 볼 수 있어.' }),
        el('a', { href: '#/test', class: 'btn btn-primary', text: '진단 시작하기' })
      );
    }
    // ?id=로 지난 결과를 열면 읽기 전용(버튼·재검사 안내 없음)
    const wanted = viewId();
    const found = wanted ? list.findIndex((r) => r && r.id === wanted) : -1;
    const idx = found !== -1 ? found : list.length - 1;
    const readOnly = idx !== list.length - 1;
    const latest = list[idx];
    const prev = idx > 0 ? list[idx - 1] : null;
    const dims = dimMap();
    const styles = latest.styles || {};

    // 1. 한 줄 요약
    const summaryCard = el('div', { class: 'card stack result-summary' },
      el('h2', { text: readOnly ? `${monthDay(latest.takenAt)} 결과` : '나의 학습 스타일', tabindex: '-1' }),
      readOnly ? el('p', { class: 'muted', text: '지난 결과라 읽기만 할 수 있어.' }) : null,
      el('p', { class: 'summary-line', text: summary(latest) }),
      readOnly
        ? el('a', { href: '#/result/history', class: 'btn', text: '결과 기록으로 돌아가기' })
        : list.length > 1
          ? el('a', { href: '#/result/history?compare=1', class: 'btn btn-primary', text: '지난번과 비교해 볼래?' })
          : null
    );

    // 2. 스펙트럼
    function spectrum(dimId) {
      const d = dims[dimId];
      const s = styles[dimId];
      const ps = prev && prev.styles ? prev.styles[dimId] : null;
      const pos = (v) => ((v + 100) / 2) + '%';
      const side = sideOf(d, s);
      const reading = s === null || s === undefined
        ? '응답 없음'
        : `${side ? side.lean : '양쪽이 비슷한 편'} · ${bandText(dimId, s)} (${signed(s)})`;
      const prevText = ps !== null && ps !== undefined ? ` · 지난번 ${signed(ps)}` : '';
      return el('details', { class: 'spectrum' },
        el('summary', null,
          el('div', { class: 'spec-ends' },
            el('span', { text: d.left.name }),
            el('span', { text: d.right.name })
          ),
          el('div', { class: 'spec-track', 'aria-hidden': 'true' },
            el('div', { class: 'spec-balance' }),
            ps !== null && ps !== undefined ? el('div', { class: 'spec-marker spec-prev', style: { left: pos(ps) } }) : null,
            s !== null && s !== undefined ? el('div', { class: 'spec-marker', style: { left: pos(s) } }) : null
          ),
          el('p', { class: 'spec-reading' }, reading + prevText, el('span', { class: 'spec-more', text: ' · 자세히' })),
          d.note ? el('p', { class: 'muted spec-note', text: d.note }) : null
        ),
        el('div', { class: 'spec-detail' },
          [d.left, d.right].map((pole) => el('div', { class: 'stack' },
            el('strong', { text: `${pole.name}: ${pole.lean}` }),
            el('p', { text: pole.desc }),
            el('p', { class: 'muted', text: '이렇게 해 봐: ' + pole.studyTip })
          ))
        )
      );
    }

    const spectrumCards = [1, 2, 3].map((area) => {
      const ids = SPECTRUM_DIMS.filter((id) => dims[id].area === area);
      if (!ids.length) return null;
      return el('section', { class: 'card stack' },
        el('h3', { text: `${'①②③④⑤'[area - 1]} ${SM.data.styleAreas[area]}` }),
        ids.map(spectrum)
      );
    });

    const legend = el('p', { class: 'muted legend' },
      el('span', { class: 'legend-box legend-balance', 'aria-hidden': 'true' }), ' 가운데 연한 칸: 균형(−20~+20)',
      prev ? el('span', null, '  ', el('span', { class: 'legend-dot legend-prev', 'aria-hidden': 'true' }), ` 흐린 표시: ${compareLabel(prev, latest)}`) : null
    );

    // 3. VARK
    const vark = latest.vark || { counts: { V: 0, A: 0, R: 0, K: 0 }, preferred: [] };
    const maxV = SM.data.styleQuestions.filter((q) => q.dim === 'vark').length;
    const channels = dims.vark.channels;
    const varkCard = el('section', { class: 'card stack' },
      el('h3', { text: '정보를 받아들이는 채널' }),
      ['V', 'A', 'R', 'K'].map((k) => {
        const on = vark.preferred.indexOf(k) !== -1;
        return el('div', { class: 'bar-row' + (on ? ' bar-on' : '') },
          el('span', { class: 'bar-label', text: `${channels[k].name} ${vark.counts[k]}/${maxV}${on ? ' · 선호' : ''}` }),
          el('div', { class: 'bar-track', 'aria-hidden': 'true' },
            el('div', { class: 'bar-fill', style: { width: (vark.counts[k] / maxV * 100) + '%' } }))
        );
      }),
      el('p', { class: 'muted', text: dims.vark.note })
    );

    // Kolb 2×2
    const kolb = latest.kolb || {};
    const kx = kolb.process, ky = kolb.perceive;
    let kolbText = '응답이 부족해.';
    if (kolb.type === 'balanced') kolbText = '두 축 모두 균형에 가까워. 상황에 맞게 여러 방식을 쓰는 편이야.';
    else if (kolb.type) kolbText = `${sideOf(dims.kolbPerceive, ky || 1).lean}, ${sideOf(dims.kolbProcess, kx || 1).lean}이야. (${KOLB_NAMES[kolb.type]})`;
    const kolbCard = el('section', { class: 'card stack' },
      el('h3', { text: '경험에서 배우는 방식' }),
      el('div', { class: 'kolb-wrap' },
        el('span', { class: 'kolb-axis kolb-top', text: '직접 겪기(구체적 경험)' }),
        el('div', { class: 'kolb-grid', role: 'img', 'aria-label': `가로 ${signed(kx || 0)}, 세로 ${signed(ky || 0)}. ${kolbText}` },
          el('div', { class: 'kolb-balance' }),
          (kx !== null && kx !== undefined && ky !== null && ky !== undefined)
            ? el('div', { class: 'kolb-dot', style: { left: ((kx + 100) / 2) + '%', top: ((ky + 100) / 2) + '%' } })
            : null
        ),
        el('span', { class: 'kolb-axis kolb-bottom', text: '논리로 따지기(추상적 개념)' }),
        el('div', { class: 'kolb-x' }, el('span', { text: '← 지켜보며 생각하기(성찰적 관찰)' }), el('span', { text: '바로 써 보기(능동적 실험) →' }))
      ),
      el('p', { text: kolbText })
    );

    // 4. 취약 과목
    const weakCard = el('section', { class: 'card stack' },
      el('h3', { text: '과목에서 막히는 점' }),
      (latest.weakness || []).map((w) => w.codes.length
        ? el('ul', { class: 'weak-list' }, w.codes.map((c) => el('li', { text: `${w.subject} — ${SM.data.weaknessLabels[c]}` })))
        : el('p', { text: `${w.subject} — 크게 막히는 점은 없다고 답했어.` })),
      latest.anxiety ? el('p', { class: 'anxiety', text: '시험 긴장도 함께 다뤄 볼게.' }) : null
    );

    // ④·⑤ 심화
    let extCards = [];
    const ext = latest.extended;
    if (ext) {
      const parts = dims.approach.parts;
      const goals = dims.goal.parts;
      const chronoDim = dims.chrono;
      const nowBadge = () => el('p', { class: 'now-badge', text: '지금 상태 — 상황에 따라 달라져' });
      extCards = [
        el('section', { class: 'card stack' },
          el('h3', { text: `④ ${SM.data.styleAreas[4]}` }),
          nowBadge(),
          ['deep', 'surface', 'achieving'].map((k) => el('div', { class: 'bar-row' },
            el('span', { class: 'bar-label', text: `${parts[k].name} ${ext.approach[k] === null ? '-' : ext.approach[k]}/100` }),
            el('div', { class: 'bar-track', 'aria-hidden': 'true' },
              el('div', { class: 'bar-fill', style: { width: (ext.approach[k] || 0) + '%' } })),
            el('span', { class: 'muted', text: parts[k].studyTip })
          )),
          el('h4', { text: '공부할 때의 마음' }),
          Object.keys(goals).map((k) => el('div', { class: 'bar-row' },
            el('span', { class: 'bar-label', text: `${goals[k].lean} ${ext.goal[k] === null ? '-' : ext.goal[k]}/5` }),
            el('div', { class: 'bar-track', 'aria-hidden': 'true' },
              el('div', { class: 'bar-fill', style: { width: ((ext.goal[k] || 0) / 5 * 100) + '%' } }))
          ))
        ),
        el('section', { class: 'card stack' },
          el('h3', { text: `⑤ ${SM.data.styleAreas[5]}` }),
          nowBadge(),
          el('p', {
            text: ext.chrono === 'balanced' ? '아침과 저녁 어느 쪽으로도 크게 치우치지 않아.'
              : ext.chrono ? `${(ext.chrono === 'morning' ? chronoDim.left : chronoDim.right).lean}이야. ${(ext.chrono === 'morning' ? chronoDim.left : chronoDim.right).studyTip}`
                : '응답이 부족해.'
          })
        )
      ];
    }

    // 5. 고지, 6. 버튼
    const disclaimer = el('p', { class: 'card disclaimer', text: DISCLAIMER });
    const buttons = el('div', { class: 'stack' },
      el('a', { href: '#/strategy', class: 'btn btn-primary', text: '내 학습 스타일을 보완하기 위한 전략은?' }),
      el('a', { href: '#/test/deep', class: 'btn', text: ext ? '심화 검사 다시 하기(12문항)' : '더 알아보기(심화 검사 12문항)' })
    );

    // 재검사
    let days = 0;
    try { days = SM.date.daysBetween(latest.takenAt, SM.date.today()); } catch (e) { days = 0; }
    const due = days >= RETEST_DAYS;
    const retest = el('div', { class: 'card stack retest' + (due ? ' retest-due' : '') },
      el('p', { text: `마지막 검사: ${shortDate(latest.takenAt)}` }),
      due ? el('p', { text: '4주가 지났어. 지금의 나는 어떤지 다시 볼까?' }) : null,
      el('a', { href: '#/test', class: due ? 'btn btn-primary' : 'btn', text: '다시 검사하기' })
    );

    return el('div', { class: 'stack result' },
      resultTabs(readOnly ? 'history' : 'current'),
      summaryCard, legend, spectrumCards, varkCard, kolbCard, weakCard, extCards, disclaimer,
      readOnly ? null : buttons, readOnly ? null : retest
    );
  }

  SM.test = {
    buildOrder, buildDeepOrder, shuffle, resumeIndex, isAnswered, itemById, sectionIntro,
    finish, finishDeep, summary, monthDay, resultTabs, AREA_INTRO, DISCLAIMER, RETEST_DAYS
  };

  if (typeof SM.route === 'function') {
    SM.route('#/test', { title: '학습 스타일 진단', render: testScreen });
    SM.route('#/test/:mode(deep)', { title: '심화 검사', tab: 'test', render: testScreen });
    SM.route('#/result', { title: '진단 결과', tab: 'test', render: resultScreen });
  }
})(window.SM = window.SM || {});
