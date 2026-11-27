(function (SM) {
  'use strict';

  SM.config = {
    schools: [
      { id: 'SM01', name: '숙명고등학교' },
      { id: 'AFLS', name: '안양외국어고등학교' }
    ],

    // 반마다 하나인 '반 공용 입장 코드'의 해시.
    // 교사는 #/teacher에서 만든 해시를 여기 붙여 넣는다. 코드 원문은 절대 적지 않는다.
    // codeHash는 문자열 하나 또는 배열(SHA-256과 'fb:' 대체 해시를 함께 넣으면
    // crypto.subtle을 못 쓰는 file:// 환경에서도 입장할 수 있다).
    classes: [
      { school: 'SM01', grade: 1, cls: 1, codeHash: 'bcb15f821479b4d5772bd0ca866c00ad5f926e3580720659cc80d39c9d09802a' },
      { school: 'AFLS', grade: 2, cls: 7, codeHash: ['6195df46a1ee6b6984140dc3c3e6d772765010745d6c3f1ddd736ddbbd564cca', 'fb:592d2f066335f1f5ab3faafee7de8515'] }
    ],

    subjects: ['국어', '영어', '수학', '과학', '사회'],

    // 닉네임·글에 쓸 수 없는 말(소문자, 공백 없이 비교). 실제 목록은 운영 전에 채운다.
    bannedWords: ['바보', '멍청이', 'stupid'],

    autoLogoutMinutes: 30,

    // 반 서버(원격 저장소). 없으면(null) 우리 반 피드는 이 기기 안에서만 보인다.
    // 설정법: docs/remote-setup.md. 예) remote: { type: 'apps-script', url: 'https://script.google.com/macros/s/…/exec' },
    remote: null,

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

    botName: '공부 메이트',

    version: '0.20.0'
  };
})(window.SM = window.SM || {});
