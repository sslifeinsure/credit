const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync } = require('child_process');

// Load environment variables from .env file manually
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valParts] = trimmed.split('=');
            if (key) {
                process.env[key.trim()] = valParts.join('=').trim();
            }
        }
    });
}

const PORT = 8080;
const DART_API_KEY = process.env.DART_API_KEY || 'c11b6750932e328048fb1f7d6e660f5d209080ee';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====================================================================
// CORPCODE.xml을 서버 시작 시 1회만 파싱하여 메모리 딕셔너리로 캐싱
// ====================================================================
const CORP_CODE_PATHS = [
    'C:/Users/sonye/.gemini/antigravity/brain/71a6231b-d0ad-4ad0-8aa3-4c22503b9207/scratch/CORPCODE.xml',
    path.join(__dirname, 'CORPCODE.xml'),
    'C:/Users/sonye/.gemini/antigravity/brain/4eb096fd-e32f-4292-a534-0b76c10d5479/scratch/CORPCODE.xml'
];

let CORP_LIST = []; // [{corpCode, corpName, stockCode}, ...]

(function loadCorpCodes() {
    let corpCodeXmlPath = '';
    for (const p of CORP_CODE_PATHS) {
        if (fs.existsSync(p)) {
            corpCodeXmlPath = p;
            break;
        }
    }
    if (!corpCodeXmlPath) {
        console.warn('WARNING: CORPCODE.xml not found.');
        return;
    }
    console.log('Loading CORPCODE.xml from:', corpCodeXmlPath);
    const startMs = Date.now();
    const raw = fs.readFileSync(corpCodeXmlPath, 'utf8');

    // 단순 정규식으로 모든 <list> 엔트리를 한 번에 추출
    const entryRegex = /<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]+)<\/corp_name>[\s\S]*?<stock_code>([^<]*)<\/stock_code>[\s\S]*?<\/list>/g;
    let m;
    while ((m = entryRegex.exec(raw)) !== null) {
        CORP_LIST.push({
            corpCode: m[1],
            corpName: m[2].trim(),
            stockCode: m[3].trim()
        });
    }
    console.log(`Loaded ${CORP_LIST.length} companies in ${Date.now() - startMs}ms`);
})();

