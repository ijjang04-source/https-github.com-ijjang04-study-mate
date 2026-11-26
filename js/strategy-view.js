(function (SM) {
  'use strict';

  // 기능 2 화면: #/strategy '내 학습 스타일을 보완하기 위한 전략은?'
  //
  // plan 키 형식
  // { strategies: { 과목: [id, id, id] }, habits: [habitId], updatedAt, basedOn,
  //   confirmed, swaps: { 과목: [{ from, to, at }] }, plannerQueue: [{ subject, id, addedAt }], announced }
  // 선택·교체는 바로 자동 저장하고, '이 전략으로 할게'는 confirmed만 켠다.

  const TITLE = '내 학습 스타일을 보완하기 위한 전략은?';

  const EVIDENCE_TEXT = { 1: '낮음', 2: '중간', 2.5: '중간~높음', 3: '높음' };
  const EVIDENCE_STARS = { 1: '★☆☆', 2: '★★☆', 2.5: '★★☆', 3: '★★★' };

  function me() { return SM.auth.current(); }

  function latestResult() {
    const p = me();
    const list = p ? SM.store.get(SM.keys.results(p.sid), []) : [];
    return Array.isArray(list) && list.length ? { list, latest: list[list.length - 1] } : null;
  }

  /** 결과가 바뀌었는지 판단할 식별자(결과 id 기준이라 지난 기록을 지워도 그대로) */
  function resultId(list) {
    return SM.schema3.resultKey(list);
  }

  function freshPlan(latest) {
    const strategies = {};
    (latest.subjects || []).forEach((s) => {
      strategies[s] = SM.recommend.forSubject(latest, s).map((x) => x.id);
    });
    return { strategies, habits: SM.recommend.habits(latest).map((h) => h.id) };
  }

  // 받침: 없으면 0, 한글이 아니면 -1(ㄹ = 8)
  function batchim(w) {
    const t = String(w || '');
    const c = t.charCodeAt(t.length - 1) - 0xac00;
    return c >= 0 && c <= 11171 ? c % 28 : -1;
  }
  const eunNeun = (w) => (batchim(w) > 0 ? '은' : '는');
  const euroRo = (w) => { const b = batchim(w); return b > 0 && b !== 8 ? '으로' : '로'; };

  function sameStrategies(a, b) {
    return JSON.stringify(a.strategies) === JSON.stringify(b.strategies);
  }

  /**
   * 전략 설명 카드(10단계). 다른 화면(피드)에서도 쓴다.
   * latest: 내 최근 진단 결과(없으면 개인 맞춤 부분을 뺀다), opts: { rank: 번호|null, actions: 노드|null, chosen: 고른 카드면 true }
   */
  function buildStrategyCard(latest, subject, sid, opts) {
    const el = SM.ui.el;
    const o = opts || {};
    const idx = typeof o.rank === 'number' ? o.rank : null;
    const s = SM.data.strategies.find((x) => x.id === sid);
    const info = (latest && SM.recommend.explain(latest, subject, sid)) || { reasons: [], pole: null };
    const pole = latest ? SM.recommend.cardPole(latest, info.pole) : null;
    const way = pole ? SM.data.styleWays[pole] : null;
    const env = latest ? SM.recommend.environment(latest) : { lines: ['편한 곳 아무 데나 괜찮아.'] };
    const evText = EVIDENCE_TEXT[s.evidence];

    const wayText = way ? (s.category === 'D' ? way.retrieval : way.understand) : null;
    const placeLines = way && (way.place || way.with)
      ? [way.place ? `추천 장소: ${way.place}` : null, way.with ? `방식: ${way.with}` : null].filter(Boolean)
      : env.lines;

    return el('article', { class: 'card stack strategy-card' + (o.chosen ? ' is-chosen' : '') },
      el('div', { class: 'strategy-head' },
        idx !== null ? el('span', { class: 'rank-badge', text: `${idx + 1}` }) : null,
        el('h3', { text: s.name }),
        o.chosen ? el('span', { class: 'chosen-badge', text: '✓ 선택됨' }) : null,
        el('span', { class: 'tag', text: `${s.category} ${SM.data.strategyCategories[s.category]}` }),
        el('span', { class: 'evidence', 'aria-label': `근거 수준 ${evText}` },
          el('span', { 'aria-hidden': 'true', text: EVIDENCE_STARS[s.evidence] + ' ' }), `근거 ${evText}`)
      ),
      el('section', null,
        el('h4', { text: latest ? '왜 나에게?' : '어떤 전략이야?' }),
        info.reasons.length ? el('ul', null, info.reasons.map((r) => el('li', { text: r }))) : null,
        el('p', { class: 'muted', text: s.why })
      ),
      el('section', null,
        el('h4', { text: '하는 법' }),
        el('ol', null, s.howTo.map((h) => el('li', { text: h })))
      ),
      wayText ? el('section', null,
        el('h4', { text: '내 스타일로 하는 법' }),
        el('p', { class: 'muted', text: `(${SM.recommend.poleLean(pole)})` }),
        el('p', { text: wayText })
      ) : el('section', null,
        el('h4', { text: '내 스타일로 하는 법' }),
        el('p', { text: latest ? '여러 방식을 고르게 쓰는 편이라 기본 방법대로 하면 돼.' : '진단을 하면 내 스타일로 하는 법도 보여 줄게.' })
      ),
      way ? el('section', null, el('h4', { text: '보완할 점' }), el('p', { text: way.complement })) : null,
      el('section', null,
        el('h4', { text: '추천 장소·방식' }),
        el('ul', null, placeLines.map((l) => el('li', { text: l })))
      ),
      el('details', { class: 'source' },
        el('summary', { text: '출처' }),
        el('p', { class: 'muted', text: s.source })
      ),
      o.actions || null
    );
  }

  function strategyScreen() {
    const el = SM.ui.el;
    const profile = me();
    const found = latestResult();

    if (!found) {
      return el('div', { class: 'card stack' },
        el('h2', { text: TITLE }),
        el('p', { text: '먼저 진단을 해 볼까? 결과에 맞춰 전략을 골라 줄게.' }),
        el('a', { href: '#/test', class: 'btn btn-primary', text: '진단하러 가기' })
      );
    }

    const { list, latest } = found;
    const subjects = latest.subjects || [];
    const planKey = SM.keys.plan(profile.sid);
    const id = resultId(list);
    const fresh = freshPlan(latest);
    let plan = SM.store.get(planKey, null);
    let askChange = false;

    function save() {
      plan.updatedAt = new Date().toISOString();
      SM.store.set(planKey, plan);
    }

    if (!plan) {
      plan = Object.assign({ basedOn: id, confirmed: false, swaps: {}, plannerQueue: [] }, fresh);
      save();
    } else if (plan.basedOn !== id) {
      if (sameStrategies(plan, fresh)) {
        plan.basedOn = id;
        plan.habits = fresh.habits;
        save();
      } else {
        askChange = true;
      }
    }
    // 과목이 새로 생기거나 데이터에서 사라진 전략은 새 추천으로 채운다.
    subjects.forEach((s) => {
      const ids = (plan.strategies && plan.strategies[s]) || [];
      if (ids.length !== 3 || ids.some((x) => !SM.data.strategies.some((st) => st.id === x))) {
        plan.strategies = Object.assign({}, plan.strategies, { [s]: fresh.strategies[s] });
        save();
      }
    });

    /** 고른 전략이 추천 3개 안에 없으면(재진단·다른 전략 보기) 그 과목 선택을 비운다 → 비운 과목 목록 */
    function dropStaleChosen() {
      const gone = SM.planner.dropStaleChosen(plan);
      if (gone.length) save();
      return gone;
    }
    dropStaleChosen();

    const root = el('div', { class: 'stack strategy' });
    // #/strategy?s=수학 이면 그 과목 탭부터
    const qs = /[?&]s=([^&]+)/.exec(String(location.hash || ''));
    let wanted = null;
    try { wanted = qs ? decodeURIComponent(qs[1]) : null; } catch (e) { wanted = null; }
    let active = subjects.indexOf(wanted) !== -1 ? wanted : subjects[0];

    // ---------- 카드 ----------

    function strategyCard(subject, sid, idx) {
      const isChosen = !!(plan.chosen && plan.chosen[subject] === sid);
      return buildStrategyCard(latest, subject, sid, {
        rank: idx,
        chosen: isChosen,
        actions: el('div', { class: 'row' },
          el('button', {
            type: 'button', class: 'btn btn-primary choose-btn', 'aria-pressed': String(isChosen),
            text: '이 전략으로 할래', onClick: () => choose(subject, sid)
          }),
          el('button', { type: 'button', class: 'btn', text: '다른 전략 보기', onClick: () => swap(subject, idx) })
        )
      });
    }

    // ---------- 동작 ----------

    function swap(subject, idx) {
      const current = plan.strategies[subject].slice();
      const next = SM.recommend.alternative(latest, subject, current, idx);
      if (!next) {
        SM.ui.toast(SM.recommend.CORE.indexOf(current[idx]) !== -1
          ? '떠올리기·나눠 복습하기 전략은 하나는 꼭 남겨 둘게.'
          : '바꿀 수 있는 다른 전략이 없어.');
        return;
      }
      const from = current[idx];
      current[idx] = next;
      plan.strategies = Object.assign({}, plan.strategies, { [subject]: current });
      plan.swaps = plan.swaps || {};
      plan.swaps[subject] = (plan.swaps[subject] || []).concat([{ from, to: next, at: new Date().toISOString() }]);
      plan.confirmed = false;
      save();
      if (dropStaleChosen().length) SM.ui.toast(`고른 전략을 바꿨어. ${subject}에서 3개 중 하나를 다시 골라 줘.`);
      render();
      const card = root.querySelectorAll('.strategy-card')[idx];
      if (card) { card.setAttribute('tabindex', '-1'); card.focus(); }
    }

    /** 과목마다 하나만 고른다(라디오처럼). 고르면 플래너(이번 주·이번 달)에 넣는다. */
    let choosing = false;
    async function choose(subject, sid) {
      if (choosing) return;
      const P = SM.planner;
      const today = SM.date.today();
      const r = P.chooseStrategy(plan, subject, sid, today);
      if (!r.ok) return;
      const name = SM.data.strategies.find((x) => x.id === sid).name;
      if (!r.changed) { SM.ui.toast(`${subject}${eunNeun(subject)} 이미 '${name}'${euroRo(name)} 정했어.`); return; }
      choosing = true;
      try {
        plan.confirmed = true;
        save();
        const wayFor = (sub, id) => P.styleWayOf(latest, sub, id);
        if (r.prev) {
          // 오늘 이후 계획에 이전 전략이 있으면 물어보고 바꾼다(지나간 날·기록한 블록은 그대로)
          const n = P.replaceChosen(subject, r.prev, sid, { today, dryRun: true });
          if (n.blocks || n.weeks) {
            const yes = await SM.ui.confirmDialog(`이번 주 계획의 ${subject} 전략도 새 전략으로 바꿀까?`, { okText: '바꿀래', cancelText: '그대로 둘래' });
            if (yes) P.replaceChosen(subject, r.prev, sid, { today, wayFor });
          }
        }
        const applied = P.applyChosen(P.chosenOf(plan), today);
        if (SM.feed && typeof SM.feed.syncWeek === 'function') SM.feed.syncWeek(applied.week || SM.date.isoWeek(today));
        render();
        const btn = root.querySelector('.choose-btn[aria-pressed="true"]');
        if (btn) btn.focus();
        SM.ui.toast(`${subject}${eunNeun(subject)} '${name}'${euroRo(name)} 정했어! 플래너에 넣어 뒀어.`);
      } finally {
        choosing = false;
      }
    }

    function confirmPlan() {
      plan.confirmed = true;
      plan.habits = SM.recommend.habits(latest).map((h) => h.id);
      save();
      SM.ui.toast('좋아, 이 전략으로 해 보자!');
      if (SM.chat && typeof SM.chat.notify === 'function') SM.chat.notify('추천 전략을 저장했어. 플래너에 넣어 보자.');
      render();
    }

    // ---------- 그리기 ----------

    function render() {
      SM.ui.clear(root);
      const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': '과목' },
        subjects.map((s) => el('button', {
          type: 'button', role: 'tab', class: 'tab', id: 'tab-' + s,
          'aria-selected': String(s === active), 'aria-controls': 'panel-' + s,
          tabindex: s === active ? '0' : '-1',
          text: plan.chosen && plan.chosen[s] ? `${s} ✓` : s,
          'aria-label': plan.chosen && plan.chosen[s] ? `${s}, 전략 고름` : `${s}, 아직 안 고름`,
          onClick() { active = s; render(); const t = document.getElementById('tab-' + s); if (t) t.focus(); },
          onKeydown(e) {
            const i = subjects.indexOf(s);
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const n = subjects[(i + (e.key === 'ArrowRight' ? 1 : subjects.length - 1)) % subjects.length];
              active = n; render();
              const t = document.getElementById('tab-' + n); if (t) t.focus();
            }
          }
        }))
      );

      const ids = plan.strategies[active] || [];
      const panel = el('div', { class: 'stack', role: 'tabpanel', id: 'panel-' + active, 'aria-labelledby': 'tab-' + active },
        el('p', { class: 'muted', text: `${active}에서 해 볼 전략 3개야.` }),
        plan.chosen && plan.chosen[active]
          ? el('p', { class: 'choose-hint', role: 'status', text: `'${SM.data.strategies.find((x) => x.id === plan.chosen[active]).name}'${euroRo(SM.data.strategies.find((x) => x.id === plan.chosen[active]).name)} 하는 중이야. 다른 카드를 고르면 바꿀 수 있어.` })
          : el('p', { class: 'choose-hint choose-hint-todo', role: 'status', text: '3개 중 하나를 골라 줘.' }),
        ids.map((sid, i) => strategyCard(active, sid, i))
      );

      const habitList = SM.recommend.habits(latest);
      const habitsCard = el('section', { class: 'card stack' },
        el('h3', { text: '내 스타일 보완 습관' }),
        habitList.length
          ? habitList.map((h) => el('div', { class: 'habit' },
            el('strong', { text: h.name }),
            el('p', { text: h.howTo }),
            el('p', { class: 'muted', text: `점검: ${h.checkQuestion}` })
          ))
          : el('p', { text: '여러 방식을 고르게 쓰는 편이라 따로 보완할 습관은 없어. 지금처럼 해 봐!' })
      );

      [
        el('h2', { text: TITLE, tabindex: '-1' }),
        subjects.length > 1 ? tabs : null,
        panel,
        habitsCard,
        el('div', { class: 'stack' },
          el('button', {
            type: 'button', class: plan.confirmed ? 'btn' : 'btn btn-primary',
            text: plan.confirmed ? '✓ 이 전략으로 하는 중' : '이 전략으로 할게',
            onClick: confirmPlan
          }),
          el('a', { href: '#/strategy/seven', class: 'btn', text: '나만의 한 가지 전략 만들기' })
        )
      ].forEach((n) => { if (n) root.appendChild(n); });
    }

    render();

    // 챗봇에 한 번 남겨 두기(결과마다 한 번)
    if (plan.announced !== id && SM.chat && typeof SM.chat.say === 'function') {
      SM.chat.say(`${subjects.join('·')} 전략을 ${subjects.length > 1 ? '3개씩' : '3개'} 골랐어. 하나씩 볼까?`);
      plan.announced = id;
      save();
    }

    // 재검사로 추천이 바뀌었으면 확인
    if (askChange) {
      setTimeout(async () => {
        const yes = await SM.ui.confirmDialog('추천이 바뀌었어. 새 전략으로 바꿀까?', { okText: '바꿀래', cancelText: '그대로 둘래' });
        let gone = [];
        if (yes) {
          plan = Object.assign({}, plan, fresh, { basedOn: id, confirmed: false, swaps: {} });
          // 새 추천 3개에 없는 예전 선택은 비운다(과목마다 3개 중 하나)
          gone = SM.planner.dropStaleChosen(plan);
        } else {
          plan.basedOn = id;
        }
        save();
        render();
        if (gone.length) SM.ui.toast(`추천이 바뀌어서 ${gone.join('·')} 전략을 다시 골라 줘.`);
      }, 0);
    }

    return root;
  }

  // =====================================================================
  // #/strategy/seven 나만의 한 가지 전략(경로는 예전 그대로 둔다)
  // plan.myRule = { text, situation, action, subject, strategyId, updatedAt }
  // plan.myRuleHistory = [예전 myRule…] (바꾸기 전 문장)
  // 자동 저장: 이 화면을 열 때의 문장과 달라지면 그 문장을 기록에 한 번 남긴다.
  // =====================================================================

  const RULE_TITLE = '나만의 한 가지 전략';
  const RULE_INTRO = '언제(상황) + 무엇을(행동)이 들어간 한 문장을 매일 지켜 보자.';

  function strategyNameOf(id) {
    const s = SM.data.strategies.find((x) => x.id === id);
    return s ? s.name : '';
  }

  function dayText(iso) {
    try { return SM.date.formatKorean(String(iso).slice(0, 10)); } catch (e) { return ''; }
  }

  function historyEl(plan) {
    const el = SM.ui.el;
    const list = (Array.isArray(plan.myRuleHistory) ? plan.myRuleHistory : []).filter((r) => r && String(r.text || '').trim());
    if (!list.length) return null;
    return el('details', { class: 'card rule-history' },
      el('summary', { text: `이전 문장 (${list.length})` }),
      el('ol', { class: 'stack', reversed: true }, list.slice().reverse().map((r) => el('li', null,
        el('p', { text: r.text }),
        r.updatedAt ? el('p', { class: 'muted', text: `${dayText(r.updatedAt)}에 정함` }) : null
      )))
    );
  }

  function myRuleScreen() {
    const el = SM.ui.el;
    const profile = me();
    const found = latestResult();
    const head = (...extra) => el('div', { class: 'card stack' },
      el('h2', { text: RULE_TITLE, tabindex: '-1' }),
      el('p', { text: RULE_INTRO }),
      ...extra);
    if (!found) {
      return head(
        el('p', { text: '먼저 진단을 해 볼까? 결과에 맞춰 상황과 행동 초안을 만들어 줄게.' }),
        el('a', { href: '#/test', class: 'btn btn-primary', text: '진단하러 가기' }));
    }
    const { latest } = found;
    const planKey = SM.keys.plan(profile.sid);
    const plan = SM.store.get(planKey, null) || {};
    const base = plan.myRule && String(plan.myRule.text || '').trim() ? plan.myRule : null;
    const options = SM.recommend.ruleStrategyOptions(plan);

    if (!options.length) {
      return el('div', { class: 'stack' },
        head(
          base ? el('p', { class: 'rule-big', text: base.text }) : null,
          el('p', { text: '전략 탭에서 과목마다 전략을 하나 고르면, 그 전략으로 문장을 만들 수 있어.' }),
          el('a', { href: '#/strategy', class: 'btn btn-primary', text: '전략 고르러 가기' })),
        historyEl(plan));
    }

    // ---------- 상태 ----------
    const situations = SM.recommend.ruleSituations(latest);
    let pick = (base && options.find((o) => o.strategyId === base.strategyId && (!base.subject || o.subject === base.subject))) || options[0];
    let situation = base && base.situation ? base.situation : situations[0].text;
    let custom = !situations.some((s) => s.text === situation);
    let action = base && base.action ? base.action : SM.recommend.ruleActionDraft(pick.strategyId);

    const saved = SM.ui.savedIndicator();
    const current = () => SM.recommend.ruleText(situation, action);

    function persist() {
      const text = current();
      if (!text) return false;              // 상황·행동이 빠진 문장은 저장하지 않는다
      SM.store.update(planKey, (p) => SM.recommend.saveMyRule(p || {}, {
        text, situation, action, subject: pick.subject, strategyId: pick.strategyId
      }, base), {});
      saved.set('saved');
      return true;
    }
    const debouncedSave = SM.ui.debounce(persist, 500);
    function changed(now) {
      paintPreview();
      if (!current()) { debouncedSave.cancel(); return; }
      saved.set('saving');
      if (now) { debouncedSave.cancel(); persist(); } else debouncedSave();
    }

    // ---------- 3. 행동(1·2단계에서 참조하므로 먼저 만든다) ----------
    const hintText = () => `'${strategyNameOf(pick.strategyId)}' 하는 법 첫 단계로 채웠어. 내 말로 고쳐도 돼.`;
    const actionHint = el('p', { class: 'muted', text: hintText() });
    const actionInput = el('textarea', {
      id: 'rule-action', rows: 2, maxlength: 80,
      onInput(e) { action = e.target.value; changed(false); }
    });
    actionInput.value = action;

    // ---------- 1. 전략 ----------
    const stratBox = el('div', { class: 'stack' });
    function paintStrategy() {
      SM.ui.clear(stratBox);
      if (options.length === 1) {
        stratBox.appendChild(el('p', { text: `${pick.subject} · ${strategyNameOf(pick.strategyId)}` }));
        return;
      }
      stratBox.appendChild(el('div', { class: 'chip-row', role: 'group', 'aria-label': '전략 고르기' },
        options.map((o, i) => el('button', {
          type: 'button', class: 'chip' + (o === pick ? ' chip-on' : ''), 'aria-pressed': String(o === pick),
          text: `${o.subject} · ${strategyNameOf(o.strategyId)}`,
          onClick() {
            if (o === pick) return;
            const oldDraft = SM.recommend.ruleActionDraft(pick.strategyId);
            pick = o;
            // 학생이 고치지 않은 초안이면 새 전략의 초안으로 바꾼다
            if (!action.trim() || action === oldDraft) { action = SM.recommend.ruleActionDraft(o.strategyId); actionInput.value = action; }
            actionHint.textContent = hintText();
            paintStrategy(); changed(true);
            const btn = stratBox.querySelectorAll('button')[i];
            if (btn) btn.focus();
          }
        }))));
    }

    // ---------- 2. 상황 ----------
    const sitBox = el('div', { class: 'chip-row', role: 'group', 'aria-label': '언제(상황)' });
    const customInput = el('input', {
      type: 'text', maxlength: 40, 'aria-label': '상황 직접 쓰기', placeholder: '예) 점심 먹고 교실에 돌아오면',
      onInput(e) { situation = e.target.value; changed(false); }
    });
    const customWrap = el('div', { class: 'stack', hidden: !custom }, customInput,
      el('p', { class: 'muted', text: "'~하면'이나 '~전에'로 끝나게 써 봐." }));
    if (custom) customInput.value = situation;
    function paintSituations() {
      SM.ui.clear(sitBox);
      situations.forEach((s, i) => sitBox.appendChild(el('button', {
        type: 'button', class: 'chip' + (!custom && situation === s.text ? ' chip-on' : ''),
        'aria-pressed': String(!custom && situation === s.text), text: s.text,
        onClick() { custom = false; situation = s.text; customWrap.hidden = true; paintSituations(); changed(true); sitBox.children[i].focus(); }
      })));
      sitBox.appendChild(el('button', {
        type: 'button', class: 'chip' + (custom ? ' chip-on' : ''), 'aria-pressed': String(custom), text: '직접 쓰기',
        onClick() {
          if (!custom) { custom = true; situation = customInput.value; }
          customWrap.hidden = false; paintSituations(); changed(true); customInput.focus();
        }
      }));
    }

    // ---------- 미리보기 ----------
    const preview = el('p', { class: 'rule-big rule-preview', 'aria-live': 'polite' });
    const warn = el('p', { class: 'field-warn', 'aria-live': 'polite' });
    function paintPreview() {
      const t = current();
      preview.textContent = t || '상황과 행동을 채우면 문장이 보여.';
      preview.classList.toggle('muted', !t);
      const c = SM.recommend.checkRule(t);
      warn.textContent = !t || c.ok ? '' : c.missing === 'when'
        ? "상황이 '~하면'이나 '~전에'로 끝나야 해."
        : '무엇을(행동) 할지도 적어 줄래?';
    }

    paintStrategy();
    paintSituations();
    paintPreview();
    // 처음 들어와서 아직 문장이 없으면 초안을 바로 저장해 둔다(플래너에 바로 보이게)
    if (!base && current()) persist();

    return {
      node: el('div', { class: 'stack' },
        head(el('p', { class: 'muted', text: '예) 나는 저녁 9시가 되면 영단어 카드 20개를 떠올려 본다.' })),
        el('section', { class: 'card stack' }, el('h3', { text: '1. 어떤 전략으로?' }), stratBox),
        el('section', { class: 'card stack' }, el('h3', { text: '2. 언제(상황)' }), sitBox, customWrap),
        el('section', { class: 'card stack' }, el('h3', null, el('label', { for: 'rule-action', text: '3. 무엇을(행동)' })), actionInput, actionHint),
        el('section', { class: 'card stack rule-preview-card' },
          el('h3', { text: '미리보기' }), preview, warn,
          el('div', { class: 'row' }, saved.node),
          el('p', { class: 'muted', text: '이 문장은 플래너 위쪽, 일간 체크, 주간 점검에 보여 줄게. 언제든 바꿀 수 있어.' })),
        historyEl(plan),
        el('a', { href: '#/strategy', class: 'btn', text: '전략으로 돌아가기' })
      ),
      cleanup() {
        // 떠나기 전에 입력 중이던 내용을 바로 저장
        debouncedSave.cancel();
        persist();
      }
    };
  }

  SM.strategyView = { card: buildStrategyCard };


  if (typeof SM.route === 'function') {
    SM.route('#/strategy', { title: '맞춤 전략', render: strategyScreen });
    SM.route('#/strategy/seven', { title: '나만의 한 가지 전략', tab: 'strategy', render: myRuleScreen });
  }
})(window.SM = window.SM || {});
