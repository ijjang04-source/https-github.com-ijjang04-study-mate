# 공부 메이트

고등학생이 학습 스타일 진단 → 맞춤 전략 → 월·주·일 플래너 → 자기 점검 → 재진단을 혼자서도 돌릴 수 있게 돕는 브라우저용 규칙 기반 챗봇.

- 선생님용 안내서: [docs/teacher-guide.md](docs/teacher-guide.md)
- 학생용 한 장 안내: [docs/student-guide.md](docs/student-guide.md)
- 반 서버(우리 반 피드를 기기끼리 공유) 설정: [docs/remote-setup.md](docs/remote-setup.md)
- 통합 점검 결과: [docs/QA.md](docs/QA.md)

## 실행 방법

`index.html`을 브라우저로 연다. (더블클릭으로 `file://`에서 열어도 동작한다. 서버나 설치가 필요 없다.)

## 테스트 방법

```
node tests/run.js
```

Node.js가 없으면 `tests/tests.html`을 브라우저로 열어 같은 테스트를 실행한다.
1년치 가짜 데이터로 화면 속도를 재려면 `tests/perf.html`을 연다(실제 기록은 건드리지 않는다).

## GitHub Pages 배포

빌드 과정이 없다. 저장소 루트의 `index.html`이 그대로 첫 화면이 된다. 모든 경로가 상대 경로라 `https://아이디.github.io/저장소이름/` 아래에서 그대로 동작한다.

### 배포 전 체크리스트

`js/config.js`는 배포하면 **누구나 볼 수 있다**. 아래를 꼭 확인한다.

- [ ] **체험용 학교 `DEMO`를 지운다.** `schools`의 `{ id: 'DEMO', name: '체험용 학교' }`와 `classes`의 DEMO 1학년 1반 줄(체험 코드 `1234`)을 지운다. 남겨 두면 누구나 코드 `1234`로 입장할 수 있다.
- [ ] **실제 학교를 넣는다.** `schools`에 `{ id: '학교코드', name: '학교 이름' }`을 넣는다. 학교코드는 영문·숫자만 쓴다(예: `SM01`).
- [ ] **반마다 새 입장 코드를 만든다.** `#/teacher` 화면에서 해시를 만들어 `classes`에 붙여 넣는다([선생님용 안내서](docs/teacher-guide.md) 1~2장). 예시나 체험용 해시는 쓰지 않는다.
- [ ] **코드 원문은 어디에도 적지 않는다.** config.js·커밋 메시지·README·이슈에 숫자 코드를 쓰지 않는다. 해시만 넣는다.
- [ ] **짧은 숫자 코드의 한계를 안다.** 4~6자리 숫자는 해시만 봐도 컴퓨터로 금방 알아낼 수 있다. 입장 코드는 "다른 반 학생이 실수로 들어오지 않게 하는 문"이지 비밀번호가 아니다. 반 밖으로 알려지면 새 코드로 바꾼다.
- [ ] **금칙어를 채운다.** `bannedWords`는 지금 예시 3개뿐이다. 학교에서 쓸 목록으로 채운다(소문자, 공백 없이).
- [ ] **반 서버를 쓸지 정한다.** 쓰면 `remote`에 Apps Script 웹 앱 URL을 넣고 `classes` 시트의 코드를 `config.js`와 같게 맞춘다([docs/remote-setup.md](docs/remote-setup.md)). 안 쓰면 `remote: null` 그대로 둔다.
- [ ] **과목·자동 로그아웃 기본값을 확인한다.** `subjects`, `autoLogoutMinutes`(공용 기기 권장 30분).
- [ ] **위기 대응 문구를 확인한다.** `crisis.lines`의 상담 안내(청소년 상담 1388, 자살예방 상담 109)와 학교 상담실 안내가 맞는지 확인한다.
- [ ] `node tests/run.js`가 모두 통과하는지 확인한다. DEMO를 지운 설정에서는 "어느 반도 체험 코드 1234를 받지 않는다"를 테스트가 함께 확인한다.

### 배포 절차

1. **GitHub에 저장소를 만들고 push한다.**
   ```
   git remote add origin https://github.com/아이디/study-mate.git
   git push -u origin main
   ```
2. GitHub 저장소 → **Settings → Pages**로 간다.
3. **Build and deployment**에서 Source: *Deploy from a branch*, Branch: **`main`**, 폴더: **`/ (root)`**를 고르고 **Save**를 누른다.
4. 1~2분 뒤 같은 화면 위쪽에 나오는 **주소**(`https://아이디.github.io/study-mate/`)를 확인하고 열어 본다.

