# 공부 메이트 — 프로젝트 규칙

고등학생이 **학습 스타일 진단 → 맞춤 전략 → 월·주·일 플래너 → 자기 점검 → 재진단**을 혼자서도 돌릴 수 있게 돕는 브라우저용 챗봇이다.
전체 요구사항은 `docs/PRD.md`, 전략·문항의 학술 근거와 원자료는 `docs/research.md`에 있다. 두 파일이 있으면 작업을 시작하기 전에 해당 장을 먼저 읽는다. 없으면 각 단계 프롬프트에 적힌 사양을 기준으로 한다(프롬프트에 필요한 사양이 모두 들어 있다).

## 1. 기술 규칙 (반드시 지킨다)

- **순수 HTML / CSS / JavaScript만 쓴다.** 프레임워크, 번들러, 트랜스파일러, CSS 프레임워크, CDN 라이브러리, npm 런타임 의존성을 쓰지 않는다.
- **ES 모듈을 쓰지 않는다.** `<script type="module">`, `import`, `export` 금지. `index.html`을 `file://`로 더블클릭해 열어도 동작해야 한다.
- 모든 JS 파일은 즉시 실행 함수(IIFE)로 감싸고, 공개할 것만 전역 네임스페이스 `window.SM`에 등록한다.
  ```js
  (function (SM) {
    'use strict';
    // ...
    SM.store = { get, set, update, remove };
  })(window.SM = window.SM || {});
  ```
- 문법은 ES2017까지(async/await, 화살표 함수, 템플릿 리터럴 허용). 옵셔널 체이닝 `?.`과 `??`는 써도 된다(최신 브라우저 대상).
- 라우팅은 `location.hash`(`#/chat`, `#/test` …)로 한다.
- 차트는 `<canvas>` 또는 CSS 막대로 직접 그린다.

## 2. 저장 규칙

- `localStorage`를 직접 부르지 않는다. 항상 `SM.store`를 거친다.
- 키 접두사는 `sm:v1:`이다. 키 목록과 객체 형식은 `docs/PRD.md` 10장을 따른다.
- 개인 데이터 키에는 학생 ID(`<sid>` = `학교코드-학년-반-번호`, 예: `SM01-2-3-15`)를, 반 공유 데이터 키에는 반 ID(`<classId>` = `SM01-2-3`)를 붙인다.
- 입력 화면은 500ms 디바운스로 자동 저장하고 '저장됨'을 표시한다. 저장 버튼에 의존하지 않는다.
- 날짜는 ISO 문자열(`2026-11-13`), 주차는 ISO 주 번호(`2026-W46`, 월요일 시작)로 통일한다.
- 전략·문항·약점은 고정 ID로 저장하고, 표시 문구는 `js/data/`에서 찾는다.

## 3. 보안·개인정보

- **사용자가 입력한 문자열은 `textContent`나 `SM.ui.el()`로만 화면에 넣는다.** `innerHTML`에는 개발자가 쓴 정적 템플릿만 넣는다.
- 실명, 연락처, 생년월일을 받지 않는다. 출석번호와 닉네임만 받는다.
- 입장 코드는 원문이 아니라 SHA-256 해시로 `config.js`에 둔다. `crypto.subtle`을 쓸 수 없는 환경(`file://`)에서는 `SM.auth`의 대체 해시 함수를 쓴다.

## 4. UI·문구 규칙

- 화면 문구는 모두 한국어로 쓴다. 챗봇은 친근한 반말을 쓰고, 말풍선 하나에 2문장 이내로 쓴다.
- **학습 스타일 결과에 "너는 ○○형" 같은 단일 라벨을 쓰지 않는다.** 차원별 스펙트럼과 "~하는 편" 같은 표현을 쓴다.
- 성적이나 능력을 판단하는 말, 학생 간 순위나 비교를 만들지 않는다.
- 모바일 우선이다. 폭 360px에서 가로 스크롤이 생기면 안 된다. 본문 글자는 16px 이상, 터치 영역은 44px 이상으로 한다.
- 색만으로 정보를 전달하지 않는다. 숫자나 글자를 함께 쓴다.

## 5. 파일 구조

```
index.html
css/style.css
js/
  config.js        학교·반·입장 코드 해시, 과목, 금칙어
  ui.js            DOM 헬퍼(el, clear, toast, debounce), 공용 컴포넌트
  dateutil.js      ISO 날짜·주차 계산
  store.js         localStorage 래퍼
  auth.js          입장·세션
  data/questions.js
  data/strategies.js
  test.js          기능 1 진단
  recommend.js     기능 2 추천 계산
  strategy-view.js 기능 2 화면
  planner.js       기능 3
  checkin.js       기능 4
  feed.js          반 피드·댓글
  chat.js          챗봇 엔진
  settings.js      설정·백업
  app.js           라우터·초기화 (마지막에 로드)
tests/
  assert.js        최소 assert 함수
  run.js           node 테스트 러너 (외부 패키지 없음)
  tests.html       브라우저 테스트 러너
  *.test.js
docs/PRD.md, docs/research.md
```

`index.html`의 스크립트 로드 순서: `config → ui → dateutil → store → auth → data/* → recommend → test → strategy-view → planner → checkin → feed → chat → settings → app`.

## 6. 결정된 사항

- **저장소**: MVP는 `localStorage`만 쓴다(PRD 2.4의 A단계). 시범 운영 뒤 원격 저장소(C단계)로 옮긴다. 그래서 반 공유 데이터는 반 ID 키에만 둔다.
- **입장 코드**: 교사가 반마다 하나씩 정하는 **반 공용 코드**다. 학생 개인 번호가 아니다.
- **챗봇**: 생성형 AI 없이 규칙 기반(시나리오 + 빠른 답변 칩 + 키워드)으로 만든다.

## 7. 작업 방식

1. 단계를 시작하면 이 파일과 (있으면) `docs/PRD.md`의 해당 장을 읽고, 무엇을 만들지 5줄 이내로 계획을 먼저 말한다.
2. 이미 있는 코드의 패턴(IIFE, `SM.ui.el`, `SM.store`)을 그대로 따른다.
3. 계산 로직(채점, 추천, 지표, 날짜)은 반드시 `tests/`에 테스트를 추가한다.
4. 끝나면 `node tests/run.js`를 실행해 모두 통과하는지 확인한다.
5. 변경한 파일, 브라우저에서 확인하는 방법, 남은 문제를 짧게 요약한다.
6. 단계마다 한 번 커밋한다. 메시지 형식은 `stepNN: 요약`이다.
