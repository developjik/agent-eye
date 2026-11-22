# agent-eye

**AI 에이전트가 읽는 페이지를 재는 Lighthouse.** URL 하나를 주면, 브라우저 에이전트가 그 페이지에서 실제로 얼마를 지불하고 무엇을 보는지 알려줍니다. 스텝당 토큰, 페이지의 잡음 비율, 가만히 있어도 흔들리는 정도, 델타 전송으로 아낄 수 있는 여지, 그리고 "성공"이라고 보고되지만 아무것도 바꾸지 않은 클릭의 비율까지.

로컬에서, 결정론적으로 동작합니다. LLM 호출 없음, 텔레메트리 없음. TypeScript + Playwright.

[English README](README.md) · [CI](../../actions/workflows/ci.yml) · MIT

```
$ agent-eye https://your.app/checkout

Observation bill (one step)
mode                                         bytes     tokens  vs cheapest
raw HTML (page.content())                    1.2 MB  212,904 tok        ×260
readability text (article extraction)         38 KB    7,645 tok         ×9.3
ARIA snapshot (Playwright, full tree)         61 KB   11,338 tok        ×13.8
compact interactive refs (names + states)    3.9 KB      821 tok         ×1.0
screenshot 1x 1280x2400 (vision estimate)    684 KB    3,165 tok         ×3.9

noise             37% of 19 analyzed · 3 elements in 1 duplicate cluster
occluded          2 controls covered at their click point
idle churn        6/6 samples changed · 7.7% of lines · 2,453 tokens rescanned in 1.5s
delta headroom    92.1% saved if only changed lines were sent
action truth      3/6 effective · 1 no-effect (16.7% false success) · 2 blocked
```

## 드라이버가 아니라 페이지를 재는 이유

브라우저 에이전트는 페이지를 스냅샷으로 봅니다. 접근성 트리, 마크다운 덩어리, 또는 스크린샷이죠. 드라이버는 빠르게 좋아지고 있지만, 드라이버가 읽는 **페이지**는 아직 아무도 재지 않습니다. 그 틈은 가장 인기 있는 드라이버의 이슈로 드러납니다.

