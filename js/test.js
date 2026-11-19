(function (SM) {
  'use strict';

  // 기능 1: 학습 스타일 진단(#/test). 채점·결과 화면은 8단계에서 만든다.

  const AUTO_NEXT_MS = 300;
  const MAX_SUBJECTS = 2;
  const COMMON = '공통';

  const AREA_INTRO = {
    weakness: '고른 과목에서 막히는 점부터 물어볼게!',
    1: '먼저 정보를 어떻게 처리하는지 볼게!',
    2: '이번엔 정보를 어떤 형태로 받기 좋아하는지 볼게!',
    3: '마지막으로 어떤 순서로 배우는지!'
  };

  // ---------- 문항 찾기 ----------

  let index = null;
  function buildIndex() {
    if (index) return index;
    index = {};
    const dims = {};
    SM.data.styleDims.forEach((d) => { dims[d.id] = d; });
    SM.data.styleQuestions.forEach((q) => {
      index[q.id] = Object.assign({ kind: 'style', area: dims[q.dim].area }, q);
    });
    Object.keys(SM.data.weaknessQuestions).forEach((subject) => {
      SM.data.weaknessQuestions[subject].forEach((w) => {
        index[w.id] = Object.assign({ kind: 'weakness', area: 'weakness', format: 'likert', subject }, w);
      });
    });
    return index;
  }

  /** 문항 id → { id, kind:'style'|'weakness', area, format, text, a, b, options, subject } */
  function itemById(id) {
    return buildIndex()[id] || null;
  }

  // ---------- 순수 함수(테스트 대상) ----------

  /** Fisher–Yates. rng()는 [0,1) 난수. 새 배열을 돌려준다. */
  function shuffle(list, rng) {
    const r = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 문항 순서: 고른 과목의 약점 문항(과목 순서대로) → 공통 1문항 → 기본형 영역 ①→②→③.
   * 영역 안에서만 섞는다.
   */
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

    const dims = {};
    SM.data.styleDims.forEach((d) => { dims[d.id] = d; });
    [1, 2, 3].forEach((area) => {
      const ids = SM.data.styleQuestions
        .filter((q) => q.set === 'basic' && dims[q.dim].area === area)
        .map((q) => q.id);
      shuffle(ids, rng).forEach((id) => order.push(id));
    });
    return order;
  }

  /** 응답 값이 유효한지 */
  function isAnswered(item, value) {
    if (!item || value === undefined || value === null) return false;
    if (item.format === 'likert') return Number.isInteger(value) && value >= 1 && value <= 5;
    if (item.format === 'forced') return value === 'a' || value === 'b';
    if (item.format === 'multi') {
      const keys = item.options.map((o) => o.key);
      return Array.isArray(value) && value.length > 0 && value.every((k) => keys.indexOf(k) !== -1);
    }
    return false;
  }

  /** 이어 하기 위치: 아직 답하지 않은 첫 문항. 모두 답했으면 order.length. */
  function resumeIndex(progress) {
    if (!progress || !Array.isArray(progress.order)) return 0;
    const answers = progress.answers || {};
    for (let i = 0; i < progress.order.length; i++) {
      if (!isAnswered(itemById(progress.order[i]), answers[progress.order[i]])) return i;
    }
    return progress.order.length;
  }

  /** order[i]가 새 구간(약점 시작, 영역 ①②③ 시작)의 첫 문항이면 연결 문장을 돌려준다. */
  function sectionIntro(order, i) {
    const cur = itemById(order[i]);
    if (!cur) return null;
    const prev = i > 0 ? itemById(order[i - 1]) : null;
    if (cur.kind === 'weakness') {
      return !prev || prev.kind !== 'weakness' ? AREA_INTRO.weakness : null;
    }
    return !prev || prev.area !== cur.area ? AREA_INTRO[cur.area] || null : null;
  }

  // ---------- 저장 ----------

  function progressKey() {
    const me = SM.auth.current();
    return me ? SM.keys.testProgress(me.sid) : null;
  }
  function loadProgress() {
    const key = progressKey();
    return key ? SM.store.get(key, null) : null;
  }
  function saveProgress(p) {
    const key = progressKey();
    if (key) SM.store.set(key, p);
  }

  /** 8단계에서 채점·결과 저장으로 바꾼다. */
  function finish(progress) {
    console.log('[SM.test] answers', progress && progress.answers);
    location.hash = '#/result';
  }

  // ---------- 화면 ----------

  function testScreen() {
    const el = SM.ui.el;
    const root = el('section', { class: 'test stack' });
    let progress = loadProgress();
    let timer = null;
    let keyHandler = null;

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

    // --- 시작 화면 ---
    function showIntro() {
      const done = progress && Array.isArray(progress.order) ? resumeIndex(progress) : 0;
      const hasProgress = progress && Array.isArray(progress.order) && progress.order.length > 0 &&
        Object.keys(progress.answers || {}).length > 0;

      const actions = el('div', { class: 'stack' });
      if (hasProgress && done >= progress.order.length) {
        actions.append(
          el('p', { text: '지난번에 모든 문항에 답했어. 결과를 볼까?' }),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn btn-primary', text: '결과 보기', onClick: () => SM.test.finish(progress) }),
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
        actions.append(el('button', { type: 'button', class: 'btn btn-primary', text: '시작하기', onClick: showSubjects }));
      }

      show(el('div', { class: 'card stack' },
        el('h2', { text: '나의 학습 스타일은 무엇일까?', tabindex: '-1', 'data-autofocus': true }),
        el('p', { text: '이 검사는 너의 공부 선호를 보여주는 거울이야. 좋고 나쁜 유형은 없고, 선호는 바뀔 수 있어.' }),
        el('p', { class: 'muted', text: '예상 시간 10~12분' }),
        actions
      ));
    }

    async function restart() {
      const yes = await SM.ui.confirmDialog('지금까지 한 답이 지워져. 처음부터 할까?', { okText: '처음부터', cancelText: '취소' });
      if (!yes) return;
      progress = null;
      const key = progressKey();
      if (key) SM.store.remove(key);
      showSubjects();
    }

    // --- 1. 취약 과목 선택 ---
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
        saveProgress(progress);
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

    // --- 2·3. 문항 ---
    function answer(i, value, autoNext) {
      const id = progress.order[i];
      progress.answers[id] = value;
      progress.index = i;
      saveProgress(progress);
      if (autoNext) {
        clearTimeout(timer);
        timer = setTimeout(() => goNext(i), AUTO_NEXT_MS);
      }
    }

    function goNext(i) {
      const next = i + 1;
      if (next >= progress.order.length) {
        progress.index = progress.order.length;
        saveProgress(progress);
        SM.test.finish(progress);
        return;
      }
      progress.index = next;
      saveProgress(progress);
      showQuestion(next);
    }

    function goPrev(i) {
      if (i <= 0) return;
      progress.index = i - 1;
      saveProgress(progress);
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
        const btns = [['a', 'A', item.a], ['b', 'B', item.b]].map(([v, key, text]) => el('button', {
          type: 'button', class: 'answer-btn', 'aria-pressed': String(current === v),
          onClick: (e) => { setPressed(btns, e.currentTarget); answer(i, v, true); }
        }, el('span', { class: 'answer-key', text: key }), text));
        answers = el('div', { class: 'answer-list', role: 'group', 'aria-label': '답 고르기' }, btns);
        setKeys((e) => {
          if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
          const k = e.key.toLowerCase();
          // 한글 자판 상태(ㅁ=A, ㅠ=B)도 받는다.
          if (k === 'a' || k === 'ㅁ') { e.preventDefault(); btns[0].click(); }
          if (k === 'b' || k === 'ㅠ') { e.preventDefault(); btns[1].click(); }
        });
      } else {
        // multi
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
            else { delete progress.answers[item.id]; saveProgress(progress); }
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

    function isTyping(e) {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
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

  SM.test = { buildOrder, shuffle, resumeIndex, isAnswered, itemById, sectionIntro, finish, AREA_INTRO };

  if (typeof SM.route === 'function') {
    SM.route('#/test', { title: '학습 스타일 진단', render: testScreen });
  }
})(window.SM = window.SM || {});
