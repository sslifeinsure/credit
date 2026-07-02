# 기업 신용위험 모니터링 시스템 구현 계획 (Credit Risk Monitoring System)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 20년 경력의 베테랑 심사역을 위한 C안(사이드바 탭 포털 구조)의 기업 신용위험 모니터링 단일 HTML 웹 애플리케이션을 구축합니다.

**Architecture:** 
- `index.html` 단일 파일로 동작하며 내부에 현대적인 UI 스타일(Slate Dark Theme), 탭 전환 시스템, 동적 SVG 차트, 실시간 슬라이더 편집기, LocalStorage 백업 및 공장 초기화(Reset) 로직을 갖춥니다.
- 비즈니스 평가 로직을 모듈 단위로 구성하여 `test_calculations.js` 테스트 스크립트를 통해 사전에 정밀하게 무결성을 검증합니다.

**Tech Stack:** Vanilla HTML5, Vanilla CSS3 (Slate 테마), Vanilla JS, Node.js (로컬 테스트용)

## Global Constraints
- 모든 코드는 외부 라이브러리(React, Vue 등) 없이 브라우저 기본 API(Vanilla JS)만 사용해야 합니다.
- 수정한 데이터는 LocalStorage 키 `credit_risk_sim_data`에 유지되어야 하며, 기본값 복원 기능이 완벽히 작동해야 합니다.
- 인쇄 화면(`@media print`)에서는 사이드바, 편집 슬라이더, 리셋 버튼 등의 불필요한 UI가 제외되고 A4 규격의 리포트 형태로 포맷팅되어야 합니다.

---

### Task 1: 비즈니스 리스크 로직 설계 및 테스트 검증

**Files:**
- Create: `test_calculations.js`
- Test: `node test_calculations.js`

**Interfaces:**
- Consumes: 기존 `creditDB` 데이터 및 동적 가변 파라미터
- Produces: `evaluateRiskLevel(companyName, metrics)` 함수
  - `metrics` 구조: `{ rollMargin, barSpread, inventoryDays }`
  - 리턴값: `{"level": "Red"|"Yellow"|"Green", "reasons": []}`

- [ ] **Step 1: 검증을 위한 테스트 스크립트 작성**

Create `test_calculations.js` with the following test suite:

```javascript
// 리스크 판별 핵심 비즈니스 로직
function evaluateRiskLevel(companyName, sector, metrics) {
    const reasons = [];
    let level = "Green";

    if (sector === "철강") {
        const rollMargin = metrics.rollMargin;
        const inventoryDays = metrics.inventoryDays;
        
        // 포스코/현대제철 공통 롤마진 BEP: 300
        if (rollMargin < 250) {
            level = "Red";
            reasons.push(`고로 롤마진($${rollMargin})이 적자 임계선 $250을 하회`);
        } else if (rollMargin < 300) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`고로 롤마진($${rollMargin})이 BEP 하한선 $300 하회`);
        }

        // 현대제철 전기로 봉형강 BEP (barSpread): 35만원 (35)
        if (companyName === "현대제철") {
            const barSpread = metrics.barSpread;
            if (barSpread < 30) {
                level = "Red";
                reasons.push(`봉형강 스프레드(${barSpread}만원)가 위험 수준 30만원 하회`);
            } else if (barSpread < 35) {
                if (level !== "Red") level = "Yellow";
                reasons.push(`봉형강 스프레드(${barSpread}만원)가 BEP 35만원 하회`);
            }
        }

        // 재고 회전기일 기준 (기본 43일)
        if (inventoryDays >= 50) {
            level = "Red";
            reasons.push(`재고 회전기일(${inventoryDays}일)이 50일 이상으로 급증`);
        } else if (inventoryDays >= 45) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`재고 회전기일(${inventoryDays}일)이 전년 대비 주의 기준(45일) 초과`);
        }
    } else if (sector === "석유화학") {
        const ethyleneSpread = metrics.rollMargin; // 석화는 rollMargin 자리에 에틸렌 스프레드 활용
        const inventoryDays = metrics.inventoryDays;

        if (ethyleneSpread < 220) {
            level = "Red";
            reasons.push(`에틸렌 스프레드($${ethyleneSpread})가 적자 전환 임계선 $220 하회`);
        } else if (ethyleneSpread < 300) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`에틸렌 스프레드($${ethyleneSpread})가 BEP $300 하회`);
        }

        if (inventoryDays >= 10) {
            level = "Red";
            reasons.push(`재고 회전기일 증가폭(${inventoryDays}일)이 Red 기준 10일 이상 초과`);
        } else if (inventoryDays >= 6) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`재고 회전기일 증가폭(${inventoryDays}일)이 주의 기준 6일 이상 초과`);
        }
    }

    return { level, reasons };
}

// 테스트 케이스 구동 및 단언(Assertion)
const testCases = [
    {
        name: "포스코 기본값 검증",
        company: "포스코",
        sector: "철강",
        metrics: { rollMargin: 257, inventoryDays: 7 }, // 전년 대비 7일 증가
        expected: "Yellow"
    },
    {
        name: "포스코 마진 정상화 검증",
        company: "포스코",
        sector: "철강",
        metrics: { rollMargin: 310, inventoryDays: 3 },
        expected: "Green"
    },
    {
        name: "롯데케미칼 극도 위험 검증",
        company: "롯데케미칼",
        sector: "석유화학",
        metrics: { rollMargin: 200, inventoryDays: 12 },
        expected: "Red"
    }
];

let failed = false;
testCases.forEach(tc => {
    const res = evaluateRiskLevel(tc.company, tc.sector, tc.metrics);
    if (res.level !== tc.expected) {
        console.error(`❌ FAIL: ${tc.name} (Expected: ${tc.expected}, Got: ${res.level})`);
        failed = true;
    } else {
        console.log(`✅ PASS: ${tc.name}`);
    }
});

if (failed) {
    process.exit(1);
} else {
    console.log("🎉 All calculation tests passed!");
}
```

