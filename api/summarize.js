const https = require('https');

module.exports = async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
    }

    try {
        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY가 Vercel 환경 변수에 설정되어 있지 않습니다.' }));
            return;
        }

        // Parse body since Vercel passes parsed JSON or raw depending on helper settings
        let body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        } else if (!body) {
            // Read body buffer if empty
            body = await new Promise((resolve) => {
                let data = '';
                req.on('data', chunk => data += chunk);
                req.on('end', () => {
                    try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); }
                });
            });
        }

        const { name, sector, opinion, icr, ocf, daysCurrent, daysPrior, daysAR, daysAP, daysCCC, cccDiff, rollMargin, bepMargin } = body;
        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'name parameter is required' }));
            return;
        }

        const prompt = `당신은 기업의 신용위험을 분석하는 최고 수준의 전문 'AI 심사역'입니다.
당신의 임무는 주어진 정량적 재무 지표, 시장 상황, 그리고 압축된 정성적 데이터를 종합적으로 분석하여 "정성데이터(심사역 종합 의견)"를 생성하는 것입니다.

[분석 대상 기업]
- 기업명: ${name}
- 업종: ${sector}
- 기본 신용 의견: ${opinion}

[추출된 핵심 재무/유동성 지표]
- 이자보상배율(ICR): ${icr}배 (1.0배 미만 시 자체적 이자 상환 불가능 상태)
- 영업현금흐름(OCF): ${ocf ? (ocf / 100000000).toFixed(2) : 0}억 원 (장부상 이익과 실질 현금 유입 간의 괴리 분석에 활용)
- 핵심 매크로 지표(롤마진/스프레드): ${rollMargin !== undefined ? rollMargin : 'N/A'} (손익분기점 BEP: ${bepMargin !== undefined ? bepMargin : 'N/A'})
- 재고 회전기일: ${daysCurrent}일 (전년동기 ${daysPrior}일)
- 매출채권 회전기일: ${daysAR || 0}일
- 매입채무 회전기일: ${daysAP || 0}일
- 최종 현금회전주기(CCC): ${daysCCC || 0}일 (전년동기 대비 변동: ${cccDiff >= 0 ? '+' : ''}${cccDiff || 0}일)

[지시 사항]
1. 출력 형식: 반드시 유효한 JSON 형식으로만 출력해야 합니다. JSON 블록 외에 어떠한 대화형 텍스트나 부연 설명, 마크다운 코드 블록(json 등)을 포함하지 마십시오.
2. 객관성: "단기 결제 유동성 저하", "실질 수익 창출력 훼손", "어닝쇼크"와 같은 전문적이고 객관적인 금융 용어를 엄격하게 사용하십시오.
3. 30년 경력의 심사팀장 시각에서, 추출된 이자보상배율(ICR)과 영업현금흐름(OCF) 부호, 그리고 현금회전주기(CCC)의 악화 여부를 토대로 동사의 단기 결제 유동성 위험 및 실질 수익 잠식 리스크를 날카롭게 진단해 주십시오.
4. 본문 분석 내용 내에 아래의 **5가지 핵심 리스크 단어**를 띄어쓰기 없이 정확한 형태로 반드시 1회 이상 포함시켜 설명해 주십시오. (기업 실적이 개선 중이더라도 '실적 저하 징후 없음', '영업이익 하락 방어 성공' 등의 맥락으로 단어들을 명확히 출현시켜야 합니다.)
   - **실적 저하**
   - **매출하락**
   - **영업이익 하락**
   - **마진 스프레드 하락**
   - **중국 제고 증가** ('중국 제고 증가(재고 증가)'와 같이 작성하여 '중국 제고 증가'라는 형태를 반드시 텍스트에 남겨 주십시오.)
5. 중요: '기본 신용 의견' 텍스트 내에 기재된 과거 마진 수치(예: $16.5 등)는 무시하고, 반드시 [추출된 핵심 재무/유동성 지표]에 제공된 최신 '핵심 매크로 지표' 값을 기준으로 분석 내용을 전면 재작성하십시오.

JSON 스키마 템플릿:
{
  "analysis_trace": {
    "step_1_metric_extraction": "핵심 지표 추출 및 가이드라인 대비 증감 폭 분석 (1~2문장의 간결한 요약)",
    "step_2_logical_verification": "추출된 지표가 부여된 위험 등급을 논리적으로 뒷받침하는지 검증 (1~2문장의 간결한 요약)"
  },
  "final_qualitative_assessment": {
    "title": "AI 심사역 실시간 컨텍스트 및 글로벌 동향 분석 (${name})",
    "content_paragraphs": [
      "첫 번째 단락: 스프레드 악화, 글로벌 업황 등을 포함한 종합 위험 등급 부여 배경",
      "두 번째 단락: 이자보상배율, 영업현금흐름, 현금회전주기, 재고 회전기일 등을 활용한 세부 유동성 및 재무 안정성 분석",
      "세 번째 단락: 유가 등 거시 환경 측면의 부정적 시그널 및 향후 실질 수익 창출력 전망"
    ]
  }
}`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const apiReqBody = JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }]
        });

        const targetUrl = new URL(geminiUrl);
        const options = {
            hostname: targetUrl.hostname,
            port: 443,
            path: targetUrl.pathname + targetUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Vercel-Serverless-Function'
            }
        };

        const apiResult = await new Promise((resolve, reject) => {
            const apiReq = https.request(options, (apiRes) => {
                apiRes.setEncoding('utf8');
                let resBody = '';
                apiRes.on('data', chunk => resBody += chunk);
                apiRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(resBody);
                        if (parsed.error) {
                            reject(new Error(parsed.error.message || 'Gemini API Error'));
                        } else {
                            resolve(parsed.candidates[0].content.parts[0].text);
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse Gemini response: ${e.message}`));
                    }
                });
            });

            apiReq.on('error', reject);
            apiReq.write(apiReqBody);
            apiReq.end();
        });

        let summaryText = apiResult.trim();
        // 마크다운 json 코드블록 제거 파서 적용
        if (summaryText.startsWith('```')) {
            summaryText = summaryText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        }
        
        // 최종 구조화된 JSON 파싱 유효성 검증
        const validatedJson = JSON.parse(summaryText);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ summary: validatedJson }));
    } catch (err) {
        console.error('Serverless summarize error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
    }
};
