(function (SM) {
  'use strict';
  const D = SM.data;
  const qs = D.styleQuestions;
  const dimById = {};
  D.styleDims.forEach((d) => { dimById[d.id] = d; });

  test('questions: 기본형 정확히 38문항, 심화형 12문항', () => {
    assert.equal(qs.filter((q) => q.set === 'basic').length, 38);
    assert.equal(qs.filter((q) => q.set === 'deep').length, 12);
    assert.equal(qs.length, 50);
  });

  test('questions: 차원별 문항 수', () => {
    const count = {};
    qs.forEach((q) => { count[q.dim] = (count[q.dim] || 0) + 1; });
    assert.deepEqual(count, {
      fieldDep: 4, tempo: 4, perception: 4, reasoning: 4, processing: 4,
      input: 4, vark: 4, order: 6, kolbPerceive: 2, kolbProcess: 2,
      approach: 6, goal: 4, chrono: 2
    });
  });

  test('questions: 5점 척도 양극 차원은 reverse가 절반(order 3/6)', () => {
    D.styleDims.filter((d) => d.format === 'likert').forEach((d) => {
      const items = qs.filter((q) => q.dim === d.id);
      const rev = items.filter((q) => q.reverse).length;
      assert.equal(rev * 2, items.length, d.id + ' reverse ' + rev + '/' + items.length);
    });
    assert.equal(qs.filter((q) => q.dim === 'order' && q.reverse).length, 3);
  });

  test('questions: 모든 id 유일(약점 문항 포함)', () => {
    const ids = qs.map((q) => q.id);
    Object.keys(D.weaknessQuestions).forEach((s) => D.weaknessQuestions[s].forEach((w) => ids.push(w.id)));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('questions: 모든 dim이 styleDims에 있고 형식이 맞음', () => {
    qs.forEach((q) => {
      const d = dimById[q.dim];
      assert.ok(d, '없는 dim: ' + q.dim);
      assert.equal(q.set, d.set, q.id + ' set');
      if (d.format === 'forced') {
        assert.equal(q.format, 'forced', q.id);
        assert.ok(q.a && q.b, q.id + ' a/b');
      } else if (d.format === 'multi') {
        assert.deepEqual(q.options.map((o) => o.key).sort(), ['A', 'K', 'R', 'V']);
      } else if (d.format === 'profile') {
        assert.ok(d.parts[q.part], q.id + ' part');
        assert.equal(q.reverse, false);
      } else {
        assert.equal(q.format, 'likert', q.id);
        assert.ok(typeof q.reverse === 'boolean');
      }
    });
  });

  test('questions: 양극 차원은 left/right에 key·name·lean·desc·studyTip', () => {
    D.styleDims.filter((d) => d.left).forEach((d) => {
      ['left', 'right'].forEach((side) => {
        ['key', 'name', 'lean', 'desc', 'studyTip'].forEach((f) => {
          assert.ok(d[side][f], d.id + '.' + side + '.' + f);
        });
      });
      assert.ok([1, 2, 3, 4, 5].indexOf(d.area) !== -1);
    });
    assert.equal(dimById.order.note, '경향으로만 표시');
  });

  test('questions: 문항은 한 문장, 40자 이하', () => {
    const texts = [];
    qs.forEach((q) => {
      if (q.text) texts.push(q.text);
      if (q.a) texts.push(q.a, q.b);
    });
    texts.forEach((t) => {
      assert.ok(t.length >= 8 && t.length <= 40, '길이: ' + t);
    });
  });

  test('questions: 약점 code가 weaknessLabels에 모두 있음, 공통은 ANY_ANXIETY 하나', () => {
    const codes = [];
    Object.keys(D.weaknessQuestions).forEach((s) => D.weaknessQuestions[s].forEach((w) => codes.push(w.code)));
    codes.forEach((c) => assert.ok(D.weaknessLabels[c], '라벨 없음: ' + c));
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(Object.keys(D.weaknessLabels).length, codes.length);
    assert.deepEqual(D.weaknessQuestions['공통'].map((w) => w.code), ['ANY_ANXIETY']);
  });

  test('questions: 약점 과목이 config.subjects와 일치', () => {
    const subjects = Object.keys(D.weaknessQuestions).filter((s) => s !== '공통').sort();
    assert.deepEqual(subjects, SM.config.subjects.slice().sort());
  });
})(window.SM);
