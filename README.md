# 공부 메이트

고등학생이 학습 스타일 진단 → 맞춤 전략 → 월·주·일 플래너 → 자기 점검 → 재진단을 혼자서도 돌릴 수 있게 돕는 브라우저용 규칙 기반 챗봇.

## 실행 방법

`index.html`을 브라우저로 연다. (더블클릭으로 `file://`에서 열어도 동작한다. 서버나 설치가 필요 없다.)

## 테스트 방법

```
node tests/run.js
```

Node.js가 없으면 `tests/tests.html`을 브라우저로 열어 같은 테스트를 실행한다.

## 폴더 구조

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
docs/              PRD.md, research.md (추가 예정)
```

개발 규칙은 `CLAUDE.md`를 따른다.
