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

        const { name, sector, opinion } = body;
        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'name parameter is required' }));
            return;
        }

        const prompt = `당신은 대한민국 최고 수준의 전문 크레딧 심사역(Credit Risk Analyst)입니다.
다음 정보를 바탕으로 해당 기업의 신용 리스크 요인을 종합 분석하고, 최근 공시/뉴스 흐름 및 글로벌(특히 중국) 재고/공급 과잉 동향을 감안하여 심도 깊은 [정성 데이터 분석 요약]을 작성해 주세요.

[분석 대상 기업]
- 기업명: ${name}
- 업종: ${sector}
- 기본 신용 의견: ${opinion}

[작성 가이드라인]
1. 리포트 하단에 들어갈 실시간 분석 정보이므로 전문적이고 분석적인 톤앤매너를 유지해 주세요. (경어체로 작성하되 단락 구분을 명확히 해 주십시오.)
2. 다음 3가지 핵심 축을 반드시 포함하여 작성해 주세요:
   - **글로벌 및 중국 재고/수급 동향**: 해당 업종의 중국발 공급 과잉(예: 석화 부문 에틸렌/나프타 스프레드 침체, 철강 부문 중국 저가 철강 수출 공세 등)이 해당 기업의 재고 건전성과 수익성에 미치는 리스크.
   - **최근 공시 및 뉴스 컨텍스트 분석**: 최근 산업계 뉴스 및 공시 정보(스프레드 악화, 지정학적 리스크, 판매 단가 인상 여부 등)가 리스크에 미치는 영향.
   - **최종 크레딧 심사 총평 및 리스크 모니터링 포인트**.
3. 가독성을 위해 문단을 나누고 깔끔하게 작성해 주세요. (마크다운 포맷 대신 줄바꿈을 포함한 일반 텍스트 포맷으로 전달해 주십시오.)`;

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

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ summary: apiResult }));
    } catch (err) {
        console.error('Serverless summarize error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
    }
};
