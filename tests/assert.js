// 최소 assert + 테스트 등록. node(run.js)와 브라우저(tests.html)에서 함께 쓴다.
(function (root) {
  'use strict';

  function fmt(v) {
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function fail(message, extra) {
    throw new Error(message + (extra ? ' — ' + extra : ''));
  }

  function isDeepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isDeepEqual(a[k], b[k]));
  }

  const assert = {
    equal(actual, expected, msg) {
      if (!Object.is(actual, expected)) {
        fail(msg || '값이 다름', '기대 ' + fmt(expected) + ', 실제 ' + fmt(actual));
      }
    },
    deepEqual(actual, expected, msg) {
      if (!isDeepEqual(actual, expected)) {
        fail(msg || '구조가 다름', '기대 ' + fmt(expected) + ', 실제 ' + fmt(actual));
      }
    },
    ok(value, msg) {
      if (!value) fail(msg || '참이 아님', '실제 ' + fmt(value));
    },
    throws(fn, msg) {
      try { fn(); } catch (e) { return e; }
      fail(msg || '예외가 발생하지 않음');
    }
  };

  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  /** 등록된 테스트를 순서대로 실행. onResult({ name, ok, error }) */
  async function runAll(onResult) {
    let passed = 0, failed = 0;
    for (const t of tests) {
      try {
        await t.fn();
        passed++;
        onResult({ name: t.name, ok: true });
      } catch (e) {
        failed++;
        onResult({ name: t.name, ok: false, error: e });
      }
    }
    return { passed, failed };
  }

  root.assert = assert;
  root.test = test;
  root.SMTest = { tests, runAll };
})(typeof window !== 'undefined' ? window : globalThis);
