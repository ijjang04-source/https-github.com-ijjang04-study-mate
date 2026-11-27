// node tests/run.js — 외부 패키지 없이 vm으로 js/ 파일과 tests/*.test.js를 실행한다.
(function () {
  'use strict';

  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const ROOT = path.resolve(__dirname, '..');

  function memoryStorage() {
    const map = new Map();
    return {
      get length() { return map.size; },
      key(i) { return Array.from(map.keys())[i] ?? null; },
      getItem(k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(String(k), String(v)); },
      removeItem(k) { map.delete(String(k)); },
      clear() { map.clear(); }
    };
  }

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder,
    crypto: require('crypto').webcrypto,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    location: { hash: '' }
  };
  sandbox.window = sandbox; // 컨텍스트 안에서 window === globalThis
  // 소스 검사용(읽기 전용). 브라우저 러너에는 없으므로 그 테스트는 node에서만 돈다.
  sandbox.SMTestFS = {
    list(exts) {
      const out = [];
      (function walk(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
          if (d.name === '.git' || d.name === 'node_modules') return;
          const p = path.join(dir, d.name);
          if (d.isDirectory()) walk(p);
          else if (exts.some((x) => d.name.endsWith(x))) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
        });
      })(ROOT);
      return out;
    },
    read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  };
  vm.createContext(sandbox);

  function load(rel) {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }

  // index.html과 같은 순서로 로드
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = Array.from(html.matchAll(/<script\s+src="([^"]+)"/g), (m) => m[1]);
  let warnings = 0;
  for (const src of scripts) {
    try {
      load(src);
    } catch (e) {
      warnings++;
      console.warn('[경고] ' + src + ' 로드 실패(DOM 필요?): ' + (e && e.message));
    }
  }

  load('tests/assert.js');
  load('tests/seed.js'); // 성능 점검용 가짜 데이터 생성기(SM.seed)

  const testFiles = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
  let loadFailures = 0;
  for (const f of testFiles) {
    try {
      load(path.join('tests', f));
    } catch (e) {
      loadFailures++;
      console.log('✗ ' + f + ' 로드 실패: ' + (e && e.message));
    }
  }

  sandbox.SMTest.runAll((r) => {
    if (r.ok) console.log('✓ ' + r.name);
    else console.log('✗ ' + r.name + '\n    ' + (r.error && r.error.message));
  }).then(({ passed, failed }) => {
    failed += loadFailures;
    console.log('\n테스트 파일 ' + testFiles.length + '개 · 통과 ' + passed + ' · 실패 ' + failed +
      (warnings ? ' · 로드 경고 ' + warnings : ''));
    process.exitCode = failed > 0 ? 1 : 0;
  });
})();
