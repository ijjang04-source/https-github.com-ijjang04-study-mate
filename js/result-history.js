(function (SM) {
  'use strict';

  // 기능 1-2: 진단 결과 기록 #/result/history
  //   SM.resultHistory  비교·흐름·약점 변화 계산(순수 함수, DOM 사용 금지)과 기록 삭제
  //   변화를 좋다·나쁘다로 평가하지 않는다. 어느 쪽으로 얼마나 움직였는지만 말한다.
  //   결과 형식: results:<sid> = [{ id, kind: 'basic'|'deep', takenAt, subjects, weakness, styles, … }] (오래된 것부터)

  const SAME = 10;   // 이보다 적게 움직이면 '거의 같아'

  function dimMap() {
    const m = {};
    SM.data.styleDims.forEach((d) => { m[d.id] = d; });
    return m;
  }

  const has = (v) => v !== null && v !== undefined && !isNaN(v);
  function signed(n) { return n > 0 ? '+' + n : String(n); }

  /** '2026-11-13' → '11/13' */
  function md(iso) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${+m[1]}/${+m[2]}` : String(iso || '');
  }

  // ---------- 비교 ----------

  /**
   * 한 차원의 변화. before·after는 −100~+100(왼쪽 −, 오른쪽 +).
   * → { kind: 'none'|'same'|'left'|'right', delta, size, text }
   */
  function compareDim(dim, before, after) {
    if (!has(before) || !has(after)) return { kind: 'none', delta: null, size: null, text: '응답이 없어 비교할 수 없어' };
    const delta = after - before;
    const size = Math.abs(delta);
    if (size < SAME) return { kind: 'same', delta, size, text: '거의 같아' };
    const pole = delta < 0 ? dim.left : dim.right;
    return { kind: delta < 0 ? 'left' : 'right', delta, size, text: `${pole.name} 쪽으로 ${size} 이동` };
  }

  /** 두 결과(a: 이전, b: 지금)의 스펙트럼 차원별 변화 */
  function compareResults(a, b) {
    const dims = dimMap();
    const sa = (a && a.styles) || {};
    const sb = (b && b.styles) || {};
    return SM.score.SPECTRUM_DIMS.map((id) => Object.assign(
      { dimId: id, dim: dims[id], before: has(sa[id]) ? sa[id] : null, after: has(sb[id]) ? sb[id] : null },
      compareDim(dims[id], sa[id], sb[id])
    ));
  }

  /** 기본 비교 짝: 가장 최근과 그 직전 → { before, after } (id) | null */
  function defaultPair(list) {
    const l = Array.isArray(list) ? list : [];
    return l.length >= 2 ? { before: l[l.length - 2].id, after: l[l.length - 1].id } : null;
  }

  // ---------- 흐름 ----------

  /** 차원별 검사마다 점수(오래된 것부터) → [{ dimId, dim, points: [{ takenAt, value|null }] }] */
  function trendSeries(list) {
    const dims = dimMap();
    const l = Array.isArray(list) ? list : [];
    return SM.score.SPECTRUM_DIMS.map((id) => ({
      dimId: id, dim: dims[id],
      points: l.map((r) => ({ takenAt: r.takenAt, value: r.styles && has(r.styles[id]) ? r.styles[id] : null }))
    }));
  }

  // ---------- 약점 ----------

  /** 한 과목의 약점 한 줄: '풀이법 선택·실수' | '고른 약점 없음' */
  function weakLine(w) {
    const codes = (w && w.codes) || [];
    return codes.length ? codes.map((c) => SM.data.weaknessShort[c] || SM.data.weaknessLabels[c] || c).join('·') : '고른 약점 없음';
  }

  /** 약점을 하나 이상 고른 과목 */
  function weakSubjects(result) {
    return ((result && result.weakness) || []).filter((w) => w && w.codes && w.codes.length).map((w) => w.subject);
  }

  /**
   * 과목별로 검사마다 나온 약점(오래된 것부터). 그 검사에서 고르지 않은 과목은 codes: null.
   * → [{ subject, entries: [{ id, takenAt, codes|null }] }]
   */
  function weaknessTimeline(list) {
    const l = Array.isArray(list) ? list : [];
    const subjects = [];
    l.forEach((r) => ((r && r.weakness) || []).forEach((w) => { if (w && subjects.indexOf(w.subject) === -1) subjects.push(w.subject); }));
    return subjects.map((subject) => ({
      subject,
      entries: l.map((r) => {
        const w = ((r && r.weakness) || []).find((x) => x && x.subject === subject);
        return { id: r.id, takenAt: r.takenAt, codes: w ? (w.codes || []).slice() : null };
      })
    }));
  }

  /** "수학 — 11/13 풀이법 선택 → 12/11 실수" */
  function timelineText(row) {
    return `${row.subject} — ` + row.entries
      .map((e) => `${md(e.takenAt)} ${e.codes === null ? '(이 과목은 검사 안 함)' : weakLine({ codes: e.codes })}`)
      .join(' → ');
  }

  // ---------- 상태·삭제 ----------

  /** → { count, canCompare, canTrend, nextRetest: 'YYYY-MM-DD'|null, daysLeft } */
  function historyInfo(list, today) {
    const l = Array.isArray(list) ? list : [];
    const last = l[l.length - 1];
    let nextRetest = null;
    let daysLeft = null;
    if (last && last.takenAt) {
      try {
        nextRetest = SM.date.addDays(String(last.takenAt).slice(0, 10), SM.test.RETEST_DAYS);
        daysLeft = SM.date.daysBetween(today || SM.date.today(), nextRetest);
      } catch (e) { nextRetest = null; daysLeft = null; }
    }
    return { count: l.length, canCompare: l.length >= 2, canTrend: l.length >= 3, nextRetest, daysLeft };
  }

  /** id인 결과를 뺀 새 배열. 마지막 하나는 지우지 않는다. → { list, ok, reason: null|'last'|'missing' } */
  function removeResult(list, id) {
    const l = Array.isArray(list) ? list : [];
    if (!l.some((r) => r && r.id === id)) return { list: l, ok: false, reason: 'missing' };
    if (l.length <= 1) return { list: l, ok: false, reason: 'last' };
    return { list: l.filter((r) => !(r && r.id === id)), ok: true, reason: null };
  }

  // =====================================================================
  // 화면
  // =====================================================================

  function cssVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /** 차원 하나의 작은 선 그래프. 가운데 0, 위 +100(오른쪽 극), 아래 −100(왼쪽 극). null은 선을 끊는다. */
  function drawSpark(canvas, series) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(240, Math.round(rect.width || canvas.parentNode.clientWidth || 300));
    const cssH = 150;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const text = cssVar('--text', '#222');
    const muted = cssVar('--muted', '#666');
    const line = cssVar('--line', '#ccc');
    const accent = cssVar('--accent', '#2563cc');
    const pad = { l: 12, r: 12, t: 22, b: 26 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const pts = series.points;
    const n = pts.length;
    const inset = 24;
    const x = (i) => pad.l + inset + (n <= 1 ? (w - 2 * inset) / 2 : ((w - 2 * inset) * i) / (n - 1));
    const y = (v) => pad.t + ((100 - Math.max(-100, Math.min(100, v))) / 200) * h;

    ctx.font = '12px system-ui, sans-serif';
    // 균형 띠(−20~+20) 경계는 점선, 0은 실선
    [[0, []], [20, [2, 3]], [-20, [2, 3]]].forEach(([v, dash]) => {
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(pad.l + w, y(v)); ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.textAlign = 'left';
    ctx.textBaseline = 'top'; ctx.fillText(`↑ ${series.dim.right.name}`, pad.l, 2);
    ctx.textBaseline = 'bottom'; ctx.fillText(`↓ ${series.dim.left.name}`, pad.l, cssH - 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    pts.forEach((p, i) => ctx.fillText(md(p.takenAt), x(i), cssH - 2));

    // 선(값이 없는 검사에서 끊음)
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
    let open = false;
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (p.value === null) { open = false; return; }
      if (!open) { ctx.moveTo(x(i), y(p.value)); open = true; } else ctx.lineTo(x(i), y(p.value));
    });
    ctx.stroke();
    // 점 + 값(색만으로 전달하지 않게 숫자도)
    pts.forEach((p, i) => {
      if (p.value === null) return;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x(i), y(p.value), 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = text; ctx.textBaseline = p.value >= 0 ? 'top' : 'bottom';
      ctx.fillText(signed(p.value), x(i), y(p.value) + (p.value >= 0 ? 6 : -6));
    });
  }

  function query() {
    const q = {};
    const s = String(location.hash || '').split('?')[1] || '';
    s.split('&').forEach((kv) => {
      if (!kv) return;
      const [k, v] = kv.split('=');
      try { q[decodeURIComponent(k)] = decodeURIComponent(v || ''); } catch (e) { /* 무시 */ }
    });
    return q;
  }

  function historyScreen() {
    const el = SM.ui.el;
    const p = SM.auth.current();
    const key = SM.keys.results(p.sid);
    const root = el('div', { class: 'stack result-history' });
    const monthDay = SM.test.monthDay;
    let pair = null;
    let cleanups = [];

    function load() {
      const l = SM.store.get(key, []);
      return Array.isArray(l) ? l.filter((r) => r && typeof r === 'object') : [];
    }

    async function remove(r) {
      const ok = await SM.ui.confirmDialog(`${monthDay(r.takenAt)} 결과를 지울까? 지운 결과는 되돌릴 수 없어.`, { okText: '지우기', cancelText: '그대로 두기' });
      if (!ok) return;
      let res = null;
      SM.store.update(key, (l) => { res = removeResult(l, r.id); return res.list; }, []);
      SM.ui.toast(res && res.ok ? '결과를 지웠어.' : res && res.reason === 'last' ? '하나 남은 결과는 지울 수 없어.' : '이미 지워진 결과야.');
      pair = null;
      render();
      const h = root.querySelector('h2');
      if (h) h.focus();
    }

    // 1. 목록(최신순)
    function listSection(list) {
      const latestId = list[list.length - 1].id;
      return el('section', { class: 'card stack' },
        el('h3', { text: `검사 기록 (${list.length}번)` }),
        el('ol', { class: 'history-list' }, list.slice().reverse().map((r) => {
          const isLatest = r.id === latestId;
          const weak = weakSubjects(r);
          return el('li', { class: 'history-item stack' },
            el('div', { class: 'row wrap' },
              el('strong', { text: monthDay(r.takenAt) }),
              isLatest ? el('span', { class: 'tag', text: '가장 최근' }) : null,
              r.kind === 'deep' || r.extended ? el('span', { class: 'tag', text: '심화 포함' }) : null),
            el('p', { text: `취약 과목: ${weak.length ? weak.join('·') : '없음'}` }),
            (r.weakness || []).length
              ? el('ul', { class: 'block-lines' }, r.weakness.map((w) => el('li', { text: `${w.subject}: ${weakLine(w)}` })))
              : null,
            el('p', { class: 'muted', text: SM.test.summary(r) }),
            el('div', { class: 'row wrap' },
              el('a', {
                href: isLatest || !r.id ? '#/result' : `#/result?id=${encodeURIComponent(r.id)}`,
                class: 'btn', text: '이 결과 열어 보기'
              }),
              list.length > 1 && r.id
                ? el('button', { type: 'button', class: 'btn btn-ghost', text: '삭제', 'aria-label': `${monthDay(r.takenAt)} 결과 삭제`, onClick: () => remove(r) })
                : null)
          );
        })),
        list.length === 1 ? el('p', { class: 'muted', text: '하나 남은 결과는 지울 수 없어.' }) : null
      );
    }

    // 결과가 하나뿐일 때
    function onlyOne(list) {
      const info = historyInfo(list, SM.date.today());
      return el('section', { class: 'card stack' },
        el('p', { text: '다음 검사를 하면 여기서 비교할 수 있어. 4주쯤 뒤에 다시 해 보자!' }),
        info.nextRetest
          ? el('p', { class: 'muted', text: info.daysLeft > 0 ? `다시 검사하기 좋은 날: ${monthDay(info.nextRetest)} (${info.daysLeft}일 남음)` : '4주가 지났어. 지금 다시 해 봐도 좋아.' })
          : null,
        el('a', { href: '#/test', class: 'btn', text: '다시 검사하기' })
      );
    }

    // 2. 비교하기
    function compareSection(list) {
      const byId = (id) => list.find((r) => r.id === id);
      if (!pair || !byId(pair.before) || !byId(pair.after)) pair = defaultPair(list);
      const option = (r, i) => el('option', { value: r.id, text: `${monthDay(r.takenAt)} (${i + 1}번째)` });
      const selBefore = el('select', { id: 'cmp-before', onChange(e) { pair.before = e.target.value; paint(); } }, list.map(option));
      const selAfter = el('select', { id: 'cmp-after', onChange(e) { pair.after = e.target.value; paint(); } }, list.map(option));
      selBefore.value = pair.before;
      selAfter.value = pair.after;
      const body = el('div', { class: 'stack', 'aria-live': 'polite' });

      function paint() {
        SM.ui.clear(body);
        const a = byId(pair.before);
        const b = byId(pair.after);
        if (!a || !b || a === b) { body.appendChild(el('p', { text: '서로 다른 두 검사를 골라 줘.' })); return; }
        const pos = (v) => ((v + 100) / 2) + '%';
        compareResults(a, b).forEach((c) => body.appendChild(el('div', { class: 'compare-row stack' },
          el('div', { class: 'spec-ends' }, el('span', { text: c.dim.left.name }), el('span', { text: c.dim.right.name })),
          el('div', { class: 'spec-track', 'aria-hidden': 'true' },
            el('div', { class: 'spec-balance' }),
            c.before !== null ? el('div', { class: 'spec-marker spec-prev', style: { left: pos(c.before) } }) : null,
            c.after !== null ? el('div', { class: 'spec-marker', style: { left: pos(c.after) } }) : null),
          el('p', { class: 'compare-text' },
            el('strong', { text: c.text }),
            el('span', { class: 'muted', text: ` (${md(a.takenAt)} ${c.before === null ? '응답 없음' : signed(c.before)} → ${md(b.takenAt)} ${c.after === null ? '응답 없음' : signed(c.after)})` }))
        )));
      }
      paint();

      return el('section', { class: 'card stack', id: 'compare' },
        el('h3', { text: '비교하기', tabindex: '-1' }),
        el('div', { class: 'row wrap compare-pick' },
          el('label', { for: 'cmp-before', text: '이전 검사' }), selBefore,
          el('label', { for: 'cmp-after', text: '지금 검사' }), selAfter),
        el('p', { class: 'muted legend' },
          el('span', { class: 'legend-dot legend-prev', 'aria-hidden': 'true' }), ' 점선 동그라미: 이전 검사  ',
          el('span', { class: 'legend-dot legend-now', 'aria-hidden': 'true' }), ' 진한 동그라미: 지금 검사  · 10 미만으로 움직이면 "거의 같아"'),
        body
      );
    }

    // 3. 변화 흐름
    function trendSection(list) {
      const charts = [];
      const sec = el('section', { class: 'card stack' },
        el('h3', { text: '변화 흐름' }),
        el('p', { class: 'muted', text: '가운데 실선이 0, 점선 사이가 균형(−20~+20)이야. 점 옆 숫자가 그때 점수야.' }),
        trendSeries(list).map((s) => {
          const canvas = el('canvas', {
            class: 'spark-canvas', role: 'img',
            'aria-label': `${s.dim.left.name}↔${s.dim.right.name}: ` + s.points.map((p) => `${md(p.takenAt)} ${p.value === null ? '응답 없음' : signed(p.value)}`).join(', ')
          });
          charts.push({ canvas, s });
          return el('div', { class: 'spark stack' }, el('h4', { text: `${s.dim.left.name} ↔ ${s.dim.right.name}` }), canvas);
        }));
      const draw = () => charts.forEach((c) => { if (c.canvas.isConnected) drawSpark(c.canvas, c.s); });
      const raf = window.requestAnimationFrame ? window.requestAnimationFrame(draw) : 0;
      const timer = setTimeout(draw, 30);
      const onResize = SM.ui.debounce(draw, 150);
      window.addEventListener('resize', onResize);
      const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      if (mql && mql.addEventListener) mql.addEventListener('change', draw);
      cleanups.push(() => {
        if (window.cancelAnimationFrame && raf) window.cancelAnimationFrame(raf);
        clearTimeout(timer);
        window.removeEventListener('resize', onResize); onResize.cancel();
        if (mql && mql.removeEventListener) mql.removeEventListener('change', draw);
      });
      return sec;
    }

    // 4. 약점 변화
    function weaknessSection(list) {
      const rows = weaknessTimeline(list);
      return el('section', { class: 'card stack' },
        el('h3', { text: '약점 변화' }),
        rows.length
          ? el('ul', { class: 'block-lines' }, rows.map((r) => el('li', { text: timelineText(r) })))
          : el('p', { class: 'muted', text: '과목 약점 기록이 없어.' })
      );
    }

    function render() {
      cleanups.forEach((f) => f());
      cleanups = [];
      SM.ui.clear(root);
      const list = load();
      root.appendChild(SM.test.resultTabs('history'));
      root.appendChild(el('h2', { text: '결과 기록', tabindex: '-1' }));
      if (!list.length) {
        root.appendChild(el('div', { class: 'card stack' },
          el('p', { text: '아직 검사 결과가 없어. 10분 정도면 나의 공부 선호를 볼 수 있어.' }),
          el('a', { href: '#/test', class: 'btn btn-primary', text: '진단 시작하기' })));
        return;
      }
      [
        list.length === 1 ? onlyOne(list) : compareSection(list),
        list.length >= 3 ? trendSection(list) : null,
        weaknessSection(list),
        listSection(list),
        el('p', { class: 'card disclaimer', text: '선호는 바뀔 수 있어. 결과가 달라져도 맞고 틀린 게 아니라, 지금 나에게 편한 방식이 달라진 거야.' })
      ].forEach((n) => { if (n) root.appendChild(n); });
    }

    render();
    // 결과 화면의 '지난번과 비교해 볼래?'에서 왔으면 비교로
    if (query().compare) {
      setTimeout(() => {
        const h = root.querySelector('#compare h3');
        if (h) { h.focus(); if (h.scrollIntoView) h.scrollIntoView({ block: 'start' }); }
      }, 0);
    }

    return { node: root, cleanup() { cleanups.forEach((f) => f()); cleanups = []; } };
  }

  SM.resultHistory = {
    compareDim, compareResults, defaultPair, trendSeries, weakLine, weakSubjects,
    weaknessTimeline, timelineText, historyInfo, removeResult, md, SAME
  };

  if (typeof SM.route === 'function') {
    SM.route('#/result/history', { title: '결과 기록', tab: 'test', render: historyScreen });
  }
})(window.SM = window.SM || {});