// MIME types mapping
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // Add CORS headers for local debugging
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname} - Query: ${JSON.stringify(parsedUrl.query)}`);

    // --- API: Search company code ---
    if (pathname === '/api/search') {
        const companyName = parsedUrl.query.name;
        if (!companyName) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'name query parameter is required' }));
            return;
        }

        if (CORP_LIST.length === 0) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'CORPCODE.xml is not loaded' }));
            return;
        }

        // 영문약어 ↔ 한글 치환 사전 (DART는 한글로 등록하는 경우가 많음)
        const ALIAS_MAP = {
            'hd': '에이치디', 'sk': '에스케이', 'gs': '지에스',
            'cj': '씨제이', 'kt': '케이티', 'kb': '케이비',
            'ks': '케이에스', 'nh': '엔에이치', 'bn': '비엔',
            'ls': '엘에스', 'oci': '오씨아이', 'kcc': '케이씨씨',
            'posco': '포스코', 's-oil': '에스오일', 'dl': '디엘'
        };
        // 완전 동의어 사전 (검색어 전체를 다른 값으로 치환)
        const FULL_ALIAS = {
            '에쓰오일': 's-oil', '에스오일': 's-oil',
            '포스코홀딩스': 'posco홀딩스',
        };

        const rawClean = companyName.replace(/\s+/g, '').toLowerCase();
        
        // 검색 변형 목록 생성 (원본 + 완전동의어 + 영문→한글 치환 + 한글→영문 치환)
        const searchVariants = new Set();
        searchVariants.add(rawClean);
        
        // 완전 동의어 치환
        if (FULL_ALIAS[rawClean]) {
            searchVariants.add(FULL_ALIAS[rawClean]);
        }
        
        // 영문→한글 치환본
        let variant = rawClean;
        for (const [eng, kor] of Object.entries(ALIAS_MAP)) {
            if (variant.startsWith(eng)) {
                variant = kor + variant.slice(eng.length);
                break;
            }
        }
        searchVariants.add(variant);
        
        // 한글→영문 역치환본
        let variant2 = rawClean;
        for (const [eng, kor] of Object.entries(ALIAS_MAP)) {
            if (variant2.startsWith(kor)) {
                variant2 = eng + variant2.slice(kor.length);
                break;
            }
        }
        searchVariants.add(variant2);

        const variantArray = [...searchVariants];
        console.log(`[Search] Searching for variants: ${JSON.stringify(variantArray)} among ${CORP_LIST.length} companies`);

        // 1단계: 정확히 일치 (모든 변형으로 시도)
        let found = null;
        for (const v of variantArray) {
            found = CORP_LIST.find(c => c.corpName.replace(/\s+/g, '').toLowerCase() === v);
            if (found) break;
        }

        // 2단계: 검색어가 회사명에 포함 (예: "한화토탈에너지" → "한화토탈에너지스")
        //   → 여러 후보가 있으면 이름이 가장 짧은(=가장 정확한) 것을 우선
        if (!found) {
            for (const v of variantArray) {
                const candidates = CORP_LIST.filter(c => c.corpName.replace(/\s+/g, '').toLowerCase().includes(v));
                if (candidates.length > 0) {
                    candidates.sort((a, b) => a.corpName.length - b.corpName.length);
                    found = candidates[0];
                    break;
                }
            }
        }

        // 3단계: 회사명이 검색어에 포함 (예: "HD현대오일뱅크" → "에이치디현대오일뱅크")
        //   → 최소 3글자 이상의 회사명만 허용
        //   → 여러 후보가 있으면 이름이 가장 긴(=가장 구체적인) 것을 우선
        if (!found) {
            for (const v of variantArray) {
                const candidates = CORP_LIST.filter(c => {
                    const cn = c.corpName.replace(/\s+/g, '').toLowerCase();
                    return cn.length >= 3 && v.includes(cn);
                });
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.corpName.length - a.corpName.length);
                    found = candidates[0];
                    break;
                }
            }
        }

        if (found) {
            console.log(`[Search] Found: ${found.corpName} (${found.corpCode})`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                corpCode: found.corpCode,
                corpName: found.corpName,
                stockCode: found.stockCode
            }));
        } else {
            console.log(`[Search] NOT FOUND for "${rawClean}"`);
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `Company not found: ${companyName}` }));
        }
        return;
    }


    // --- API: Get financial statements ---
    if (pathname === '/api/financials') {
        const corpCode = parsedUrl.query.corp_code;
        const year = parsedUrl.query.year;
        if (!corpCode || !year) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'corp_code and year parameters are required' }));
            return;
        }

        // We try CFS first, if failed or empty, try OFS
        function getDARTFinancials(div, callback) {
            const dartUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${DART_API_KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11013&fs_div=${div}`;
            const targetUrl = new URL(dartUrl);
            const options = {
                hostname: targetUrl.hostname,
                path: targetUrl.pathname + targetUrl.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            };

            https.get(options, (dartRes) => {
                let body = [];
                dartRes.on('data', (chunk) => body.push(chunk));
                dartRes.on('end', () => {
                    try {
                        const result = JSON.parse(Buffer.concat(body).toString());
                        callback(result);
                    } catch (err) {
                        console.error('DART parse error:', err);
                        callback({ status: '999', message: 'Parse error' });
                    }
                });
            }).on('error', (err) => {
                console.error('DART request error:', err);
                callback({ status: '999', message: err.message });
            });
        }

        getDARTFinancials('CFS', (cfsResult) => {
            if (cfsResult.status === '000') {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(cfsResult));
            } else {
                // Fallback to OFS
                getDARTFinancials('OFS', (ofsResult) => {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(ofsResult));
                });
            }
        });
        return;
    }

    // --- API: Get listing reports (to get rcept_no) ---
    if (pathname === '/api/reports') {
        const corpCode = parsedUrl.query.corp_code;
        const year = parsedUrl.query.year;
        if (!corpCode || !year) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'corp_code and year parameters are required' }));
            return;
        }

        const dartUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_API_KEY}&corp_code=${corpCode}&bgn_de=${year}0101&end_de=${year}0630&pblntf_detail_ty=A003`;
        const targetUrl = new URL(dartUrl);
        const options = {
            hostname: targetUrl.hostname,
            path: targetUrl.pathname + targetUrl.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        https.get(options, (dartRes) => {
            let body = [];
            dartRes.on('data', (chunk) => body.push(chunk));
            dartRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(Buffer.concat(body));
            });
        }).on('error', (err) => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }

    // --- API: Download and mine footnote ---
    if (pathname === '/api/footnote') {
        const rceptNo = parsedUrl.query.rcept_no;
        if (!rceptNo) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'rcept_no parameter is required' }));
            return;
        }

        const tempDir = path.join(__dirname, 'scratch', 'temp_unzip_' + rceptNo);
        const zipPath = path.join(__dirname, 'scratch', `temp_${rceptNo}.zip`);

        // Ensure scratch dir exists
        if (!fs.existsSync(path.join(__dirname, 'scratch'))) {
            fs.mkdirSync(path.join(__dirname, 'scratch'));
        }

        const file = fs.createWriteStream(zipPath);
        const dartUrl = `https://opendart.fss.or.kr/api/document.xml?crtfc_key=${DART_API_KEY}&rcept_no=${rceptNo}`;
        const targetUrl = new URL(dartUrl);
        const options = {
            hostname: targetUrl.hostname,
            path: targetUrl.pathname + targetUrl.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        https.get(options, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    try {
                        // Extract using PowerShell Expand-Archive
                        if (fs.existsSync(tempDir)) {
                            fs.rmSync(tempDir, { recursive: true, force: true });
                        }
                        fs.mkdirSync(tempDir);

                        console.log(`Unzipping document ${rceptNo}...`);
                        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempDir}' -Force"`);

                        // Find XML document
                        const files = fs.readdirSync(tempDir);
                        const xmlFile = files.find(f => f.endsWith('.xml'));
                        if (!xmlFile) {
                            throw new Error('XML file not found in ZIP');
                        }

                        const xmlContent = fs.readFileSync(path.join(tempDir, xmlFile), 'utf8');

                        // Mine valuation loss & allowance
                        let valLoss = 0;
                        let reversal = 0;
                        let allowance = 0;
                        let textContext = '';

                        // 1. Look for inventory valuation loss/reversal in the document text
                        const regexReversal = /재고자산평가손실\(환입\).*?\(([\d,]+)\)/i;
                        const matchRev = xmlContent.match(regexReversal);
                        if (matchRev) {
                            reversal = parseInt(matchRev[1].replace(/,/g, ''), 10) * 1000; // usually in thousands
                        }

                        // Try general text search for numbers
                        let pos = xmlContent.indexOf('재고자산평가손실(환입)');
                        if (pos !== -1) {
                            textContext = xmlContent.substring(pos - 100, pos + 500).replace(/\s+/g, ' ');
                        } else {
                            pos = xmlContent.indexOf('재고자산평가손실');
                            if (pos !== -1) {
                                textContext = xmlContent.substring(pos - 100, pos + 500).replace(/\s+/g, ' ');
                            }
                        }

                        // Parse out allowance if present in text
                        const regexAllowance = /평가충당금.*?([\d,]+)/i;
                        const matchAll = xmlContent.match(regexAllowance);
                        if (matchAll) {
                            allowance = parseInt(matchAll[1].replace(/,/g, ''), 10) * 1000;
                        }

                        // Cleanup files asynchronously to keep it clean
                        fs.rm(zipPath, () => {});
                        fs.rm(tempDir, { recursive: true, force: true }, () => {});

                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({
                            rceptNo: rceptNo,
                            inventoryValLoss: valLoss,
                            inventoryReversal: reversal,
                            allowance: allowance,
                            snippet: textContext
                        }));
                    } catch (e) {
                        console.error('Mining error:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ error: 'Failed to extract and mine footnote document: ' + e.message }));
                    }
                });
            });
        }).on('error', (err) => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }

    // --- API: Summarize using Gemini LLM ---
    if (pathname === '/api/summarize' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                if (!GEMINI_API_KEY) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'GEMINI_API_KEY가 서버 환경 변수에 설정되어 있지 않습니다.' }));
                    return;
                }

                const parsed = JSON.parse(body || '{}');
                const { name, sector, opinion, icr, ocf, daysCurrent, daysPrior, daysAR, daysAP, daysCCC, cccDiff } = parsed;
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
                        'User-Agent': 'Node-HTTPS-Client'
                    }
                };

                const geminiReq = https.request(options, (geminiRes) => {
                    geminiRes.setEncoding('utf8');
                    let resBody = '';
                    geminiRes.on('data', chunk => {
                        resBody += chunk;
                    });
                    geminiRes.on('end', () => {
                        try {
                            const parsedRes = JSON.parse(resBody);
                            if (parsedRes.error) {
                                throw new Error(parsedRes.error.message || 'Gemini API Error');
                            }
                            let summaryText = parsedRes.candidates[0].content.parts[0].text.trim();
                            
                            // Markdown 백틱 wrapper가 포함되어 있는 경우 안전하게 제거
                            if (summaryText.startsWith('```')) {
                                summaryText = summaryText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
                            }
                            
                            // JSON 형식 유효성 검증
                            const validatedJson = JSON.parse(summaryText);
                            
                            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ summary: validatedJson }));
                        } catch (err) {
                            console.error('Gemini parse error:', err, 'Response:', resBody);
                            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ error: `Gemini 응답 파싱 실패: ${err.message}` }));
                        }
                    });
                });

                geminiReq.on('error', (err) => {
                    console.error('Gemini request error:', err);
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: `Gemini API 요청 실패: ${err.message}` }));
                });

                geminiReq.write(apiReqBody);
                geminiReq.end();

            } catch (err) {
                console.error('Summarize error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- Serve Static Files ---
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    
    // Safety check (prevent directory traversal)
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.exists(filePath, (exists) => {
        if (!exists) {
            res.writeHead(404);
            res.end('File Not Found');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Server Error');
                return;
            }
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
            });
            res.end(content);
        });
    });
});

server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Proxy Backend Server running at http://localhost:${PORT}`);
    console.log(`====================================================`);
});
