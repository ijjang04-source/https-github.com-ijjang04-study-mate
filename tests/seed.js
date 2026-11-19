// tests/seed.js — 성능 점검용 1년치 가짜 데이터.
// 브라우저(tests/perf.html)와 node 어디서나 SM.seed.year(store, options)로 쓴다.
// 실제 학생 데이터와 섞이지 않도록 반드시 메모리 저장소(SM.createStore)에 넣어서 쓴다.
(function (SM) {
  'use strict';

  const SUBJECTS = ['국어', '영어', '수학', '과학', '사회'];
  const STRATS = ['retrieval', 'spacing', 'interleave', 'errorLog', 'selfExplain', 'conceptMap'];
  const PLACES = ['home', 'library', 'class', 'academy', 'cafe'];
  const BLOCKERS = ['phone', 'sleepy', 'noise', 'hard'];
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  // 결정적 난수(같은 시드 → 같은 데이터)
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const pad = (n) => String(n).padStart(2, '0');

  function block(r, i, iso) {
    const h = 16 + i;
    const subject = pick(r, SUBJECTS);
    const strategy = pick(r, STRATS);
    const place = pick(r, PLACES);
    const b = {
      id: `b-${iso}-${i}`, start: `${pad(h)}:00`, end: `${pad(h)}:50`, subject, topic: `${subject} ${i + 1}단원 복습`,
      target: { n: 20, unit: '문제' }, strategy, method: '책을 덮고 떠올린 뒤 맞춰 보기', place, placeText: '', with: 'alone', modes: ['solve']
    };
    if (r() < 0.8) {
      b.done = {
        start: b.start, end: b.end, n: 10 + Math.floor(r() * 15), applied: pick(r, ['yes', 'yes', 'partial', 'no']),
        checks: [true, r() < 0.5], focus: 1 + Math.floor(r() * 5), blockers: r() < 0.3 ? [pick(r, BLOCKERS)] : [],
        note: '오늘은 집중이 잘 됐다', place, placeText: '', with: 'alone'
      };
    }
    return b;
  }

  /**
   * 1년치(기본: today 기준 지난 365일) 데이터를 store에 넣는다.
   * options: { sid, nickname, today, blocksPerDay=6, weeks=52, classmates=30, feedWeeks=20, commentsPerPlan=2 }
   * → { sid, classId, days, blocks, checkins, snapshots, comments }
   */
  function year(store, options) {
    const o = Object.assign({ sid: 'DEMO-1-1-5', nickname: '하늘', today: '2026-11-19', blocksPerDay: 6, weeks: 52, classmates: 30, feedWeeks: 20, commentsPerPlan: 2, seed: 7 }, options || {});
    const r = rng(o.seed);
    const sid = o.sid;
    const classId = sid.replace(/-\d+$/, '');
    const D = SM.date;

    store.set(SM.keys.profile(sid), { sid, classId, school: classId.split('-')[0], grade: +classId.split('-')[1], cls: +classId.split('-')[2], number: +sid.split('-')[3], nickname: o.nickname, greeted: true, createdAt: D.addDays(o.today, -365) + 'T00:00:00Z' });
    // 진단 결과는 실제 채점 함수로 만든다(모양이 실제와 같도록)
    const basicQ = SM.data.styleQuestions.filter((q) => q.set === 'basic');
    const weakQ = [].concat(SM.data.weaknessQuestions['수학'] || [], SM.data.weaknessQuestions['영어'] || []);
    store.set(SM.keys.results(sid), [0, 1, 2, 3].map((k) => {
      const answers = {};
      basicQ.forEach((q) => { answers[q.id] = q.format === 'forced' ? pick(r, ['a', 'b']) : q.format === 'multi' ? [pick(r, ['V', 'A', 'R', 'K'])] : 1 + Math.floor(r() * 5); });
      weakQ.forEach((q) => { answers[q.id] = 1 + Math.floor(r() * 5); });
      return SM.score.basic(answers, ['수학', '영어'], new Date(Date.parse(D.addDays(o.today, -365 + k * 90))));
    }));
    store.set(SM.keys.plan(sid), { strategies: { 수학: ['interleave', 'retrieval', 'errorLog'], 영어: ['retrieval', 'spacing', 'selfExplain'] }, habits: [], confirmed: true });

    // 플래너: 월 키마다 { month, weeks, days }
    const months = {};
    const monthOf = (mk) => (months[mk] = months[mk] || { month: { goals: ['수학 1단원 끝내기', '영단어 600개'], events: [{ date: o.today, kind: '기말고사', title: '' }], weekFocus: {}, focusStrategies: [], public: true }, weeks: {}, days: {} });
    let blocks = 0;
    for (let d = 364; d >= 0; d--) {
      const iso = D.addDays(o.today, -d);
      const list = [];
      for (let i = 0; i < o.blocksPerDay; i++) list.push(block(r, i, iso));
      blocks += list.length;
      monthOf(D.monthKey(iso)).days[iso] = { blocks: list, prefilled: true };
      const wk = D.isoWeek(iso);
      const mk = SM.planner.monthKeyForWeek(wk);
      const m = monthOf(mk);
      if (!m.weeks[wk]) {
        const grid = {};
        DAY_KEYS.forEach((k) => { grid[k] = ['수학:interleave', '영어:retrieval']; });
        m.weeks[wk] = {
          goals: [{ subject: '수학', text: '문제 40개' }, { subject: '영어', text: '단어 100개' }], extraSubjects: [],
          strategies: { 수학: ['interleave', 'retrieval'], 영어: ['retrieval'] }, grid,
          intentions: [{ text: '저녁 먹고 바로 수학 시작', from: null }], obstacle: '휴대폰', public: true, publicRate: true, review: {}
        };
      }
    }
    Object.keys(months).forEach((mk) => store.set(SM.keys.planner(sid, mk), months[mk]));

    // 점검표 52개
    const checkins = [];
    for (let w = o.weeks; w >= 1; w--) {
      const wk = D.isoWeek(D.addDays(o.today, -7 * w));
      checkins.push({
        isoWeek: wk, scores: { b1: 3, b2: 4, b3: 2, b4: 3, b5: 4, b6: 3, b7: 2, b8: 4 }, seven: [true, false, true, true, false, true, true],
        results: {}, reflect: { good: '꾸준히 했다', bad: '주말에 몰렸다', nextChange: '토요일엔 블록 하나만' },
        submittedAt: D.addDays(o.today, -7 * w + 6) + 'T12:00:00Z', subjectRates: { 수학: 0.6, 영어: 0.5 }
      });
    }
    store.set(SM.keys.checkin(sid), checkins);

    // 반 피드: 30명 × 20주 + 댓글
    const feed = [];
    const comments = [];
    for (let s = 1; s <= o.classmates; s++) {
      const msid = `${classId}-${s}`;
      for (let w = 0; w < o.feedWeeks; w++) {
        const wk = D.isoWeek(D.addDays(o.today, -7 * w));
        const at = D.addDays(o.today, -7 * w) + `T${pad(8 + (s % 12))}:00:00Z`;
        const planKey = `${msid}:${wk}`;
        feed.push({
          planKey, sid: msid, nickname: msid === sid ? o.nickname : `친구${s}`, week: wk,
          goals: [{ subject: '수학', text: '문제 40개' }, { subject: '영어', text: '단어 100개' }],
          strategies: { 수학: ['interleave', 'retrieval'], 영어: ['spacing'] }, weekFocus: '수학 집중', rate: 0.4 + r() * 0.5, updatedAt: at
        });
        for (let c = 0; c < o.commentsPerPlan; c++) {
          const author = `${classId}-${1 + ((s + c) % o.classmates)}`;
          comments.push({ id: `c-${s}-${w}-${c}`, planKey, author, nickname: author === sid ? o.nickname : `친구${1 + ((s + c) % o.classmates)}`, text: '나도 이번 주 교차 연습 해 볼래!', reaction: null, hidden: false, createdAt: at, editedAt: null });
        }
        comments.push({ id: `r-${s}-${w}`, planKey, author: `${classId}-${1 + (s % o.classmates)}`, nickname: '친구', text: '', reaction: 'cheer', hidden: false, createdAt: at, editedAt: null });
      }
    }
    store.set(SM.keys.feed(classId), feed);
    store.set(SM.keys.comments(classId), comments);

    // 챗봇 기록(최대 100개)
    const chat = [];
    for (let i = 0; i < 100; i++) chat.push({ from: i % 2 ? 'me' : 'bot', type: 'text', text: i % 2 ? '오늘 계획' : '오늘 플래너를 열어 볼까?', at: Date.parse(o.today) - (100 - i) * 60000 });
    store.set(SM.keys.chat(sid), chat);

    return { sid, classId, days: 365, blocks, checkins: checkins.length, snapshots: feed.length, comments: comments.length };
  }

  SM.seed = { year };
})(typeof window !== 'undefined' ? (window.SM = window.SM || {}) : (globalThis.SM = globalThis.SM || {}));