참고:
- 루트의 `.nojekyll` 파일은 GitHub Pages가 Jekyll로 파일을 바꾸지 않고 그대로 내보내게 한다. 지우지 않는다.
- `tests/`, `docs/`도 함께 공개된다. 개인 데이터는 들어 있지 않다. `tests/tests.html`, `tests/perf.html`에는 검색 엔진이 담지 않도록 `noindex`를 넣어 두었다.
- 학생 기록은 서버로 가지 않고 **각 기기 브라우저에만** 저장된다. `file://`로 열어 쓰던 기록은 https 주소로 옮겨지지 않는다(설정 → 내보내기/불러오기로 옮긴다).
- 같은 GitHub 계정의 다른 Pages 사이트(`아이디.github.io/다른저장소`)와 브라우저 저장소를 함께 쓴다. 이 계정에는 믿을 수 있는 사이트만 올린다. 학교용으로는 이 앱 전용 계정·조직을 쓰는 것이 좋다.

### 배포 뒤 확인할 것

| 확인 | 방법 | 기대 결과 |
|---|---|---|
| https 주소에서 SHA-256 해시로 입장 | 배포 주소에서 실제 반·코드로 입장 | 입장된다. https에서는 브라우저가 SHA-256을 쓸 수 있어 SHA-256 해시로 비교한다(대체 해시만 넣어도 입장된다) |
| 틀린 코드는 막힘 | 다른 숫자로 입장 | "입장 코드가 맞지 않아"와 남은 기회 |
| DEMO가 사라졌는지 | 입장 화면의 학교 목록 | '체험용 학교'가 없다 |
| 휴대폰에서 열림 | 학생 휴대폰(안드로이드 크롬, 아이폰 사파리)으로 주소 열기 | 가로로 밀리지 않고 글자가 읽힌다 |
| 모바일 홈 화면에서 열림 | 크롬: ⋮ → **홈 화면에 추가** / 사파리: 공유 → **홈 화면에 추가** → 아이콘으로 열기 | 같은 주소가 열리고 입장 상태·기록이 유지된다(홈 화면 아이콘과 브라우저는 같은 기록을 쓴다. 단, 아이폰은 홈 화면 앱과 사파리의 기록이 따로일 수 있다) |
| 새로고침·재방문 | 입장 → 플래너에 블록 추가 → 새로고침 | 입장과 블록이 그대로 |
| 시크릿 창 | 시크릿 창으로 열어 입장 | 동작은 하지만 창을 닫으면 기록이 사라진다(학생에게 일반 창을 쓰라고 안내) |

## 폴더 구조

```
index.html
.nojekyll          GitHub Pages가 파일을 그대로 내보내게 함
css/style.css
js/
  config.js        학교·반·입장 코드 해시, 과목, 금칙어, 위기 대응 문구
  ui.js            DOM 헬퍼(el, clear, toast, debounce), 공용 컴포넌트
  dateutil.js      ISO 날짜·주차 계산
  store.js         localStorage 래퍼
  auth.js          입장·세션, #/teacher
  data/questions.js
  data/strategies.js
  data/intents.js  챗봇 키워드 사전
  test.js          기능 1 진단
  recommend.js     기능 2 추천 계산
  strategy-view.js 기능 2 화면
  planner.js       기능 3
  checkin.js       기능 4
  remote.js        반 서버 어댑터(Apps Script·테스트용 가짜)
  feed.js          반 피드·댓글(반 서버가 있으면 로컬 사본 + 보낼 목록)
  chat.js          챗봇 엔진
  settings.js      설정·백업
  app.js           라우터·초기화 (마지막에 로드)
tests/
  assert.js        최소 assert 함수
  run.js           node 테스트 러너 (외부 패키지 없음)
  tests.html       브라우저 테스트 러너
  seed.js          1년치 가짜 데이터(성능 점검)
  perf.html        화면 그리기 시간 측정
  remote.test.js   반 서버 동기화(가짜 서버 두 기기)
  *.test.js
docs/
  QA.md            통합 점검 결과
  teacher-guide.md 선생님용 안내서
  student-guide.md 학생용 한 장 안내
  remote-setup.md  반 서버 설정(선생님용)
server/
  apps-script.gs   반 서버 코드(구글 시트의 Apps Script에 붙여 넣음, 앱에서 불러오지 않음)
```

개발 규칙은 `CLAUDE.md`를 따른다.
