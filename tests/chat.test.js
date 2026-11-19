(function (SM) {
  'use strict';
  const C = SM.chat;

  test('chat: {nickname} 치환', () => {
    assert.equal(C.fill('반가워, {nickname}!', { nickname: '민트' }), '반가워, 민트!');
  });

  test('chat: 여러 자리 표시, 같은 자리 표시 반복', () => {
    assert.equal(
      C.fill('{nickname}, {subject} D-{dday}. 화이팅 {nickname}', { nickname: '민트', subject: '수학', dday: 7 }),
      '민트, 수학 D-7. 화이팅 민트'
    );
  });

  test('chat: 없는 값은 빈 문자열, 0은 그대로', () => {
    assert.equal(C.fill('D-{dday}{unknown}', { dday: 0 }), 'D-0');
    assert.equal(C.fill('{a}', {}), '');
    assert.equal(C.fill('{a}', null), '');
    assert.equal(C.fill(undefined, {}), '');
  });

  test('chat: 치환 값은 글자 그대로(HTML·$ 패턴 해석 안 함)', () => {
    assert.equal(C.fill('{nickname}', { nickname: '<b>x</b>' }), '<b>x</b>');
    assert.equal(C.fill('{nickname}', { nickname: '$&$1' }), '$&$1');
    assert.equal(C.fill('{nickname}', { nickname: '{subject}' }), '{subject}'); // 재귀 치환 없음
  });

  test('chat: 카드 치환, #/ 아닌 이동은 제거', () => {
    const c = C.fillCard({
      title: '{nickname}의 전략',
      lines: ['{subject} 먼저'],
      actions: [{ label: '보기', go: '#/strategy' }, { label: '나쁜 링크', go: 'javascript:alert(1)' }]
    }, { nickname: '민트', subject: '수학' });
    assert.equal(c.title, '민트의 전략');
    assert.deepEqual(c.lines, ['수학 먼저']);
    assert.deepEqual(c.actions, [{ label: '보기', go: '#/strategy' }]);
  });

  test('chat: 기록은 최근 100개만', () => {
    let list = [];
    for (let i = 1; i <= 105; i++) list = C.pushHistory(list, { n: i });
    assert.equal(list.length, 100);
    assert.equal(list[0].n, 6);
    assert.equal(list[99].n, 105);
  });

  test('chat: pushHistory는 원본을 바꾸지 않고, 잘못된 목록도 처리', () => {
    const orig = [{ n: 1 }];
    const next = C.pushHistory(orig, { n: 2 });
    assert.equal(orig.length, 1);
    assert.equal(next.length, 2);
    assert.deepEqual(C.pushHistory(null, { n: 1 }), [{ n: 1 }]);
    assert.equal(C.pushHistory([1, 2, 3], 4, 2).join(','), '3,4');
  });

  test('chat: welcome·menu 흐름 데이터', () => {
    assert.equal(SM.flows.welcome[0].say, '반가워, {nickname}!');
    const welcomeChoices = SM.flows.welcome[2].choices;
    assert.deepEqual(welcomeChoices.map((c) => c.go || c.next), ['#/test', 'menu']);
    const menuChoices = SM.flows.menu[1].choices;
    assert.deepEqual(menuChoices.map((c) => c.label), ['진단', '전략', '오늘 계획', '점검', '우리 반']);
  });
})(window.SM);
