(function (SM) {
  'use strict';

  // 학습 전략·스타일별 실행 방식·보완 습관 데이터.
  // 전략은 고정 id로 저장하고 화면 문구는 여기서 찾는다.

  SM.data = SM.data || {};

  // ---------- 스타일 극 키 ----------
  // `${dimId}:L|R`, vark:V|A|R|K, kolb:<type>, approach:surface, goal:avoid, chrono:morning|evening
  SM.data.poleKeys = [
    'fieldDep:L', 'fieldDep:R', 'tempo:L', 'tempo:R', 'perception:L', 'perception:R',
    'reasoning:L', 'reasoning:R', 'processing:L', 'processing:R', 'input:L', 'input:R',
    'order:L', 'order:R',
    'vark:V', 'vark:A', 'vark:R', 'vark:K',
    'kolb:diverging', 'kolb:assimilating', 'kolb:converging', 'kolb:accommodating',
    'approach:surface', 'goal:avoid', 'chrono:morning', 'chrono:evening'
  ];

  SM.data.strategyCategories = {
    A: '암기·입력',
    B: '이해·정교화',
    C: '조직화·시각화',
    D: '인출·연습 스케줄',
    E: '메타인지·자원 관리',
    F: '사회적·정서'
  };

  // 플래너 공부 방식(plannerDefaults.modes에 쓰는 값)
  SM.data.plannerModes = {
    recall: '떠올리기',
    solve: '문제 풀기',
    read: '읽기',
    write: '정리·쓰기',
    talk: '말하기·설명',
    review: '복습',
    plan: '계획·점검'
  };

  // ---------- 전략 32개 ----------
  SM.data.strategies = [
    // ===== A 암기·입력 =====
    {
      id: 'chunking', name: '묶기', category: 'A', evidence: 1,
      why: '흩어진 정보를 규칙이나 의미로 묶으면 한 번에 기억할 덩어리 수가 줄어들어.',
      howTo: ['외울 항목을 쭉 적어 봐.', '공통 규칙이나 뜻이 같은 것끼리 3~5개씩 묶어.', '묶음마다 이름을 붙이고 이름부터 떠올려 봐.'],
      weakness: ['KOR_MEMORIZE'],
      subjects: 'all',
      fitsStyle: [],
      checkQuestions: ['외울 내용을 의미나 규칙으로 묶었나?', '묶음 이름만 보고 안의 항목을 떠올려 봤나?'],
      source: 'Miller(1956) 기억 용량과 청킹 연구',
      plannerDefaults: { minutes: 20, modes: ['write', 'recall'] }
    },
    {
      id: 'acronym', name: '두문자법', category: 'A', evidence: 1,
      why: '머리글자를 따서 리듬 있게 외우면 순서와 항목을 함께 꺼내기 쉬워져.',
      howTo: ['외울 항목의 첫 글자를 순서대로 뽑아.', '소리 내어 읽기 좋은 말이나 리듬으로 만들어.', '머리글자만 보고 원래 항목을 말해 봐.'],
      weakness: ['KOR_MEMORIZE', 'SOC_ORDER'],
      subjects: 'all',
      fitsStyle: [],
      checkQuestions: ['머리글자로 기억 단서를 만들었나?', '단서만 보고 원래 항목을 모두 떠올렸나?'],
      source: '기억술(mnemonics) 연구 개관, Bellezza(1981)',
      plannerDefaults: { minutes: 15, modes: ['write', 'recall'] }
    },
    {
      id: 'loci', name: '장소법', category: 'A', evidence: 1,
      why: '익숙한 장소의 길을 따라 항목을 놓으면 그 길을 떠올리는 것만으로 순서가 살아나.',
      howTo: ['집이나 등굣길처럼 익숙한 경로를 정해.', '경로의 장소마다 외울 항목을 하나씩 놓는다고 상상해.', '머릿속으로 길을 걸으며 항목을 꺼내 봐.'],
      weakness: ['SOC_ORDER'],
      subjects: 'all',
      fitsStyle: ['input:L', 'vark:V'],
      checkQuestions: ['익숙한 장소에 외울 항목을 순서대로 놓았나?', '장소를 따라가며 항목을 순서대로 떠올렸나?'],
      source: '장소법(method of loci) 연구, Bower(1970)',
      plannerDefaults: { minutes: 20, modes: ['recall'] }
    },
    {
      id: 'keyword', name: '핵심 단어법', category: 'A', evidence: 1,
      why: '낯선 단어를 비슷한 소리의 이미지와 이어 주면 기억 단서가 생겨. 꼭 떠올리기 연습과 함께 써.',
      howTo: ['외울 단어와 소리가 비슷한 우리말을 찾아.', '그 우리말과 뜻을 하나의 장면으로 그려 봐.', '며칠 뒤 장면 없이 뜻을 떠올려 확인해.'],
      weakness: ['ENG_CONFUSE'],
      subjects: 'all',
      fitsStyle: ['input:L', 'vark:V'],
      checkQuestions: ['헷갈리는 단어마다 이미지 단서를 만들었나?', '단서 없이도 뜻을 떠올려 확인했나?'],
      source: 'Atkinson(1975) 키워드 기억법 연구',
      plannerDefaults: { minutes: 15, modes: ['write', 'recall'] }
    },
    {
      id: 'automation', name: '자동화', category: 'A', evidence: 1,
      why: '기초 계산이나 용어가 자동으로 나오면 머리를 더 어려운 생각에 쓸 수 있어.',
      howTo: ['자주 막히는 기초 계산·공식·용어를 골라.', '짧은 세트로 매일 반복해 풀어.', '시간을 재서 빨라지는지 확인해.'],
      weakness: ['MATH_BASIC', 'SCI_TERMS'],
      subjects: 'all',
      fitsStyle: ['perception:L'],
      checkQuestions: ['기초 문제 세트를 정해진 양만큼 반복했나?', '어제보다 빠르거나 정확해졌는지 확인했나?'],
      source: '인지 부하 이론과 기초 기능 자동화, Sweller(1988)',
      plannerDefaults: { minutes: 15, modes: ['solve'] }
    },

    // ===== B 이해·정교화 =====
    {
      id: 'elaboration', name: '정교화', category: 'B', evidence: 2,
      why: '내 말로 바꿔 쓰고 이미 아는 것과 이어 주면 새 내용이 기억 속에 단단히 걸려.',
      howTo: ['배운 내용을 교과서 문장 말고 내 말로 바꿔 적어.', '전에 배운 것 중 연결되는 걸 하나 찾아 옆에 적어.', '둘이 어떻게 이어지는지 한 문장으로 써 봐.'],
      weakness: ['KOR_APPLY'],
      subjects: 'all',
      fitsStyle: ['input:R', 'vark:R'],
      checkQuestions: ['배운 내용을 내 말로 바꿔 적었나?', '이미 아는 내용과 연결해 봤나?'],
      source: 'Weinstein & Mayer(1986) 학습 전략 분류',
      plannerDefaults: { minutes: 25, modes: ['write'] }
    },
    {
      id: 'elabQuestion', name: '정교화 질문', category: 'B', evidence: 2,
      why: '"왜 그럴까?"를 스스로 묻고 답하면 사실을 외우는 데서 끝나지 않고 이유까지 이해하게 돼.',
      howTo: ['읽은 내용에서 사실 하나를 골라.', '"왜 그럴까?"라고 묻고 답을 적어 봐.', '답이 막히면 교과서에서 근거를 찾아 고쳐.'],
      weakness: ['KOR_APPLY', 'SOC_CAUSAL'],
      subjects: 'all',
      fitsStyle: ['perception:R', 'approach:surface'],
      checkQuestions: ['"왜 그럴까?" 질문을 스스로 만들었나?', '그 질문에 내 말로 답해 봤나?'],
      source: 'Dunlosky 외(2013) 학습 전략 효과 개관: 정교화 질문',
      plannerDefaults: { minutes: 20, modes: ['write'] }
    },
    {
      id: 'selfExplain', name: '자기 설명', category: 'B', evidence: 2,
      why: '풀이나 문장을 한 단계씩 스스로 설명하면 내가 놓친 단계와 실수를 찾을 수 있어.',
      howTo: ['풀이나 예문을 한 줄씩 읽어.', '줄마다 "이건 왜 이렇게 했지?"를 설명해 봐.', '설명이 막힌 줄에 표시하고 다시 확인해.'],
      weakness: ['MATH_PROCESS', 'MATH_CARELESS'],
      subjects: 'all',
      fitsStyle: ['tempo:L', 'tempo:R', 'approach:surface'],
      checkQuestions: ['풀이를 한 단계씩 스스로 설명했나?', '설명이 막힌 단계를 표시했나?'],
      source: 'Chi 외(1994) 자기 설명 효과 연구',
      plannerDefaults: { minutes: 25, modes: ['solve', 'talk'] }
    },
    {
      id: 'examples', name: '구체적 예시 만들기', category: 'B', evidence: 2,
      why: '추상적인 개념도 내 예시를 붙이면 언제 어디에 쓰는지 보이기 시작해.',
      howTo: ['어려운 개념을 하나 골라.', '그 개념이 드러나는 내 예시를 2개 만들어.', '예시가 개념 정의와 맞는지 확인해.'],
      weakness: ['KOR_APPLY', 'SCI_RELATION'],
      subjects: 'all',
      fitsStyle: ['perception:L', 'approach:surface', 'kolb:diverging', 'kolb:accommodating'],
      checkQuestions: ['개념마다 내 예시를 2개씩 만들었나?', '예시가 정의와 맞는지 확인했나?'],
      source: 'Rawson 외(2015) 구체적 예시 학습 연구',
      plannerDefaults: { minutes: 20, modes: ['write'] }
    },
    {
      id: 'workedExample', name: '풀이 예제 학습', category: 'B', evidence: 2,
      why: '완성된 풀이를 먼저 익히면 처음부터 헤매는 시간이 줄고 풀이 틀이 잡혀.',
      howTo: ['완성된 풀이 예제를 단계별로 읽어.', '풀이를 가리고 같은 문제를 다시 풀어 봐.', '숫자나 조건만 바꾼 비슷한 문제를 풀어.'],
      weakness: ['MATH_PROCESS', 'SCI_APPLY', 'ENG_GRAMMAR'],
      subjects: 'all',
      fitsStyle: ['reasoning:L', 'perception:L', 'order:L'],
      checkQuestions: ['풀이 예제를 익힌 뒤 가리고 다시 풀었나?', '비슷한 문제를 이어서 풀어 봤나?'],
      source: 'Sweller & Cooper(1985) 풀이 예제 효과',
      plannerDefaults: { minutes: 30, modes: ['read', 'solve'] }
    },
    {
      id: 'refutation', name: '반박 텍스트', category: 'B', evidence: 2,
      why: '흔한 오개념을 꺼내 놓고 왜 틀렸는지 따지면 잘못된 생각이 바뀌기 쉬워.',
      howTo: ['내가 헷갈렸던 생각을 그대로 적어.', '그 생각이 왜 틀렸는지 근거를 적어.', '올바른 설명을 내 말로 정리해.'],
      weakness: ['SCI_MISCONCEPT'],
      subjects: 'all',
      fitsStyle: ['perception:R'],
      checkQuestions: ['헷갈렸던 생각을 적고 틀린 이유를 밝혔나?', '올바른 설명을 내 말로 정리했나?'],
      source: 'Tippett(2010) 반박 텍스트 연구 개관',
      plannerDefaults: { minutes: 20, modes: ['write'] }
    },
    {
      id: 'teach', name: '강의하기·언어화', category: 'B', evidence: 2,
      why: '남에게 설명하거나 백지에 꺼내 보면 안다고 착각한 부분이 바로 드러나.',
      howTo: ['책을 덮고 백지에 아는 걸 모두 적거나 그려.', '친구나 가상의 후배에게 소리 내어 설명해.', '막힌 부분을 책에서 확인하고 다시 설명해.'],
      weakness: ['KOR_ILLUSION', 'MATH_CARELESS'],
      subjects: 'all',
      fitsStyle: ['input:R', 'processing:L', 'vark:A', 'fieldDep:L'],
      checkQuestions: ['배운 내용을 누군가에게 설명하거나 백지에 적어 봤나?', '설명하다 막힌 부분을 다시 확인했나?'],
      source: 'Fiorella & Mayer(2013) 가르치며 배우기 연구',
      plannerDefaults: { minutes: 20, modes: ['talk', 'recall'] }
    },

    // ===== C 조직화·시각화 =====
    {
      id: 'organize', name: '조직화', category: 'C', evidence: 2,
      why: '표·비교표·연표로 정리하면 흩어진 내용의 순서와 차이가 한눈에 보여.',
      howTo: ['비교하거나 순서를 따질 항목을 골라.', '표나 연표의 칸을 먼저 만들어.', '칸을 채운 뒤 빈칸만 남겨 다시 채워 봐.'],
      weakness: ['SOC_ORDER', 'SOC_CAUSAL'],
      subjects: 'all',
      fitsStyle: ['input:L', 'vark:V', 'vark:R', 'order:L'],
      checkQuestions: ['내용을 표·비교표·연표로 정리했나?', '정리한 표를 가리고 다시 채워 봤나?'],
      source: 'Weinstein & Mayer(1986) 조직화 전략',
      plannerDefaults: { minutes: 25, modes: ['write'] }
    },
    {
      id: 'conceptMap', name: '개념도 그리기', category: 'C', evidence: 2,
      why: '개념을 점과 화살표로 직접 이으면 개념 사이 관계를 스스로 따지게 돼.',
      howTo: ['단원의 핵심 개념을 5~10개 적어.', '관계가 있는 개념끼리 화살표로 잇고 관계를 적어.', '책을 덮고 개념도를 다시 그려 봐.'],
      weakness: ['SCI_RELATION', 'SOC_CAUSAL', 'KOR_STRUCTURE'],
      subjects: 'all',
      fitsStyle: ['input:L', 'order:R', 'vark:V'],
      checkQuestions: ['개념을 화살표로 잇고 관계를 적었나?', '책을 덮고 개념도를 다시 그려 봤나?'],
      source: 'Nesbit & Adesope(2006) 개념도 메타분석',
      plannerDefaults: { minutes: 30, modes: ['write'] }
    },
    {
      id: 'dualCoding', name: '이중 부호화', category: 'C', evidence: 2,
      why: '글과 그림을 함께 쓰면 기억할 길이 두 개가 돼서 더 잘 떠올라.',
      howTo: ['글로 된 설명을 그림이나 도식으로 바꿔 그려.', '그린 도식을 보며 말로 설명해.', '글과 그림이 같은 내용인지 비교해.'],
      weakness: ['SCI_RELATION'],
      subjects: 'all',
      fitsStyle: ['input:L', 'vark:V', 'vark:K'],
      checkQuestions: ['글 내용을 그림이나 도식으로 바꿔 봤나?', '도식을 보며 말로 설명했나?'],
      source: 'Paivio(1971) 이중 부호화 이론, Mayer 멀티미디어 학습',
      plannerDefaults: { minutes: 20, modes: ['write', 'talk'] }
    },
    {
      id: 'imagery', name: '심상', category: 'C', evidence: 1,
      why: '내용을 머릿속 그림으로 떠올리면 글로만 읽을 때보다 장면으로 기억에 남아.',
      howTo: ['읽은 내용을 한 장면으로 상상해.', '장면에서 중요한 부분을 간단히 그려.', '그림을 보고 원래 내용을 말해 봐.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['input:L', 'vark:V'],
      checkQuestions: ['내용을 머릿속 장면으로 떠올려 봤나?', '그 장면으로 원래 내용을 다시 말해 봤나?'],
      source: 'Dunlosky 외(2013) 학습 전략 효과 개관: 심상',
      plannerDefaults: { minutes: 15, modes: ['recall'] }
    },

    // ===== D 인출·연습 스케줄 =====
    {
      id: 'retrieval', name: '인출 연습', category: 'D', evidence: 3,
      why: '책을 덮고 떠올리는 순간 기억이 강해져서, 다시 읽기보다 훨씬 오래 남아.',
      howTo: ['공부한 범위를 정하고 책을 덮어.', '쪽지 시험·플래시카드·백지 쓰기로 떠올려.', '떠올리지 못한 것만 표시하고 다시 확인해.'],
      weakness: ['SOC_RECALL', 'ENG_VOCAB', 'ENG_CONFUSE', 'SCI_TERMS', 'KOR_MEMORIZE', 'KOR_APPLY', 'KOR_ILLUSION'],
      subjects: 'all',
      fitsStyle: ['fieldDep:R', 'processing:R', 'tempo:L', 'reasoning:R', 'vark:A', 'vark:R', 'kolb:assimilating', 'kolb:converging'],
      checkQuestions: ['책을 덮고 떠올린 시간이 다시 읽은 시간보다 길었나?', '떠올리지 못한 것을 표시했나?'],
      source: 'Roediger & Karpicke(2006) 시험 효과 연구',
      plannerDefaults: { minutes: 25, modes: ['recall'] }
    },
    {
      id: 'spacing', name: '분산 학습', category: 'D', evidence: 3,
      why: '한 번에 몰아서 하는 것보다 며칠 간격으로 나눠 복습할 때 훨씬 오래 기억해.',
      howTo: ['오늘 공부한 내용의 복습 날짜를 1일·3일·7일 뒤로 잡아.', '복습할 때는 먼저 떠올려 보고 확인해.', '잘 기억나면 다음 간격을 늘려.'],
      weakness: ['ENG_VOCAB', 'MATH_BASIC', 'SOC_RECALL'],
      subjects: 'all',
      fitsStyle: [],
      checkQuestions: ['이 내용을 지난 며칠 중 다른 날에도 복습했나?', '다음 복습 날짜를 정했나?'],
      source: 'Cepeda 외(2006) 분산 학습 메타분석',
      plannerDefaults: { minutes: 15, modes: ['review', 'recall'] }
    },
    {
      id: 'interleave', name: '교차 연습', category: 'D', evidence: 2.5,
      why: '여러 유형을 섞어 풀면 문제마다 "어떤 방법을 쓸지"부터 고르는 힘이 길러져.',
      howTo: ['서로 다른 단원이나 유형 문제를 몇 개씩 골라.', '순서를 섞어서 풀어.', '풀기 전에 어떤 방법을 쓸지 먼저 적어.'],
      weakness: ['MATH_SELECT', 'SCI_APPLY', 'ENG_GRAMMAR'],
      subjects: 'all',
      fitsStyle: ['order:R', 'perception:R'],
      checkQuestions: ['서로 다른 단원 문제를 섞어서 풀었나?', '풀기 전에 어떤 방법을 쓸지 먼저 적었나?'],
      source: 'Rohrer & Taylor(2007) 교차 연습 연구',
      plannerDefaults: { minutes: 30, modes: ['solve'] }
    },
    {
      id: 'pretest', name: '사전 시험', category: 'D', evidence: 2,
      why: '배우기 전에 먼저 풀어 보고 틀려 보면, 이어지는 수업에서 답을 더 잘 붙잡아.',
      howTo: ['새 단원 문제를 배우기 전에 몇 개 풀어 봐.', '틀려도 괜찮으니 내 생각대로 답을 적어.', '수업 뒤 같은 문제를 다시 풀어 비교해.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['goal:avoid'],
      checkQuestions: ['새 단원을 배우기 전에 문제를 먼저 풀어 봤나?', '배운 뒤 같은 문제를 다시 풀어 비교했나?'],
      source: 'Kornell 외(2009) 사전 시험 효과 연구',
      plannerDefaults: { minutes: 15, modes: ['solve'] }
    },
    {
      id: 'errorLog', name: '오답 분석', category: 'D', evidence: 2,
      why: '틀린 문제를 유형별로 모으면 내가 반복해서 틀리는 패턴이 보여.',
      howTo: ['틀린 문제를 오답 노트에 옮겨.', '틀린 이유를 개념·실수·시간 부족 중에 골라 분류해.', '같은 유형을 다시 풀어 확인해.'],
      weakness: ['MATH_CARELESS'],
      subjects: 'all',
      fitsStyle: ['tempo:L'],
      checkQuestions: ['틀린 문제의 이유를 분류해 적었나?', '같은 유형 문제를 다시 풀어 봤나?'],
      source: 'Metcalfe(2017) 오류에서 배우기 연구 개관',
      plannerDefaults: { minutes: 20, modes: ['review', 'write'] }
    },

    // ===== E 메타인지·자원 관리 =====
    {
      id: 'metacog', name: '메타인지 점검', category: 'E', evidence: 2.5,
      why: '공부 전에 목표를 세우고 중간과 끝에 점검하면 이해한 것과 착각한 것을 구분할 수 있어.',
      howTo: ['시작 전에 "오늘 끝나면 무엇을 할 수 있어야 하는지" 적어.', '중간에 목표를 향해 가고 있는지 확인해.', '끝나고 안 된 부분과 다음 할 일을 적어.'],
      weakness: ['KOR_ILLUSION'],
      subjects: 'all',
      fitsStyle: ['fieldDep:R'],
      checkQuestions: ['공부 전에 목표를 적었나?', '끝난 뒤 이해한 것과 모르는 것을 나눠 적었나?'],
      source: 'Schraw & Dennison(1994) 메타인지 연구, EEF(2018) 메타인지 지침',
      plannerDefaults: { minutes: 10, modes: ['plan'] }
    },
    {
      id: 'planDoc', name: '학습 계획서', category: 'E', evidence: 2,
      why: '월·주·일로 나눠 계획하고 돌아보면 해야 할 일이 보이고 미루는 게 줄어.',
      howTo: ['월 목표를 정하고 주 단위로 나눠.', '주 목표를 하루 할 일로 쪼개.', '하루가 끝나면 반성란에 한 줄 적어.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['fieldDep:R', 'order:L'],
      checkQuestions: ['오늘 할 일을 계획에 적어 두었나?', '반성란에 오늘을 돌아보는 한 줄을 적었나?'],
      source: 'Zimmerman(2002) 자기조절 학습 연구',
      plannerDefaults: { minutes: 10, modes: ['plan'] }
    },
    {
      id: 'ifThen', name: '실행 의도', category: 'E', evidence: 2,
      why: '"언제·어디서 하면 무엇을 한다"를 정해 두면 그 순간에 자동으로 시작하기 쉬워져.',
      howTo: ['"○시가 되면 ○○을 한다" 형식으로 한 문장을 써.', '시간·장소·행동을 구체적으로 정해.', '그 시간이 오면 바로 시작해.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['chrono:morning', 'chrono:evening'],
      checkQuestions: ['"언제 하면 무엇을 한다"는 계획을 정했나?', '정한 시간에 바로 시작했나?'],
      source: 'Gollwitzer(1999) 실행 의도 연구',
      plannerDefaults: { minutes: 5, modes: ['plan'] }
    },
    {
      id: 'woop', name: 'WOOP', category: 'E', evidence: 2,
      why: '바라는 결과와 내 안의 장애물을 함께 떠올리면 막혔을 때 쓸 계획이 미리 생겨.',
      howTo: ['바라는 것과 그게 이뤄졌을 때 최상의 결과를 떠올려.', '그걸 막는 내 안의 장애물을 하나 찾아.', '"장애물이 생기면 ○○한다"고 정해.'],
      weakness: ['ANY_ANXIETY'],
      subjects: 'all',
      fitsStyle: ['goal:avoid'],
      checkQuestions: ['바라는 것과 내 안의 장애물을 적어 봤나?', '장애물이 생기면 할 행동을 정했나?'],
      source: 'Oettingen(2014) 정신적 대조와 실행 의도(WOOP) 연구',
      plannerDefaults: { minutes: 5, modes: ['plan'] }
    },
    {
      id: 'timeEnv', name: '시간·학습 환경 관리', category: 'E', evidence: 2,
      why: '공부 시간을 미리 예약하고 방해가 적은 자리를 정해 두면 집중을 시작하는 데 힘이 덜 들어.',
      howTo: ['하루 중 공부 블록을 미리 정해 계획에 적어.', '방해 요소가 적은 자리를 고정해.', '휴대폰은 손이 닿지 않는 곳에 둬.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['chrono:morning', 'chrono:evening', 'fieldDep:R'],
      checkQuestions: ['정한 시간에 정한 자리에서 공부했나?', '방해 요소를 미리 치웠나?'],
      source: 'Pintrich 외(1991) MSLQ 자원 관리 전략',
      plannerDefaults: { minutes: 5, modes: ['plan'] }
    },
    {
      id: 'effort', name: '노력 조절', category: 'E', evidence: 2,
      why: '지루하거나 어려워도 정한 분량까지 해내는 경험이 쌓이면 꾸준히 할 힘이 생겨.',
      howTo: ['시작 전에 오늘 분량을 숫자로 정해.', '지루해지면 남은 분량만 보고 이어 가.', '끝내면 체크하고 짧게 쉬어.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: [],
      checkQuestions: ['시작 전에 오늘 분량을 정했나?', '어려워도 정한 분량까지 해냈나?'],
      source: 'Pintrich 외(1991) MSLQ 노력 조절',
      plannerDefaults: { minutes: 30, modes: ['solve'] }
    },
    {
      id: 'helpSeek', name: '도움 구하기', category: 'E', evidence: 2,
      why: '막힌 지점을 구체적으로 물어보면 혼자 헤매는 시간이 줄고 필요한 답을 빨리 얻어.',
      howTo: ['어디서 막혔는지 문제와 줄을 표시해.', '"여기까지는 알겠는데 이 부분이 왜 이런지 모르겠어"처럼 질문을 적어.', '선생님이나 친구에게 물어보고 답을 기록해.'],
      weakness: ['MATH_PROCESS'],
      subjects: 'all',
      fitsStyle: ['fieldDep:L'],
      checkQuestions: ['막힌 지점을 구체적인 질문으로 적었나?', '그 질문을 누군가에게 물어봤나?'],
      source: 'Karabenick & Newman(2006) 학업적 도움 구하기 연구',
      plannerDefaults: { minutes: 10, modes: ['talk'] }
    },

    // ===== F 사회적·정서 =====
    {
      id: 'havruta', name: '하브루타', category: 'F', evidence: 2,
      why: '짝과 질문하고 따져 보면 서로 다른 생각을 맞춰 보며 이해가 깊어져.',
      howTo: ['짝과 같은 내용을 읽어.', '서로 질문을 하나씩 만들어 주고받아.', '의견이 다른 부분을 근거를 들어 따져 봐.'],
      weakness: ['SOC_CAUSAL'],
      subjects: 'all',
      fitsStyle: ['fieldDep:L', 'processing:L'],
      checkQuestions: ['짝과 질문을 주고받았나?', '의견이 다른 부분을 근거로 따져 봤나?'],
      source: 'Kent(2010) 하브루타 짝 학습 연구',
      plannerDefaults: { minutes: 30, modes: ['talk'] }
    },
    {
      id: 'coop', name: '멘토링·협동 학습', category: 'F', evidence: 2,
      why: '다른 강점을 가진 친구들과 역할을 나눠 배우면 서로 가르치며 함께 성장해.',
      howTo: ['서로 잘하는 게 다른 친구들과 조를 만들어.', '설명·질문·정리 같은 역할을 나눠.', '끝나면 각자 배운 점을 한 줄씩 말해.'],
      weakness: [],
      subjects: 'all',
      fitsStyle: ['fieldDep:L', 'processing:L'],
      checkQuestions: ['조에서 맡은 역할을 해냈나?', '친구에게 설명하거나 설명을 들었나?'],
      source: 'Johnson & Johnson(2009) 협동 학습 연구',
      plannerDefaults: { minutes: 40, modes: ['talk'] }
    },
    {
      id: 'expressiveWriting', name: '표현적 글쓰기', category: 'F', evidence: 2,
      why: '시험 직전에 걱정을 글로 쏟아 내면 걱정이 차지하던 머릿속 자리가 비워져.',
      howTo: ['시험 직전 10분, 걱정되는 걸 솔직하게 적어.', '맞춤법은 신경 쓰지 말고 계속 써.', '다 쓰면 종이를 접어 두고 시험에 집중해.'],
      weakness: ['ANY_ANXIETY'],
      subjects: 'all',
      fitsStyle: ['goal:avoid'],
      checkQuestions: ['시험이나 공부 전에 걱정을 글로 적어 봤나?', '적은 뒤 할 일에 다시 집중했나?'],
      source: 'Ramirez & Beilock(2011) 시험 전 표현적 글쓰기 연구',
      plannerDefaults: { minutes: 10, modes: ['write'] }
    },

    // ===== 과목 전용 =====
    {
      id: 'reciprocal', name: '상보적 독해', category: 'B', evidence: 2,
      why: '예측·질문·명료화·요약을 차례로 하면 지문을 수동적으로 읽지 않고 구조를 잡게 돼.',
      howTo: ['제목과 첫 문단으로 내용을 예측하고 질문을 만들어.', '헷갈리는 단어나 문장을 명료하게 풀어.', '문단마다 한 문장으로 요약해.'],
      weakness: ['KOR_STRUCTURE', 'ENG_READING'],
      subjects: ['국어', '영어'],
      fitsStyle: ['vark:R', 'input:R'],
      checkQuestions: ['읽기 전에 내용을 예측하고 질문을 만들었나?', '문단마다 한 문장으로 요약했나?'],
      source: 'Palincsar & Brown(1984) 상보적 교수 연구',
      plannerDefaults: { minutes: 30, modes: ['read', 'write'] }
    }
  ];

  // ---------- 스타일별 실행 방식 ----------
  // retrieval: 인출 연습을 이렇게, understand: 정리·이해는 이렇게, complement: 보완할 점,
  // place: 추천 장소(있을 때만), with: '혼자' | '함께'(있을 때만)
  const W = {};

  W['fieldDep:L'] = {
    retrieval: '친구와 서로 문제를 내 주거나 스터디 퀴즈로 떠올려 봐.',
    understand: '하브루타나 멘토링처럼 함께 묻고 설명하며 정리해.',
    complement: '주 1회는 혼자 실전처럼 모의 시험을 풀어 봐.',
    place: '교실이나 스터디 공간', with: '함께'
  };
  W['fieldDep:R'] = {
    retrieval: '앱이나 카드로 혼자 자기 시험을 봐.',
    understand: '스스로 목표와 체크리스트를 정해 정리해.',
    complement: '개념도를 그려서 맥락과 관계를 놓치지 않게 해.',
    place: '조용한 자습실이나 집 책상', with: '혼자'
  };
  W['tempo:L'] = {
    retrieval: '짧고 빠른 퀴즈를 여러 번 봐.',
    understand: '풀이를 소리 내어 설명하며 정리해.',
    complement: '소거법과 검토 루틴을 쓰고, 오답 유형을 기록해.'
  };
  W['tempo:R'] = {
    retrieval: '서술형이나 열린 질문으로 떠올려 봐.',
    understand: '한 단계씩 깊이 있게 자기 설명을 해.',
    complement: '타이머로 시간 연습을 하고, 쉬운 문제부터 풀어.'
  };
  W['input:L'] = {
    retrieval: '백지에 도식이나 그림으로 떠올려 봐.',
    understand: '개념도·표·연표로 정리해.',
    complement: '지문과 지시문을 꼼꼼히 읽는 연습도 해.'
  };
  W['input:R'] = {
    retrieval: '입으로 설명하면서 떠올려 봐.',
    understand: '내 말로 요약하며 정리해.',
    complement: '자료나 그래프를 해석하는 연습도 해.'
  };
  W['order:L'] = {
    retrieval: '단계별로 순서대로 퀴즈를 봐.',
    understand: '목차 순서대로 노트를 정리해.',
    complement: '단원 전체 맵으로 큰 그림도 확인해.'
  };
  W['order:R'] = {
    retrieval: '단원을 합친 문제나 섞인 문제로 떠올려 봐.',
    understand: '마인드맵으로 큰 그림을 먼저 잡고 세부는 나중에 채워.',
    complement: '요소별 퀴즈로 세부 내용이 빠지지 않게 해.'
  };
  W['perception:L'] = {
    retrieval: '기출이나 표준 문제집으로 떠올려 봐.',
    understand: '구체적인 사례와 데이터로 정리해.',
    complement: '원리를 묻는 "왜?" 질문을 하나씩 더해.'
  };
  W['perception:R'] = {
    retrieval: '응용·사고력 문제로 떠올려 봐.',
    understand: '원리 중심으로 이해해.',
    complement: '반복 암기와 자동화 분량을 챙기고, 시험 범위를 점검해.'
  };
  W['reasoning:L'] = {
    retrieval: '예제에서 규칙을 찾는 퀴즈를 봐.',
    understand: '풀이 예제 여러 개를 비교하며 정리해.',
    complement: '찾은 규칙을 문장으로 정리해 둬.'
  };
  W['reasoning:R'] = {
    retrieval: '규칙과 공식을 먼저 떠올린 뒤 문제에 적용해.',
    understand: '개념 → 적용 순서로 정리해.',
    complement: '예외 사례와 변형 문제도 풀어 봐.'
  };
  W['processing:L'] = {
    retrieval: '바로 문제를 풀거나 친구에게 문제를 내 봐.',
    understand: '토론하면서 정리해.',
    complement: '풀기 전에 1분만 개념을 확인해.',
    with: '함께'
  };
  W['processing:R'] = {
    retrieval: '혼자 백지에 떠올려 봐.',
    understand: '읽고 요약한 뒤에 적용해.',
    complement: '시간 제한을 둬서 생각만 하고 안 푸는 일을 막아.',
    with: '혼자'
  };
  W['vark:V'] = Object.assign({}, W['input:L']);
  W['vark:A'] = {
    retrieval: '소리 내어 답하거나 녹음한 퀴즈로 떠올려 봐.',
    understand: '강의를 듣거나 토론하며 정리해.',
    complement: '필기로 한 번 더 정리해.'
  };
  W['vark:R'] = {
    retrieval: '서술형 인출이나 빈칸 채우기로 떠올려 봐.',
    understand: '요약 노트나 목록으로 정리해.',
    complement: '도표나 그래프 해석도 더해.'
  };
  W['vark:K'] = {
    retrieval: '실제 문제·실험·모형으로 확인해.',
    understand: '손으로 그리거나 움직이며 정리해.',
    complement: '개념을 말이나 글로 옮겨 봐.'
  };
  const kolbExperience = {
    retrieval: '사례나 실제 상황 문제로 떠올려 봐.',
    understand: '경험을 먼저 하고 개념으로 넘어가.',
    complement: '개념 정리 단계를 건너뛰지 마.'
  };
  const kolbConcept = {
    retrieval: '개념과 공식을 먼저 떠올린 뒤 적용해.',
    understand: '개념을 먼저 잡고 사례로 넘어가.',
    complement: '실제 사례와 응용 문제도 더해.'
  };
  W['kolb:diverging'] = Object.assign({}, kolbExperience);
  W['kolb:accommodating'] = Object.assign({}, kolbExperience);
  W['kolb:assimilating'] = Object.assign({}, kolbConcept);
  W['kolb:converging'] = Object.assign({}, kolbConcept);
  W['approach:surface'] = {
    retrieval: '"왜?"가 들어간 질문으로 떠올려 봐.',
    understand: '자기 설명과 구체적 예시로 정리해.',
    complement: '통째로 외우는 비중을 조금씩 줄여.'
  };
  W['goal:avoid'] = {
    retrieval: '틀려도 괜찮은 가벼운 퀴즈로 떠올려 봐.',
    understand: '사전 시험으로 틀리는 경험에 익숙해져.',
    complement: '남이 아닌 내 기준으로 목표를 정하고, WOOP과 표현적 글쓰기를 써 봐.'
  };
  W['chrono:evening'] = {
    retrieval: '저녁 시간대에 어려운 과목을 떠올려 봐.',
    understand: '오전에는 가벼운 복습을 해.',
    complement: '잠자는 시간을 지키고, 시험 시간대에 맞추는 연습도 해.'
  };
  W['chrono:morning'] = {
    retrieval: '아침·오전에 어려운 과목을 떠올려 봐.',
    understand: '저녁에는 가벼운 복습을 해.',
    complement: '저녁 늦게까지 무리하지 마.'
  };

  SM.data.styleWays = W;

  // ---------- 보완 습관 ----------
  // complement 문구를 하나의 실천 습관으로. pole은 대표 극, poles는 이 습관을 쓰는 모든 극.
  const H = (id, poles, name, howTo, checkQuestion) =>
    ({ id, pole: poles[0], poles, name, howTo, checkQuestion });

  SM.data.habits = [
    H('soloMock', ['fieldDep:L'], '주 1회 혼자 실전 모의',
      '일주일에 한 번, 혼자 시간을 재고 실전처럼 문제를 풀어.', '이번 주에 혼자 실전처럼 모의 문제를 풀었나?'),
    H('contextMap', ['fieldDep:R'], '개념도로 관계 잇기',
      '단원이 끝날 때 개념도를 그려 개념 사이 관계를 확인해.', '이번 단원 개념을 개념도로 이어 봤나?'),
    H('reviewRoutine', ['tempo:L'], '제출 전 검토 루틴',
      '답을 내기 전에 조건 다시 읽기 → 소거법 → 계산 확인 순서로 검토해.', '제출 전에 정한 순서대로 검토했나?'),
    H('timerPractice', ['tempo:R'], '타이머 연습',
      '문제마다 목표 시간을 정하고 쉬운 문제부터 시간 안에 풀어.', '목표 시간 안에 문제를 풀었나?'),
    H('readingDrill', ['input:L', 'vark:V'], '지시문 꼼꼼히 읽기',
      '문제를 풀기 전에 지문과 지시문의 핵심 조건에 밑줄을 그어.', '풀기 전에 지시문의 조건에 밑줄을 그었나?'),
    H('chartRead', ['input:R'], '자료·그래프 해석',
      '하루 한 개, 표나 그래프를 보고 무엇을 말하는지 한 문장으로 써.', '표나 그래프를 보고 한 문장으로 해석했나?'),
    H('bigPictureMap', ['order:L'], '단원 전체 맵 보기',
      '단원을 시작하거나 끝낼 때 목차를 한 장 맵으로 그려 큰 그림을 확인해.', '단원 전체를 한 장 맵으로 확인했나?'),
    H('detailQuiz', ['order:R'], '세부 요소 퀴즈',
      '큰 그림을 잡은 뒤 요소별로 짧은 퀴즈를 만들어 빠진 세부를 확인해.', '세부 요소를 퀴즈로 확인했나?'),
    H('whyQuestion', ['perception:L'], '"왜?" 질문 하나 더하기',
      '외운 사실마다 "왜 그럴까?"를 하나씩 붙여 답해 봐.', '외운 내용에 "왜?" 질문을 붙여 답했나?'),
    H('drillVolume', ['perception:R'], '반복 분량 챙기기',
      '원리를 이해한 뒤 정해진 양만큼 계산·암기 문제를 반복하고 시험 범위를 점검해.', '정한 반복 분량을 채웠나?'),
    H('ruleSentence', ['reasoning:L'], '규칙을 문장으로',
      '예제에서 찾은 규칙을 한 문장으로 적어 개념 설명과 비교해.', '찾은 규칙을 문장으로 적었나?'),
    H('exceptionCases', ['reasoning:R'], '예외·변형 문제',
      '공식을 적용한 뒤 예외 사례나 조건이 바뀐 변형 문제를 하나 더 풀어.', '예외나 변형 문제를 풀어 봤나?'),
    H('conceptCheck', ['processing:L'], '풀기 전 1분 개념 확인',
      '문제를 풀기 전에 1분 동안 관련 개념을 떠올려 적어.', '풀기 전에 개념을 1분 확인했나?'),
    H('timeLimit', ['processing:R'], '시간 제한 두기',
      '생각하는 시간에 제한을 두고, 시간이 되면 일단 풀기 시작해.', '정한 시간이 되면 바로 풀기 시작했나?'),
    H('writeAgain', ['vark:A'], '필기로 한 번 더',
      '듣거나 말로 정리한 내용을 짧게 필기로 한 번 더 남겨.', '말로 정리한 내용을 필기로도 남겼나?'),
    H('chartAdd', ['vark:R'], '도표 해석 더하기',
      '요약 노트에 관련 도표나 그래프를 하나씩 붙여 해석해.', '노트에 도표나 그래프 해석을 더했나?'),
    H('verbalize', ['vark:K'], '말·글로 옮기기',
      '해 본 활동을 개념 용어를 써서 말이나 글로 설명해.', '해 본 내용을 개념 용어로 설명했나?'),
    H('conceptStep', ['kolb:diverging', 'kolb:accommodating'], '개념 정리 단계 지키기',
      '경험이나 사례를 본 뒤 꼭 개념 정의를 정리하는 단계를 거쳐.', '사례를 본 뒤 개념 정리까지 했나?'),
    H('applyCases', ['kolb:assimilating', 'kolb:converging'], '사례·응용 더하기',
      '개념을 정리한 뒤 실제 사례나 응용 문제를 하나 더 풀어.', '개념을 사례나 응용 문제에 적용해 봤나?'),
    H('lessRote', ['approach:surface'], '통째 암기 줄이기',
      '외우기 전에 이유를 한 줄 적어서 이해와 함께 외워.', '외우기 전에 이유를 한 줄 적었나?'),
    H('lowStakes', ['goal:avoid'], '틀려도 되는 퀴즈',
      '점수와 상관없는 가벼운 퀴즈로 틀리는 경험을 자주 해.', '틀려도 괜찮은 퀴즈를 풀어 봤나?'),
    H('sleepGuard', ['chrono:evening'], '수면 시간 지키기',
      '저녁에 공부해도 잠드는 시간은 정해 두고, 시험 시간대에도 문제를 풀어 봐.', '정한 시간에 잠자리에 들었나?'),
    H('noLateNight', ['chrono:morning'], '늦은 밤 무리하지 않기',
      '저녁 늦게는 가벼운 복습만 하고 어려운 과목은 아침으로 옮겨.', '늦은 밤에 무리하지 않고 정리했나?')
  ];
})(window.SM = window.SM || {});
