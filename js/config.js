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

    autoLogoutMinutes: 30
  };
})(window.SM = window.SM || {});