- [`agent-browser#2094`](https://github.com/vercel-labs/agent-browser/issues/2094): 응답마다 붙는 lifecycle 객체가 **세션당 약 1만 토큰**을 더합니다
- [`#2096`](https://github.com/vercel-labs/agent-browser/issues/2096): 이미지 토큰을 줄이려면 스크린샷 축소 옵션이 필요합니다
- [`#2652`](https://github.com/vercel-labs/agent-browser/issues/2652), [`#1926`](https://github.com/vercel-labs/agent-browser/issues/1926), [`#2000`](https://github.com/vercel-labs/agent-browser/issues/2000): 명령이 **성공을 보고하고 아무것도 바꾸지 않습니다**
- [`#2653`](https://github.com/vercel-labs/agent-browser/issues/2653): 앞 48자가 같은 행들이 똑같은 힌트를 받습니다

이 문제들은 페이지 입장에서 보이지 않고, 여러분의 CI에도 없습니다. `agent-eye`는 모델이 개입하기 전, **에이전트가 받는 그대로의 페이지**를 잽니다. 규칙 기반의 결정론적 에이전트가 여러분의 체크아웃을 조작할 수 없다면, 더 좋은 모델이 와도 해결되지 않습니다.

## 빠른 시작

아직 npm에 배포되지 않아 소스에서 실행합니다.

```bash
git clone https://github.com/developjik/agent-eye
cd agent-eye
npm install
npx playwright install chromium      # Chromium이 이미 있으면 생략
npm run build

node dist/bin/agent-eye.js demo      # 내장 데모 스토어프론트를 프로파일링
node dist/bin/agent-eye.js https://your.app/checkout --out agent-eye-report
```

`agent-eye profile <url>`도 같은 명령입니다. 리포트는 `agent-eye-report/`에 `report.json`, `report.md`로 떨어지고, `--html` 또는 `--format json,md,html`을 주면 스타일과 스크린샷이 인라인된 단일 HTML 파일과 `screenshot.png`도 함께 나옵니다.

자주 쓰는 플래그:

```bash
--out <dir>              리포트 저장 (기본값: 터미널 출력만)
--format json,md,html    리포트 형식
--budget-tokens 8000     스텝당 8000 토큰을 넘으면 exit 1
--max-false-success 5    무효 클릭이 5%를 넘으면 exit 1
--max-churn-pct 20       유휴 샘플의 20% 이상이 달라지면 exit 1
--max-noise-pct 25       컨트롤의 25% 이상이 잡음이면 exit 1
--churn-ms 1500          유휴 샘플링 구간 (0이면 끔)
--probes 5               클릭해 볼 비파괴 컨트롤 수 (0 또는 --no-probe면 끔)
--storage-state auth.json  로그인 뒤 페이지 프로파일링 (Playwright storage state)
--tokenizer cl100k_base  o200k_base 대신 GPT-4 계열 토크나이저로 계산
--viewport 1280x900 --headed --timeout 30000 --chromium /path/to/chrome
```

## 다섯 가지 계측

| # | 계측 | 답하는 질문 | 리포트에 나오는 것 |
| --- | --- | --- | --- |
| 1 | **관측 청구서** | 이 페이지를 한 번 보는 데 얼마가 드나? | raw HTML, Readability 텍스트, Playwright ARIA 스냅샷, 압축 인터랙티브 refs, 전체 페이지 스크린샷(비전 토큰 추정)의 바이트·토큰 |
| 2 | **잡음·모호성** | 에이전트가 컨트롤을 구분할 수 있나? | 이름 없는 컨트롤, `(role, name)` 중복 클러스터, 숨김·클리핑·화면 밖 컨트롤, 클릭 지점이 가려진 컨트롤, iframe·shadow DOM 커버리지 |
| 3 | **유휴 변동** | 아무도 안 건드리는데 페이지가 변하나? | 몇 개 샘플이 달라졌는지, 줄의 몇 %가 움직이는지, ref가 몇 개 무효화되는지, 토큰을 얼마나 다시 읽는지 |
| 4 | **델타 여지** | 델타 전송이면 얼마나 아끼나? | 연속 스텝 스냅샷 사이의 동일 비율과, 변경분만 보냈을 때의 예상 절감률 |
| 5 | **행동 진실** | 클릭이 실제로 뭔가 했나? | 클릭해 본 컨트롤별로 효과 있음 / 무효과(거짓 성공) / 차단됨, 그리고 그 근거 |

리포트의 모든 발견에는 근거 한 줄과 구체적인 수정안이 붙습니다.

```
[high] 3 controls share a label with another control
    evidence: 1 (role, name) cluster(s); worst is button "Add to cart" ×3 (@e7, @e8, @e9).
              An agent that targets by accessible name cannot pick the right one.
    fix: Make each name unique ("Add Aria Headphones to cart"), or scope it with a
         labelled region so name + context is unique.
```

## 에이전트 수용 테스트: `agent-eye run`

`profile`이 한 페이지를 재는 도구라면, `run`은 선언한 흐름을 **결정론적 규칙 기반 에이전트**로 실행합니다. 압축 인터랙티브 뷰만 읽고 판단하며 모델은 쓰지 않습니다. 여기서 실패하면 "모델이 운이 나빴다"가 아니라 **페이지를 조작할 수 없었다**는 뜻입니다.

```yaml
# checkout.acceptance.yml
name: checkout acceptance
url: https://staging.example.com/cart

budget:
  tokensPerStep: 8000
  maxFalseSuccess: 0
  maxChurnPct: 15

steps:
  - name: add the headphones
    target: { role: button, name: "Add the Aria Headphones to cart" }   # role + 접근성 이름
    expect:
      - changed: true
      - textContains: "Added to your cart."

  - name: open shipping details
    target: { role: button, name: "Shipping details" }
    expect:
      - changed: true
      - textContains: "Ships in 2 business days"

  - name: checkout is reachable
    do: assert
    expect:
      - elementExists: { role: button, name: "Place order" }
```

```bash
agent-eye run checkout.acceptance.yml --out agent-eye-report
```

```
   1 ✗ add the headphones by name              221 tok
       error: target not found: button "Add the Aria Headphones to cart"
       closest candidates: button "Add to cart" ×3
   2 ✗ open shipping details                   221 tok  false success
       expected the page changes after the action — got 0 line(s) changed
```

스텝 동작은 `goto`, `click`, `fill`, `press`, `wait`, `assert`, `snapshot`입니다. 타깃은 `role` + `name`(접근성 이름 부분 일치), `text`, `selector`, `nth`로 찾습니다. 기대 조건은 `urlContains`, `urlEquals`, `textContains`, `textAbsent`, `elementExists`, `elementAbsent`, `countAtLeast`, `changed`, `ariaChanged`.

CI에서 쓸모 있는 이유는 세 가지입니다.

- **모호함을 숨기지 않습니다.** 이름이 5개 컨트롤과 맞으면 스텝은 `nth`(기본 0)로 실행되지만 리포트에 `ambiguous ×5`가 남습니다. 실제 에이전트가 엉뚱한 행을 고르는 바로 그 지점입니다.
- **거짓 성공이 1급 시민입니다.** 클릭이 오류 없이 끝났는데 스냅샷이 그대로면, 기대 조건에 없어도 그 스텝은 실패합니다.
- **변동이 성공을 위조하지 못합니다.** `run`은 시작할 때 600ms 동안 유휴 페이지를 샘플링해 스스로 움직이는 줄·영역을 걸러냅니다. 시계나 티커가 죽은 버튼을 살아 있게 보이게 할 수 없습니다.

게이트는 `all-steps-pass`(항상)와, 예산이 주어졌을 때 `tokens-per-step`, `false-success`, `idle-churn`, `noise`입니다. 게이트가 깨지면 exit 1, 사용법 오류면 exit 2입니다.

## CI에서

```yaml
- name: Agent readability gate
  run: |
    node dist/bin/agent-eye.js profile "$PREVIEW_URL" --out agent-eye-report \
      --format json,md --budget-tokens 8000 --max-false-success 5 --max-churn-pct 20
```

JSON 리포트는 스키마 버전(`schemaVersion: 1`)이 고정돼 있고, 마크다운 리포트는 PR에 붙이기 좋게, `--format html`은 스타일과 스크린샷이 인라인된 단일 파일로 프리뷰 코멘트나 아티팩트에 쓰기 좋게 만들었습니다.

## 숫자의 의미

감사할 수 없는 지표는 마케팅입니다. 각 숫자의 정의를 그대로 적습니다.

- **토큰**은 [`gpt-tokenizer`](https://github.com/niieani/gpt-tokenizer)로 로컬에서 셉니다(기본 `o200k_base`, 선택 `cl100k_base`). 벤더 토크나이저와는 몇 % 차이가 날 수 있으니 **절대값보다 비율**(모드 대 모드, 전후 비교)로 보세요. 200만 자를 넘는 텍스트는 샘플링하고 리포트에 표시합니다.
- **비전 토큰**은 OpenAI high-detail 타일 규칙(2048×2048에 맞춘 뒤 짧은 변 768, 512px 타일당 170토큰 + 85)과 Anthropic의 750픽셀당 1토큰을 씁니다. 둘 다 추정치이며 `estimated: true`로 표시됩니다.
- **잡음 %**는 분석한 인터랙티브 컨트롤 중 이름이 없거나, 다른 컨트롤과 `(role, name)`이 겹치거나, 숨겨졌거나 2px 아래로 클리핑됐거나, 문서 좌표 밖에 있는 비율입니다. 중복 클러스터는 **구성원 전부**를 셉니다. 이름으로 찾는 에이전트에게는 어느 쪽이든 동전 던지기이기 때문입니다. `hidden`/`display:none`으로 숨겨져 **닿을 수 없는** 컨트롤은 잡음으로 세지 않습니다.
- **가려짐**은 현재 뷰포트에서 컨트롤 중심에 `elementFromPoint`를 한 번 찍어 판정하고, 위에 있는 요소를 이름으로 알려줍니다.
- **유휴 변동**은 빈도(직전 샘플과 달라진 샘플 비율)와 크기(샘플당 바뀐 줄 비율)를 함께, 그리고 무효화된 ref 수와 다시 읽은 토큰을 보여줍니다. 샘플링 중에는 CSS 애니메이션을 멈추지만 JS 타이머는 멈추지 않습니다.
- **델타 여지**는 연속 스텝 스냅샷의 줄 단위 집합 차이입니다(`profile`에서는 안전한 프로브가 스텝을 만듭니다). ref는 스텝마다 다시 번호가 매겨지므로, 델타 프로토콜이 아낄 수 있는 양의 **상한**으로 읽어야 합니다.
- **행동 진실**은 허용 목록의 컨트롤만 클릭합니다. 이름이 있고, 활성이고, 파괴적이지 않은 버튼·탭·체크박스·스위치·라디오·summary이며, 폼 안이 아니고 링크가 아닌 것. delete/pay/buy/order/submit/send/logout/cancel/… 와 삭제·결제·구매·주문·보내기·제출·로그아웃·예약·취소 같은 라벨은 **절대 클릭하지 않습니다**. URL이 바뀌거나 **안정적인 부분**의 스냅샷이 바뀌면 `effective`, 둘 다 아니면 `no-effect`(거짓 성공 후보), 드라이버가 클릭하지 못하면(가려짐·화면 밖·숨김·계속 움직임) `blocked`입니다. 네트워크 요청과 콘솔 에러는 기록하지만 판정에는 쓰지 않습니다. 페이지가 스스로 폴링할 수 있기 때문입니다.

## 안전

- **모델도, 자체 네트워크 호출도 없습니다.** 모든 계산은 로컬에서 이루어지고 아무것도 밖으로 나가지 않습니다. 텔레메트리도 없습니다.
- **읽기 중심입니다.** `profile`은 페이지를 열어 읽고, 위 허용 목록의 비파괴 컨트롤만 클릭합니다(`--no-probe`면 완전 읽기 전용). 입력 필드에 타이핑하지 않고, 폼을 제출하지 않고, 링크를 따라가지 않습니다.
- **파괴적 라벨은 페이지가 잘못 표시해도 제외됩니다.** `run`은 여러분이 쓴 스펙대로 `fill`까지 수행하니, 실제 카드가 걸린 라이브 결제 페이지가 아니라 스테이징이나 테스트 계정에 쓰세요.
- **페이지에 남기는 것은 없습니다.** 요소를 가리키기 위해 잠시 붙이는 `data-agent-eye-ref` 속성 외에는 아무것도 쓰지 않으며, 세션이 끝나면 사라집니다.

## 한계

- 압축 뷰의 접근성 이름은 근사값입니다(`aria-label`, `aria-labelledby`, label, 텍스트, placeholder, title). ARIA 스냅샷 모드는 Playwright의 실제 트리를 쓰므로, 특이한 마크업에서는 둘이 다를 수 있습니다.
- 가려짐은 첫 뷰포트에서만 확인합니다. 스크롤 아래 요소는 고정 헤더와의 겹침을 검사하지 않습니다.
- 실행당 URL 하나입니다. 크롤링하지 않고, `run` 스펙이 하지 않는 한 여러 단계를 스스로 넘어가지 않습니다.
- 열린 shadow DOM은 통과하지만, 닫힌 shadow root와 교차 출처 iframe은 커버리지 공백으로 세고 들여다보지 않습니다.
- `profile`은 기본 5개 컨트롤만 클릭합니다(`--probes`). 거짓 성공 비율은 전수 조사가 아니라 표본입니다.

## 데모

`agent-eye demo`는 같은 스토어프론트의 두 버전을 메모리에서 서빙하고 둘 다 리포트합니다.

| 지표 | before | after | 변화 |
| --- | ---: | ---: | ---: |
| 스텝당 토큰 (압축 refs) | 221 tok | 223 tok | +0.9% |
| 잡음 | 37% | 0% | −100% |
| 유휴 변동 (달라진 샘플 비율) | 100% | 0% | −100% |
| 거짓 성공 | 16.7% | 0% | −100% |
| 가려진 컨트롤 | 2 | 0 | −100% |

"before" 페이지는 흔한 체크아웃입니다. CTA를 덮은 쿠키 배너, 똑같은 "Add to cart" 버튼 3개, 이름 없는 아이콘 버튼 2개, 밀리초 시계와 도는 프로모 문구, 아무것도 하지 않는 토글, 1px로 클리핑된 포커스 가능 버튼, 화면 밖 버튼, iframe, shadow DOM 위젯. "after" 페이지는 하나씩 고칩니다. 컨트롤에 제대로 이름을 붙이는 데 2토큰이 들고, 잡음의 3분의 1이 사라집니다. 두 페이지의 리포트와 함께, 깨끗한 페이지에서 통과하는 수용 테스트와 잡음 페이지에서 실패하는 수용 테스트가 `agent-eye-report/`에 작성됩니다.

## 개발

```bash
npm run typecheck    # tsc, emit 없음
npm run build        # dist/ (bin 포함)
npm test             # 빌드 + 유닛·Playwright e2e 테스트 51개
npm run demo         # 빌드 + 데모
npm run pack:check   # npm pack --dry-run
```

테스트는 실제 픽스처 서버와 실제 Chromium으로 돕니다. 청구서, 잡음 버킷, 시계가 도는 페이지의 변동, 죽은 토글, 가려진 버튼, 수용 테스트 게이트, CLI 종료 코드까지 모두 검증합니다. `AGENT_EYE_CHROMIUM=/path/to/chrome`으로 Playwright가 쓸 브라우저를 지정할 수 있고, CI에서는 직접 설치합니다.

구조: `src/extract.ts`(페이지 안 수집), `src/metrics/*`(청구서·잡음·변동·델타·행동 진실), `src/profile.ts`(오케스트레이션과 발견 생성), `src/run/*`(스펙과 결정론적 실행기), `src/report/*`(터미널·Markdown·JSON·HTML), `src/demo/*`(픽스처 앱).

## 라이선스

MIT
