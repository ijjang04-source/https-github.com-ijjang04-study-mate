(function (SM) {
  'use strict';

  SM.data = SM.data || {};

  // 챗봇 자유 입력 키워드 사전.
  // 입력은 공백을 지우고 소문자로 바꾼 뒤 비교하므로, 여기 낱말도 공백 없이 쓴다.
  // 여러 의도가 맞으면 order 순서가 우선이다. crisis(위기 표현)는 언제나 가장 먼저 본다.
  SM.data.intents = {
    // 자해·자살 관련 표현: 다른 처리보다 먼저 응답한다(응답 문구는 config.crisis).
    crisis: ['죽고싶', '죽고만싶', '죽어버리', '죽을래', '자살', '자해', '사라지고싶', '없어지고싶', '살기싫', '살고싶지않', '극단적선택', '목숨을끊'],

    order: ['distress', 'test', 'strategy', 'planner', 'check', 'class', 'settings', 'strategyName'],

    keywords: {
      distress: ['힘들', '하기싫', '불안', '망했', '망한', '지쳐', '지쳤', '짜증', '걱정돼', '무서워'],
      test: ['스타일', '테스트', '검사', '유형', '진단'],
      strategy: ['전략', '방법', '어떻게공부', '공부법'],
      planner: ['계획', '플래너', '오늘', '이번주', '이번달', '다음주'],
      check: ['점검', '돌아보기', '실천', '리포트'],
      // '반'은 '반복'·'반박'에도 들어 있어서 그대로 쓰지 않고, 입력이 '반'뿐일 때만 맞힌다(exact).
      class: ['친구', '우리반', '다른애들', '반친구', '반애들', '다른친구'],
      settings: ['설정', '챗봇이름', '이름바꾸']
    },
    exact: { class: ['반'] },

    // 불안 쪽 낱말이면 표현적 글쓰기를, 그 밖에는 작은 블록을 권한다.
    anxious: ['불안', '걱정돼', '무서워'],

    // 플래너 화면 고르기
    plannerViews: [['이번달', 'month'], ['이번주', 'week'], ['다음주', 'week'], ['오늘', 'day']],

    // 과목 별칭 → config.subjects 이름
    subjectAliases: {
      국어: ['국어', '문학', '비문학', '독서'],
      영어: ['영어', '영단어', '영문법'],
      수학: ['수학', '수1', '수2', '미적분', '확통'],
      과학: ['과학', '물리', '화학', '생명', '지구과학', '통합과학'],
      사회: ['사회', '한국사', '역사', '통합사회', '지리', '윤리']
    },

    // 전략 이름 외에 학생이 부를 법한 별칭(공백 없이)
    strategyAliases: {
      chunking: ['묶기', '청킹'],
      acronym: ['두문자'],
      loci: ['장소법', '기억의궁전'],
      keyword: ['핵심단어', '키워드법'],
      automation: ['자동화'],
      elaboration: ['정교화'],
      elabQuestion: ['왜질문', '정교화질문'],
      selfExplain: ['자기설명'],
      examples: ['예시만들기', '구체적예시'],
      workedExample: ['풀이예제', '예제학습'],
      refutation: ['반박텍스트'],
      teach: ['강의하기', '언어화', '설명하기'],
      organize: ['조직화'],
      conceptMap: ['개념도', '마인드맵'],
      dualCoding: ['이중부호화', '그림과글'],
      imagery: ['심상'],
      retrieval: ['인출', '떠올리기', '백지복습'],
      spacing: ['분산', '간격복습'],
      interleave: ['교차', '섞어풀기'],
      pretest: ['사전시험', '미리풀기'],
      errorLog: ['오답'],
      metacog: ['메타인지'],
      planDoc: ['학습계획서'],
      ifThen: ['실행의도'],
      woop: ['woop', '우프'],
      timeEnv: ['환경관리', '시간관리'],
      effort: ['노력조절'],
      helpSeek: ['도움구하기', '질문하기'],
      havruta: ['하브루타'],
      coop: ['협동학습', '멘토링'],
      expressiveWriting: ['표현적글쓰기', '걱정쓰기'],
      reciprocal: ['상보적독해', '상보적']
    }
  };
})(window.SM = window.SM || {});
