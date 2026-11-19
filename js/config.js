(function (SM) {
  'use strict';

  SM.config = {
    schools: [
      { id: 'SM01', name: '숙명고등학교' },
      { id: 'DEMO', name: '체험용 학교' }
    ],

    // 반마다 하나인 '반 공용 입장 코드'의 해시.
    // 교사는 #/teacher에서 만든 해시를 여기 붙여 넣는다. 코드 원문은 절대 적지 않는다.
    // codeHash는 문자열 하나 또는 배열(SHA-256과 'fb:' 대체 해시를 함께 넣으면
    // crypto.subtle을 못 쓰는 file:// 환경에서도 입장할 수 있다).
    classes: [
      // DEMO 1학년 1반, 체험용 코드 '1234'
      {
        school: 'DEMO', grade: 1, cls: 1,
        codeHash: [
          '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
          'fb:8a7bf4ee8c9762990847fd1905d3c8f9'
        ]
      }
    ],

    subjects: ['국어', '영어', '수학', '과학', '사회'],

    // 닉네임·글에 쓸 수 없는 말(소문자, 공백 없이 비교). 실제 목록은 운영 전에 채운다.
    bannedWords: ['바보', '멍청이', 'stupid'],

    autoLogoutMinutes: 30,

    // 챗봇이 자해·자살 관련 표현을 알아들었을 때의 응답(말풍선 하나에 한 줄씩).
    // 학교 사정에 맞게 문구와 연락처를 바꿀 수 있다.
    crisis: {
      lines: [
        '그렇게까지 힘들다니 정말 걱정돼. 말해 줘서 고마워.',
        '담임 선생님이나 상담 선생님께 꼭 이야기해 줘. 혼자 견디지 않아도 돼.',
        '지금 바로 이야기하고 싶으면 청소년 상담 1388, 자살예방 상담 109에 전화해 줘. 24시간 받아.'
      ],
      choices: [
        { label: '1388 전화하기', href: 'tel:1388' },
        { label: '109 전화하기', href: 'tel:109' }
      ]
    },

    botName: '공부 메이트'
  };
})(window.SM = window.SM || {});