- [ ] **Step 2: 테스트 구동**

Run: `node test_calculations.js`
Expected: `All calculation tests passed!`

- [ ] **Step 3: 커밋**

```bash
git add test_calculations.js
git commit -m "test: add risk calculation test suite"
```

---

### Task 2: UI 뼈대 및 디자인 시스템 구현 (HTML/CSS)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: C안 레이아웃 가이드라인
- Produces: CSS 변수 체계 및 메인 포털 레이아웃 (사이드바 + 메인 워크스페이스)

- [ ] **Step 1: `index.html` 마크업 및 CSS 기초 설계**

Write the basic skeleton of `index.html` with full CSS structure including modern slate dark variables:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>베테랑 크레딧 심사역 - 기업 신용위험 모니터링 시스템</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-main: #0f172a;
            --bg-card: #1e293b;
            --bg-sidebar: #0b0f19;
            --border-color: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            
            --red-color: #ef4444;
            --yellow-color: #f59e0b;
            --green-color: #10b981;
            --blue-accent: #38bdf8;
            
            --transition-speed: 0.25s;
        }

        body {
            font-family: 'Inter', 'Malgun Gothic', sans-serif;
            background-color: var(--bg-main);
            color: var(--text-primary);
            margin: 0;
            padding: 0;
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        /* sidebar, layout, and main areas styles here */
    </style>
</head>
<body>
  <!-- HTML layout structures here -->
</body>
</html>
```

- [ ] **Step 2: 탭 전환 기능 및 기본 디자인 검증**

Run: 브라우저로 `index.html` 열기
Expected: 사이드바 탭 클릭 시 메인 화면이 올바르게 탭 상태를 전환하여 보여줌.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: design skeleton and slate theme CSS"
```

---

### Task 3: 모니터링 대시보드 및 상세 기업 분석 화면 구현

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `creditDB` 로컬 DB 구조
- Produces: 대시보드 뷰, 상세 리포트 바인딩 뷰, Watchlist 렌더링

- [ ] **Step 1: DB 연동 스크립트 및 대시보드 카드 생성 로직 작성**

Add JavaScript `creditDB` state management, local storage parsing, and render functions inside `index.html`.

- [ ] **Step 2: 상세 리포트 렌더링 작성**

철강 업종일 경우 "주력 부문 판결 결과"를 정상 노출하고 석화 업종일 경우 자동 제거하는 로직 추가.

- [ ] **Step 3: 브라우저 렌더링 검증**

Run: 브라우저로 `index.html` 열기
Expected: 홈 대시보드 카드에 POSCO, 현대제철, 롯데케미칼이 적절히 출력되며 클릭 시 상세 보기로 넘어감.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: implement dashboard and credit report rendering"
```

---

### Task 4: 실시간 변수 시뮬레이터 및 SVG 게이지 차트 구현

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: 사용자 슬라이더 조작 이벤트
- Produces: 실시간 게이지 바 눈금 이동, 리스크 등급 동적 변환 및 LocalStorage 동기화

- [ ] **Step 1: 슬라이더 컨트롤러 및 SVG 게이지 구현**

Add parameter sliders (마진, 스프레드, 재고회전일수) and bind `input` events to execute `evaluateRiskLevel` and dynamically modify CSS classes.

- [ ] **Step 2: LocalStorage 및 Reset 버튼 기능 바인딩**

`Save` 및 `Reset` 기능 바인딩하여 브라우저 재진입 시 복구 테스트 수행.

- [ ] **Step 3: 기능 검증**

Run: 브라우저에서 슬라이더를 최소치로 내릴 때 등급이 Red로 변하는지 및 "기본값 복원" 버튼으로 초기화되는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: add real-time simulator, SVG gauge, and local storage reset"
```

---

### Task 5: 인쇄(PDF) 스타일 최적화 및 최종 다듬기

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `@media print` CSS
- Produces: 깔끔한 A4 전용 출력 레이아웃

- [ ] **Step 1: 프린트 스타일 정의**

Add `@media print` inside `<style>` block to hide navigation sidebar, inputs, and render card elements in clean white-background document layouts.

- [ ] **Step 2: 브라우저 인쇄 검증**

Run: 브라우저에서 `Ctrl + P` (인쇄 미리보기) 수행
Expected: 사이드바 없이 깔끔한 A4 규격 기업 신용 리포트 화면 노출.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: design printing styles and finalize code"
```
