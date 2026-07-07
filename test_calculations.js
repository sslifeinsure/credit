// 리스크 판별 핵심 비즈니스 로직
function evaluateRiskLevel(companyName, sector, metrics) {
    const reasons = [];
    let level = "Green";

    if (sector === "철강") {
        const rollMargin = metrics.rollMargin;
        const inventoryDays = metrics.inventoryDays; // 전년 동기 대비 재고 회전기일 증가 일수
        
        // 포스코/현대제철 공통 고로 롤마진 BEP: 300, Red 임계치: 250
        if (rollMargin < 250) {
            level = "Red";
            reasons.push(`고로 롤마진($${rollMargin})이 적자 임계선 $250을 하회`);
        } else if (rollMargin < 300) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`고로 롤마진($${rollMargin})이 BEP 하한선 $300 하회`);
        }

        // 현대제철 전기로 봉형강 BEP (barSpread): 35만원, Red 임계치: 30만원
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

        // 재고 회전기일 증가 폭 기준 (Red: 10일 이상 증가, Yellow: 6일 또는 7일 이상 증가)
        // 디자인 스펙과 계획서의 요구사항을 결합하여 합리적으로 구현
        if (inventoryDays >= 10) {
            level = "Red";
            reasons.push(`재고 회전기일 증가폭(${inventoryDays}일)이 10일 이상으로 급증`);
        } else if (inventoryDays >= 6) {
            if (level !== "Red") level = "Yellow";
            reasons.push(`재고 회전기일 증가폭(${inventoryDays}일)이 주의 기준 6일 이상 초과`);
        }
    } else if (sector === "석유화학") {
        const ethyleneSpread = metrics.rollMargin; // 석화는 rollMargin 자리에 에틸렌 스프레드 활용
        const inventoryDays = metrics.inventoryDays; // 전년 동기 대비 재고 회전기일 증가 일수

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
        metrics: { rollMargin: 257, inventoryDays: 7 }, // 전년 대비 7일 증가 -> Yellow (롤마진 < 300 및 재고증가 7일)
        expected: "Yellow"
    },
    {
        name: "포스코 마진 정상화 검증",
        company: "포스코",
        sector: "철강",
        metrics: { rollMargin: 310, inventoryDays: 3 }, // Green
        expected: "Green"
    },
    {
        name: "롯데케미칼 극도 위험 검증",
        company: "롯데케미칼",
        sector: "석유화학",
        metrics: { rollMargin: 200, inventoryDays: 12 }, // 에틸렌 스프레드 200 < 220 및 재고증가 12일 -> Red
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

module.exports = { evaluateRiskLevel };
