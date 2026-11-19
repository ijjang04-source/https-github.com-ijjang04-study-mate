(function (SM) {
  'use strict';

  test('ui.debounce: 연속 호출은 마지막 한 번만 실행', () => new Promise((resolve, reject) => {
    const calls = [];
    const f = SM.ui.debounce((x) => calls.push(x), 20);
    f(1); f(2); f(3);
    setTimeout(() => {
      try { assert.deepEqual(calls, [3]); resolve(); } catch (e) { reject(e); }
    }, 60);
  }));

  test('ui.debounce: cancel하면 실행되지 않음', () => new Promise((resolve, reject) => {
    let called = false;
    const f = SM.ui.debounce(() => { called = true; }, 10);
    f(); f.cancel();
    setTimeout(() => {
      try { assert.equal(called, false); resolve(); } catch (e) { reject(e); }
    }, 40);
  }));

  // DOM이 있는 환경(tests.html)에서만 el 검사
  if (typeof document !== 'undefined') {
    test('ui.el: text·문자열 자식은 HTML로 해석되지 않음', () => {
      const node = SM.ui.el('p', { text: '<b>x</b>', class: 'muted', 'aria-label': '설명' }, '<i>y</i>');
      assert.equal(node.querySelector('b'), null);
      assert.equal(node.querySelector('i'), null);
      assert.equal(node.textContent, '<b>x</b><i>y</i>');
      assert.equal(node.className, 'muted');
      assert.equal(node.getAttribute('aria-label'), '설명');
    });

    test('ui.el: innerHTML 속성은 거부', () => {
      assert.throws(() => SM.ui.el('div', { innerHTML: '<b>x</b>' }));
    });
  }
})(window.SM);
