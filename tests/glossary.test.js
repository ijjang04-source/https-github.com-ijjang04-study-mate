(function (SM) {
  'use strict';

  // 용어 사전과 용어 풀이 버튼

  const G = SM.data.glossary;
  const terms = Object.keys(G);

  const REQUIRED = ['자동화', '인출 연습', '분산 학습', '교차 연습', '정교화', '정교화 질문', '자기 설명', '풀이 예제 학습',
    '반박 텍스트', '이중 부호화', '개념도', '사전 시험', '메타인지', '실행 의도', 'WOOP', '하브루타', '표현적 글쓰기',
    '상보적 독해', '장 의존형', '장 독립형', '충동형', '반성형', '감각형', '직관형', '귀납형', '연역형', '능동형', '성찰형',
    '시각형', '언어형', '순차형', '총체형', 'VARK', '표층 접근', '심층 접근'];

  test('glossary: 요청한 용어가 모두 있고, 항목마다 easy·example이 있음', () => {
    REQUIRED.forEach((t) => assert.ok(G[t], '사전에 없음: ' + t));
    terms.forEach((t) => {
      assert.ok(typeof G[t].easy === 'string' && G[t].easy.trim().length > 0, 'easy 없음: ' + t);
      assert.ok(typeof G[t].example === 'string' && G[t].example.trim().length > 0, 'example 없음: ' + t);
      assert.ok(G[t].group, 'group 없음: ' + t);
    });
    assert.equal(G['자동화'].easy, '생각하지 않아도 바로 떠오를 만큼 익숙해지는 것');
  });

  test('glossary: easy는 30자 안팎(35자 이하)이고 그 안에서 다른 사전 용어를 쓰지 않음', () => {
    terms.forEach((t) => {
      const e = G[t].easy;
      assert.ok(e.length <= 35, `${t}: ${e.length}자 — ${e}`);
      terms.forEach((u) => assert.ok(e.indexOf(u) === -1, `${t}의 풀이에 '${u}'가 들어 있음`));
    });
  });

  test('glossary: 화면 데이터에 나오는 전략 용어(괄호 속 원래 이름)가 사전에 있음', () => {
    // 전략 이름은 "쉬운 말(원래 용어)" 꼴. 원래 용어 안의 사전 용어가 하나는 있어야 누르면 풀이가 나온다.
    SM.data.strategies.filter((s) => s.term).forEach((s) => {
      assert.ok(s.name.indexOf('(' + s.term + ')') !== -1, `${s.id}: 이름에 (${s.term})이 없음`);
      assert.ok(terms.some((t) => s.term.indexOf(t) !== -1 || t.indexOf(s.term) !== -1)
        || ['멘토링·협동 학습', '강의하기·언어화', '노력 조절', '핵심 단어법'].indexOf(s.term) !== -1, `${s.id}: ${s.term} 풀이 없음`);
    });
  });

  test("glossary: 옛 문구('자동화'+' 분량')가 코드·문서 어디에도 없음", () => {
    if (typeof SMTestFS === 'undefined') return; // 브라우저 러너에서는 건너뜀
    const banned = '자동화' + ' 분량';
    const hits = SMTestFS.list(['.js', '.html', '.css', '.md', '.json'])
      .filter((f) => SMTestFS.read(f).replace(/\s+/g, ' ').indexOf(banned) !== -1);
    assert.deepEqual(hits, []);
  });

  test('glossary: 쪼개기 — 카드마다 처음 한 번, 긴 용어 우선, 글자는 그대로', () => {
    const order = Object.keys(G).sort((a, b) => b.length - a.length);
    const used = new Set();
    const parts = SM.ui.glossSplit('정교화 질문을 하고, 정교화도 하고, 정교화 질문을 또 해.', order, used);
    assert.deepEqual(parts, [{ term: '정교화 질문' }, { text: '을 하고, 정교화도 하고, 정교화 질문을 또 해.' }],
      '같은 카드에서 두 번째부터는 밑줄 없음, 짧은 용어도 이미 쓴 것으로');
    assert.deepEqual(SM.ui.glossSplit('인출 연습 뒤에 시각형', order, used), [{ term: '인출 연습' }, { text: ' 뒤에 ' }, { term: '시각형' }]);
    assert.deepEqual(SM.ui.glossSplit('인출 연습', order, used), [{ text: '인출 연습' }], '같은 used(같은 카드)면 다시 안 붙임');
    assert.deepEqual(SM.ui.glossSplit('용어 없음', order, new Set()), [{ text: '용어 없음' }]);
  });

  test('glossary: 사용자 입력처럼 꺾쇠가 든 글도 조각은 글자 그대로(HTML로 해석할 여지 없음)', () => {
    const order = Object.keys(G);
    const evil = '<img src=x onerror=alert(1)>인출 연습<b>굵게</b>';
    const parts = SM.ui.glossSplit(evil, order, new Set());
    assert.equal(parts.map((p) => p.text !== undefined ? p.text : p.term).join(''), evil, '조각을 이으면 원문과 같음');
    assert.deepEqual(parts[1], { term: '인출 연습' });
  });

  test('glossary: 용어 표시 코드에 innerHTML·outerHTML·insertAdjacentHTML이 없음', () => {
    if (typeof SMTestFS === 'undefined') return;
    const src = SMTestFS.read('js/ui.js');
    const a = src.indexOf('// --- gloss: 용어 풀이 (시작) ---');
    const b = src.indexOf('// --- gloss: 용어 풀이 (끝) ---');
    assert.ok(a !== -1 && b > a, '표시 코드 구간을 찾음');
    const body = src.slice(a, b);
    ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment'].forEach((w) =>
      assert.ok(body.indexOf(w) === -1, w + ' 사용'));
    ['js/data/glossary.js'].forEach((f) => assert.ok(SMTestFS.read(f).indexOf('innerHTML') === -1, f));
    assert.ok(/createTextNode/.test(body) && /el\('button'/.test(body), '텍스트 노드와 SM.ui.el로 만듦');
  });

  test('glossary: 조사는 괄호 앞의 쉬운 말에 맞춤, 챗봇은 원래 용어로도 전략을 찾음', () => {
    assert.equal(SM.chat.matchIntent('인출 연습 알려줘').strategyId, 'retrieval');
    assert.equal(SM.chat.matchIntent('교차연습 어떻게 해').strategyId, 'interleave');
    assert.equal(SM.chat.matchIntent('기억에서 꺼내 보기(인출 연습) 하는 법').strategyId, 'retrieval');
  });

  // DOM이 있는 환경(tests.html)에서만
  if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
    test('glossary(DOM): 카드마다 첫 용어에 버튼, 누르면 풀이가 열리고 다시 누르면 닫힘, 꺾쇠는 글자로', () => {
      const el = SM.ui.el;
      const root = el('div', null,
        el('section', { class: 'card' }, el('h3', { text: '기억에서 꺼내 보기(인출 연습)' }), el('p', { text: '인출 연습을 매일 해. <img src=x>' })),
        el('section', { class: 'card' }, el('p', { text: '인출 연습과 분산 학습' })),
        el('button', { type: 'button', text: '인출 연습 버튼은 그대로' }));
      document.body.appendChild(root);
      try {
        assert.equal(SM.ui.glossify(root), 3);
        assert.equal(root.querySelector('img'), null, '꺾쇠는 태그가 되지 않음');
        const cards = root.querySelectorAll('.card');
        assert.equal(cards[0].querySelectorAll('button.term').length, 1, '첫 카드는 한 번');
        assert.equal(cards[1].querySelectorAll('button.term').length, 2);
        const b = cards[0].querySelector('button.term');
        const pop = document.getElementById(b.getAttribute('aria-controls'));
        assert.deepEqual([b.getAttribute('aria-expanded'), pop.hidden], ['false', true]);
        b.click();
        assert.equal(b.getAttribute('aria-expanded'), 'true');
        assert.equal(pop.hidden, false);
        assert.ok(pop.textContent.indexOf(G['인출 연습'].easy) !== -1);
        b.click();
        assert.equal(pop.hidden, true);
        assert.equal(SM.ui.glossify(root), 0, '다시 불러도 더 붙이지 않음');
      } finally { root.remove(); }
    });

    test('glossary(DOM): 키보드 — Enter로 열고 Esc로 닫으면 포커스는 용어 버튼에, 확인창이 떠 있으면 Esc는 확인창 몫', () => new Promise((resolve, reject) => {
      const el = SM.ui.el;
      const root = el('div', null, el('p', { text: '교차 연습을 해 봐.' }));
      document.body.appendChild(root);
      const stop = SM.ui.glossWatch(root);
      try {
        const b = root.querySelector('button.term');
        const pop = document.getElementById(b.getAttribute('aria-controls'));
        assert.equal(b.tagName, 'BUTTON', '버튼이라 Tab·Enter·Space로 열 수 있음');
        b.focus(); b.click();
        assert.equal(pop.hidden, false);
        const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        esc();
        assert.deepEqual([b.getAttribute('aria-expanded'), pop.hidden, document.activeElement === b], ['false', true, true]);
        b.click();
        const modal = el('div', { role: 'alertdialog' });
        document.body.appendChild(modal);
        esc();
        assert.equal(pop.hidden, false, '확인창이 있으면 풀이는 그대로');
        modal.remove();
        esc();
        assert.equal(pop.hidden, true);
        // 나중에 그려진 글자에도 붙음(화면 일부 다시 그리기)
        root.appendChild(el('p', { text: '분산 학습도 있어.' }));
        setTimeout(() => {
          try {
            assert.equal(root.querySelectorAll('button.term').length, 2);
            stop(); root.remove(); resolve();
          } catch (e) { stop(); root.remove(); reject(e); }
        }, 80);
      } catch (e) { stop(); root.remove(); reject(e); }
    }));
  }
})(window.SM = window.SM || {});
