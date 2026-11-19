(function (SM) {
  'use strict';

  // 학습 스타일·약점 문항 데이터.
  // 원 검사(ILS, VARK, Kolb LSI, SPQ 등)의 문항을 번역하지 않고 고등학생 일상어로 새로 썼다.
  //
  // 채점 방향 규칙(8단계 채점이 따른다)
  //  - likert: 동의할수록 right 쪽. reverse: true면 동의할수록 left 쪽.
  //  - forced: a를 고르면 left, b를 고르면 right.
  //  - multi(vark): 고른 보기의 key(V/A/R/K)에 1점씩.
  //  - profile(approach/goal): 각 part 점수를 따로 낸다(양극 차원이 아님).
  //
  // 화면에는 name('○○형')을 단독 라벨로 쓰지 않고 lean('~하는 편')과 스펙트럼으로 보여 준다.

  SM.data = SM.data || {};

  SM.data.likertLabels = ['전혀 아니다', '아니다', '보통', '그렇다', '매우 그렇다'];

  SM.data.styleAreas = {
    1: '정보 처리',
    2: '감각 채널',
    3: '학습 순서',
    4: '공부 접근과 목표',
    5: '생체 리듬'
  };

  SM.data.styleDims = [
    // ---------- 영역 ① 정보 처리 ----------
    {
      id: 'fieldDep', area: 1, set: 'basic', format: 'likert',
      left: {
        key: 'dependent', name: '장 의존형', lean: '주변 분위기와 함께할 때 힘이 나는 편',
        desc: '맥락과 사람들의 반응을 함께 보며 배우고, 함께하는 열린 공간에서 의욕이 커져.',
        studyTip: '스터디 친구와 목표를 나누고, 배운 내용을 실제 상황과 연결해 봐.'
      },
      right: {
        key: 'independent', name: '장 독립형', lean: '혼자 핵심을 골라내는 편',
        desc: '맥락에서 필요한 정보만 떼어 분석하고, 스스로 정한 목표로 움직여.',
        studyTip: '조용한 자리에서 스스로 목표를 세우고, 가끔 남에게 설명하며 빈틈을 확인해.'
      }
    },
    {
      id: 'tempo', area: 1, set: 'basic', format: 'likert',
      left: {
        key: 'impulsive', name: '충동형', lean: '빨리 결정하고 움직이는 편',
        desc: '판단이 빠르고 속도가 장점이지만, 서두르다 실수가 생길 수 있어.',
        studyTip: '답을 고른 뒤 3초 멈추고 조건을 한 번 더 확인하는 습관을 붙여 봐.'
      },
      right: {
        key: 'reflective', name: '반성형', lean: '천천히 따져 보고 정확히 고르는 편',
        desc: '보기를 끝까지 살펴서 정확하지만, 시간이 부족해질 수 있어.',
        studyTip: '문제마다 목표 시간을 정해 두고 시간 안에 푸는 연습을 해 봐.'
      }
    },
    {
      id: 'perception', area: 1, set: 'basic', format: 'likert',
      left: {
        key: 'sensing', name: '감각형', lean: '사실과 절차로 배우는 편',
        desc: '구체적인 사실, 데이터, 정해진 절차를 따라가며 확실하게 익혀.',
        studyTip: '개념을 배울 때 "왜?"를 한 줄 덧붙여 원리까지 정리해 봐.'
      },
      right: {
        key: 'intuitive', name: '직관형', lean: '원리와 가능성을 찾는 편',
        desc: '아이디어와 원리, 새로운 연결에 끌리고 반복 연습은 지루해할 수 있어.',
        studyTip: '원리를 이해한 뒤 계산·암기 문제를 정해진 양만큼 꼭 반복해.'
      }
    },
    {
      id: 'reasoning', area: 1, set: 'basic', format: 'forced',
      left: {
        key: 'inductive', name: '귀납형', lean: '예시를 먼저 보고 규칙을 찾는 편',
        desc: '여러 예제를 풀어 보며 공통 규칙을 스스로 찾아낼 때 잘 이해돼.',
        studyTip: '예제를 먼저 풀고, 찾은 규칙을 개념 설명과 맞춰 확인해.'
      },
      right: {
        key: 'deductive', name: '연역형', lean: '개념을 먼저 알고 예시에 적용하는 편',
        desc: '원리와 정의를 먼저 잡은 뒤 예제에 적용할 때 잘 이해돼.',
        studyTip: '개념을 정리한 뒤 바로 유형별 예제에 적용해 봐.'
      }
    },
    {
      id: 'processing', area: 1, set: 'basic', format: 'forced',
      left: {
        key: 'active', name: '능동형', lean: '해 보고 말하면서 익히는 편',
        desc: '직접 해 보거나 다른 사람과 이야기하면서 생각이 정리돼.',
        studyTip: '배운 걸 친구에게 설명하거나 바로 문제에 적용해 봐.'
      },
      right: {
        key: 'reflective', name: '성찰형', lean: '혼자 곰곰이 생각하며 익히는 편',
        desc: '혼자 충분히 생각하고 정리할 시간이 있을 때 깊이 이해돼.',
        studyTip: '공부 중간에 멈추고 핵심을 세 줄로 요약하는 시간을 둬.'
      }
    },

    // ---------- 영역 ② 감각 채널 ----------
    {
      id: 'input', area: 2, set: 'basic', format: 'forced',
      left: {
        key: 'visual', name: '시각형', lean: '그림과 도표로 받아들이는 편',
        desc: '그림, 도표, 색, 공간 배치로 볼 때 오래 기억해.',
        studyTip: '개념을 도식·마인드맵으로 바꾸고 색으로 구분해 봐.'
      },
      right: {
        key: 'verbal', name: '언어형', lean: '글과 말로 받아들이는 편',
        desc: '글로 읽거나 말로 들은 설명을 잘 기억해.',
        studyTip: '핵심을 문장으로 요약하고 소리 내어 설명해 봐.'
      }
    },
    {
      id: 'vark', area: 2, set: 'basic', format: 'multi',
      channels: {
        V: { name: '보기', lean: '지도·도표로 보는 걸 좋아하는 편', studyTip: '표·그래프로 다시 정리해 봐.' },
        A: { name: '듣기', lean: '듣고 말하며 익히는 편', studyTip: '설명을 녹음해 듣거나 친구와 말로 주고받아 봐.' },
        R: { name: '읽기·쓰기', lean: '읽고 쓰며 익히는 편', studyTip: '요약 노트를 쓰고 다시 읽어 봐.' },
        K: { name: '해 보기', lean: '직접 해 보며 익히는 편', studyTip: '문제 풀이·실험·예시 만들기처럼 손을 움직여 봐.' }
      },
      note: '여러 채널을 함께 쓰는 게 자연스러워. 가장 많이 고른 채널을 참고만 해.'
    },

    // ---------- 영역 ③ 학습 순서 ----------
    {
      id: 'order', area: 3, set: 'basic', format: 'likert',
      left: {
        key: 'sequential', name: '순차형', lean: '한 단계씩 차근차근 가는 편',
        desc: '앞 단계를 확실히 이해하고 다음으로 넘어갈 때 마음이 편해.',
        studyTip: '단원을 시작할 때 목차를 한 번 훑어 전체 그림도 같이 잡아 봐.'
      },
      right: {
        key: 'global', name: '총체형', lean: '큰 그림을 먼저 보는 편',
        desc: '전체 흐름을 먼저 잡으면 세부 내용이 한 번에 연결돼.',
        studyTip: '큰 그림을 잡은 뒤 빠진 단계가 없는지 순서대로 점검해.'
      },
      note: '경향으로만 표시'
    },
    {
      id: 'kolbPerceive', area: 3, set: 'basic', format: 'likert',
      left: {
        key: 'concrete', name: '구체적 경험', lean: '직접 겪어 보며 와닿는 편',
        desc: '경험과 느낌이 있어야 내용이 실감 나.',
        studyTip: '개념마다 내 생활 속 예를 하나씩 찾아 붙여 봐.'
      },
      right: {
        key: 'abstract', name: '추상적 개념', lean: '논리와 개념으로 이해하는 편',
        desc: '논리로 따지고 개념으로 정리할 때 이해가 깊어져.',
        studyTip: '개념을 정리한 뒤 구체적인 예시로 한 번 더 확인해.'
      },
      note: 'Kolb 축1(지각): 구체적 경험(-) ↔ 추상적 개념(+)'
    },
    {
      id: 'kolbProcess', area: 3, set: 'basic', format: 'likert',
      left: {
        key: 'observe', name: '성찰적 관찰', lean: '지켜보고 생각한 뒤 움직이는 편',
        desc: '충분히 관찰하고 생각한 다음에 적용하는 걸 좋아해.',
        studyTip: '생각을 정리했다면 작은 문제부터 바로 적용해 봐.'
      },
      right: {
        key: 'experiment', name: '능동적 실험', lean: '바로 써 보며 확인하는 편',
        desc: '배운 걸 곧장 적용해 보면서 확인하는 걸 좋아해.',
        studyTip: '적용한 뒤 무엇이 됐고 안 됐는지 한 줄씩 돌아봐.'
      },
      note: 'Kolb 축2(처리): 성찰적 관찰(-) ↔ 능동적 실험(+)'
    },

    // ---------- 영역 ④ 공부 접근과 목표(심화형) ----------
    {
      id: 'approach', area: 4, set: 'deep', format: 'profile',
      parts: {
        deep: { name: '깊은 이해', lean: '뜻과 연결을 이해하려는 편', studyTip: '배운 내용을 내 말로 설명하고 다른 단원과 연결해 봐.' },
        surface: { name: '표면 암기', lean: '시험에 필요한 만큼 외우는 편', studyTip: '외우기 전에 "왜 그런지"를 한 줄 적어 이해와 함께 저장해.' },
        achieving: { name: '전략적 관리', lean: '계획과 효율을 챙기는 편', studyTip: '계획에 "이해 확인" 시간을 꼭 넣어 봐.' }
      }
    },
    {
      id: 'goal', area: 4, set: 'deep', format: 'profile',
      parts: {
        masteryApproach: { name: '숙달 접근', lean: '새로 알게 되는 게 즐거운 편', studyTip: '어제보다 나아진 점을 기록해 봐.' },
        masteryAvoid: { name: '숙달 회피', lean: '제대로 모를까 봐 걱정하는 편', studyTip: '틀린 문제는 배울 기회로 보고 오답 노트에 남겨.' },
        performanceApproach: { name: '수행 접근', lean: '잘 해내고 싶은 마음이 큰 편', studyTip: '결과뿐 아니라 과정 목표도 함께 세워 봐.' },
        performanceAvoid: { name: '수행 회피', lean: '못해 보일까 봐 조심하는 편', studyTip: '모르는 건 작게라도 질문해 보는 연습을 해 봐.' }
      }
    },

    // ---------- 영역 ⑤ 생체 리듬(심화형) ----------
    {
      id: 'chrono', area: 5, set: 'deep', format: 'forced',
      left: {
        key: 'morning', name: '아침형', lean: '아침·오전에 집중이 잘 되는 편',
        desc: '하루 앞쪽에 머리가 맑아.',
        studyTip: '어려운 과목을 오전이나 등교 전 시간에 배치해 봐.'
      },
      right: {
        key: 'evening', name: '저녁형', lean: '저녁·밤에 집중이 잘 되는 편',
        desc: '하루 뒤쪽으로 갈수록 집중이 살아나.',
        studyTip: '어려운 과목은 저녁에 두되, 잠자는 시간은 일정하게 지켜.'
      }
    }
  ];

  const L = (id, dim, text, reverse) => ({ id, dim, set: 'basic', format: 'likert', text, reverse: !!reverse });
  const F = (id, dim, a, b, set) => ({ id, dim, set: set || 'basic', format: 'forced', a, b });
  const M = (id, text, V, A, R, K) => ({
    id, dim: 'vark', set: 'basic', format: 'multi', text,
    options: [{ key: 'V', text: V }, { key: 'A', text: A }, { key: 'R', text: R }, { key: 'K', text: K }]
  });
  const P = (id, dim, part, text) => ({ id, dim, part, set: 'deep', format: 'likert', text, reverse: false });

  SM.data.styleQuestions = [
    // ① fieldDep (동의 → 장 독립)
    L('fd1', 'fieldDep', '공부할 땐 혼자 조용한 곳이 더 잘 맞아.'),
    L('fd2', 'fieldDep', '친구들과 같이 있는 곳에서 공부가 더 잘 돼.', true),
    L('fd3', 'fieldDep', '문제를 보면 핵심 조건만 따로 뽑아내는 편이야.'),
    L('fd4', 'fieldDep', '선생님이나 친구 반응에 따라 의욕이 달라져.', true),

    // ① tempo (동의 → 반성형)
    L('tp1', 'tempo', '답을 고르기 전에 다른 보기도 끝까지 확인해.'),
    L('tp2', 'tempo', '답이 떠오르면 문제를 끝까지 안 읽고 고를 때가 있어.', true),
    L('tp3', 'tempo', '시간이 걸려도 틀리지 않는 게 더 중요해.'),
    L('tp4', 'tempo', '숙제를 빨리 끝내고 나중에 실수를 발견하곤 해.', true),

    // ① perception (동의 → 직관형)
    L('pc1', 'perception', '공식을 외우기보다 왜 그렇게 되는지가 궁금해.'),
    L('pc2', 'perception', '정해진 순서대로 풀면 되는 문제가 마음 편해.', true),
    L('pc3', 'perception', '배운 걸 새로운 상황에 바꿔 써 보는 게 재밌어.'),
    L('pc4', 'perception', '구체적인 숫자나 사실이 나오는 내용이 잘 외워져.', true),

    // ① reasoning (a 귀납 / b 연역)
    F('rs1', 'reasoning', '예제를 먼저 풀어 보고 규칙을 알아낼래.', '개념 설명을 먼저 듣고 예제를 풀래.'),
    F('rs2', 'reasoning', '여러 사례를 보다 보면 공통점이 보여.', '원리를 알면 사례는 저절로 이해돼.'),
    F('rs3', 'reasoning', '새 공식은 문제에 넣어 보면서 익혀.', '새 공식은 어디서 나왔는지부터 확인해.'),
    F('rs4', 'reasoning', '개념 정리보다 풀이 예시가 더 도움 돼.', '풀이 예시보다 개념 정리가 더 도움 돼.'),

    // ① processing (a 능동 / b 성찰)
    F('pr1', 'processing', '모르는 건 친구랑 얘기하면서 풀어.', '모르는 건 혼자 곰곰이 생각해 봐.'),
    F('pr2', 'processing', '새 내용은 문제부터 풀어 보며 익혀.', '새 내용은 먼저 충분히 읽고 생각해.'),
    F('pr3', 'processing', '모둠 활동에서 먼저 의견을 내는 편이야.', '모둠 활동에서 듣고 정리하는 편이야.'),
    F('pr4', 'processing', '배운 걸 누군가에게 설명하면 정리가 돼.', '배운 걸 혼자 써 보면 정리가 돼.'),

    // ② input (a 시각 / b 언어)
    F('in1', 'input', '그림이나 도표로 보면 잘 이해돼.', '글이나 말로 설명을 들으면 잘 이해돼.'),
    F('in2', 'input', '지난 수업은 칠판 그림이 먼저 떠올라.', '지난 수업은 선생님 말이 먼저 떠올라.'),
    F('in3', 'input', '길을 물으면 지도로 보여 주는 게 좋아.', '길을 물으면 말로 설명해 주는 게 좋아.'),
    F('in4', 'input', '필기할 때 화살표나 도형을 많이 그려.', '필기할 때 문장으로 꼼꼼히 적어.'),

    // ② vark (복수 선택)
    M('vk1', '처음 보는 개념을 익힐 때 도움 되는 건?',
      '그림이나 도표로 정리된 자료', '선생님·친구의 설명 듣기', '교과서·설명글 꼼꼼히 읽기', '직접 문제를 풀거나 만들어 보기'),
    M('vk2', '시험 직전 복습할 때 주로 하는 건?',
      '마인드맵이나 표 다시 보기', '소리 내어 읽거나 설명하기', '요약 노트 읽고 다시 쓰기', '기출 문제 직접 풀기'),
    M('vk3', '새 앱 사용법을 익힐 때는?',
      '그림 있는 화면 안내 보기', '아는 사람에게 물어보기', '설명서 글 읽기', '일단 이것저것 눌러 보기'),
    M('vk4', '기억에 오래 남는 수업은?',
      '영상·그림 자료가 많은 수업', '토론·발표가 많은 수업', '읽고 쓰는 활동이 많은 수업', '실험·실습이 있는 수업'),

    // ③ order (동의 → 총체형) — 신뢰도가 낮아 6문항, 경향으로만 표시
    L('od1', 'order', '단원을 시작할 때 전체 흐름부터 훑어봐.'),
    L('od2', 'order', '한 단계를 확실히 알아야 다음으로 넘어가.', true),
    L('od3', 'order', '헷갈리다가 어느 순간 한 번에 이해될 때가 많아.'),
    L('od4', 'order', '교과서 순서대로 차근차근 하는 게 편해.', true),
    L('od5', 'order', '세부 내용보다 단원끼리 연결이 먼저 궁금해.'),
    L('od6', 'order', '풀이는 한 줄씩 순서대로 적어야 안심돼.', true),

    // ③ kolb 축1 perceive (동의 → 추상적 개념)
    L('kp1', 'kolbPerceive', '느낌보다 논리로 따져 보며 이해하는 편이야.'),
    L('kp2', 'kolbPerceive', '직접 겪어 본 경험이 있어야 확 와닿아.', true),

    // ③ kolb 축2 process (동의 → 능동적 실험)
    L('kx1', 'kolbProcess', '배운 건 바로 문제나 생활에 써 봐야 직성이 풀려.'),
    L('kx2', 'kolbProcess', '새로 배운 건 한동안 생각해 본 뒤에 써 봐.', true),

    // ---------- 심화형 12문항 ----------
    // ④ approach
    P('ap1', 'approach', 'deep', '외우기 전에 내용을 내 말로 이해하려고 해.'),
    P('ap2', 'approach', 'deep', '배운 내용을 다른 과목과 연결해 보곤 해.'),
    P('ap3', 'approach', 'surface', '시험에 나올 것만 골라서 외우는 편이야.'),
    P('ap4', 'approach', 'surface', '이해가 안 돼도 일단 통째로 외워 둬.'),
    P('ap5', 'approach', 'achieving', '공부 시간과 순서를 미리 계획해서 지켜.'),
    P('ap6', 'approach', 'achieving', '같은 시간에 더 많이 하는 방법을 찾아 써.'),

    // ④ goal
    P('gl1', 'goal', 'masteryApproach', '어려워도 새로 알게 되는 게 즐거워.'),
    P('gl2', 'goal', 'masteryAvoid', '배운 걸 제대로 이해 못 할까 봐 걱정돼.'),
    P('gl3', 'goal', 'performanceApproach', '공부를 잘 해낸다는 걸 보여 주고 싶어.'),
    P('gl4', 'goal', 'performanceAvoid', '못해 보일까 봐 질문을 참을 때가 있어.'),

    // ⑤ chrono (a 아침 / b 저녁)
    F('ch1', 'chrono', '집중이 제일 잘 되는 건 아침·오전이야.', '집중이 제일 잘 되는 건 저녁·밤이야.', 'deep'),
    F('ch2', 'chrono', '주말에도 일찍 일어나는 게 어렵지 않아.', '주말엔 늦게 자고 늦게 일어나게 돼.', 'deep')
  ];

  // ---------- 약점 문항(5점 척도, 4점 이상이면 '해당') ----------

  SM.data.weaknessThreshold = 4;
  SM.data.commonWeaknessKey = '공통';

  SM.data.weaknessQuestions = {
    수학: [
      { id: 'wm1', code: 'MATH_SELECT', text: '문제를 보면 어떤 풀이법을 쓸지 모르겠어.' },
      { id: 'wm2', code: 'MATH_PROCESS', text: '해설을 봐도 풀이 과정을 따라가기 어려워.' },
      { id: 'wm3', code: 'MATH_BASIC', text: '기초 계산이나 공식에서 자주 막혀.' },
      { id: 'wm4', code: 'MATH_CARELESS', text: '아는 문제인데 실수로 틀릴 때가 많아.' }
    ],
    영어: [
      { id: 'we1', code: 'ENG_VOCAB', text: '단어를 외워도 며칠 지나면 금방 잊어.' },
      { id: 'we2', code: 'ENG_CONFUSE', text: '철자나 발음이 비슷한 단어가 자주 헷갈려.' },
      { id: 'we3', code: 'ENG_GRAMMAR', text: '문법 규칙은 아는데 문장에 적용이 안 돼.' },
      { id: 'we4', code: 'ENG_READING', text: '지문을 다 읽어도 요지가 잘 안 잡혀.' }
    ],
    국어: [
      { id: 'wk1', code: 'KOR_STRUCTURE', text: '비문학 지문의 구조와 요지를 잡기 어려워.' },
      { id: 'wk2', code: 'KOR_APPLY', text: '문학 개념어를 외워도 작품에 적용이 안 돼.' },
      { id: 'wk3', code: 'KOR_MEMORIZE', text: '문법·어법은 외울 게 너무 많아서 벅차.' },
      { id: 'wk4', code: 'KOR_ILLUSION', text: '읽을 땐 이해한 것 같은데 문제를 풀면 틀려.' }
    ],
    과학: [
      { id: 'ws1', code: 'SCI_RELATION', text: '개념끼리 어떻게 연결되는지 헷갈려.' },
      { id: 'ws2', code: 'SCI_MISCONCEPT', text: '평소 생각과 다른 과학 개념이 잘 안 받아들여져.' },
      { id: 'ws3', code: 'SCI_TERMS', text: '과학 용어나 기호가 잘 안 외워져.' },
      { id: 'ws4', code: 'SCI_APPLY', text: '실험이나 계산 문제에 개념을 적용하기 어려워.' }
    ],
    사회: [
      { id: 'wo1', code: 'SOC_RECALL', text: '외울 게 많아서 시험 때 기억이 잘 안 나.' },
      { id: 'wo2', code: 'SOC_ORDER', text: '시대 순서나 사건 순서가 자주 뒤섞여.' },
      { id: 'wo3', code: 'SOC_CAUSAL', text: '사건·제도의 원인과 결과를 비교하기 어려워.' }
    ],
    // 어떤 과목을 고르든 마지막에 한 번만 묻는다.
    공통: [
      { id: 'wa1', code: 'ANY_ANXIETY', text: '시험만 보면 긴장해서 아는 것도 틀려.' }
    ]
  };

  // 학생에게 보여 줄 한 문장(능력 판단이 아니라 '다음에 할 일'로 쓴다)
  SM.data.weaknessLabels = {
    MATH_SELECT: '문제를 보고 풀이법을 고르는 연습이 필요해.',
    MATH_PROCESS: '풀이 과정을 한 단계씩 따라가는 연습이 필요해.',
    MATH_BASIC: '기초 연산과 공식을 다지는 시간이 필요해.',
    MATH_CARELESS: '아는 문제를 실수 없이 마무리하는 습관이 필요해.',
    ENG_VOCAB: '단어를 오래 기억하는 복습 방법이 필요해.',
    ENG_CONFUSE: '비슷한 단어를 구별하는 정리가 필요해.',
    ENG_GRAMMAR: '문법 규칙을 문장에 적용하는 연습이 필요해.',
    ENG_READING: '지문의 요지를 잡는 읽기 연습이 필요해.',
    KOR_STRUCTURE: '비문학 지문의 구조를 잡는 연습이 필요해.',
    KOR_APPLY: '문학 개념어를 작품에 적용하는 연습이 필요해.',
    KOR_MEMORIZE: '문법·어법을 나눠서 외우는 계획이 필요해.',
    KOR_ILLUSION: '이해했는지 스스로 확인하는 습관이 필요해.',
    SCI_RELATION: '개념 사이의 관계를 정리하는 시간이 필요해.',
    SCI_MISCONCEPT: '평소 생각과 과학 개념을 비교해 보는 시간이 필요해.',
    SCI_TERMS: '용어와 기호를 꾸준히 익히는 복습이 필요해.',
    SCI_APPLY: '개념을 실험·계산 문제에 적용하는 연습이 필요해.',
    SOC_RECALL: '외운 내용을 꺼내 보는 인출 연습이 필요해.',
    SOC_ORDER: '사건을 시간 순서로 엮는 정리가 필요해.',
    SOC_CAUSAL: '원인과 결과를 비교하는 정리가 필요해.',
    ANY_ANXIETY: '시험 긴장을 다루는 준비가 필요해.'
  };
})(window.SM = window.SM || {});
