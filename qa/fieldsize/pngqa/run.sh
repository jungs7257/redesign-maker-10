#!/usr/bin/env bash
# [검증 5-2] PNG 조각 생성 회귀 실행 — 컴파일 → 로컬 HTTP 서빙(ES 모듈 CORS) →
# 헤드리스 크롬 실행 → 결과 파싱. 실행: bash qa/fieldsize/pngqa/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."   # 프로젝트 루트

OUT=qa/fieldsize/pngqa
PORT="${PNGQA_PORT:-38215}"

rm -rf "$OUT/js"
./node_modules/.bin/tsc src/lib/detail-html.ts src/lib/png-slices.ts \
  --outDir "$OUT/js" --module es2020 --target es2022 --lib es2022,dom \
  --moduleResolution bundler --skipLibCheck --ignoreConfig
# mjs 소스를 페이지 옆에 복사하며, 컴파일된 js 모듈을 상대 참조하게 경로만 바꾼다.
node -e '
const fs=require("fs");
let s=fs.readFileSync("qa/fieldsize/pngqa/capture-test.mjs","utf8");
s=s.replace("../../src/lib/detail-html.ts","./js/detail-html.js");
s=s.replace("../../src/lib/png-slices.ts","./js/png-slices.js");
fs.writeFileSync("qa/fieldsize/pngqa/capture-test.js",s);
'

# 의존성 없는 정적 파일 서버 (node 표준 모듈만 사용)
node qa/fieldsize/pngqa/serve.mjs "$PORT" "$OUT" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 0.6

google-chrome --headless=new --no-sandbox --disable-gpu \
  --virtual-time-budget=15000 --timeout=25000 \
  --dump-dom "http://127.0.0.1:$PORT/page.html" > "$OUT/dom-dump.html" 2>/dev/null

node -e '
const fs=require("fs");
const dom=fs.readFileSync("qa/fieldsize/pngqa/dom-dump.html","utf8");
const m=dom.match(/<pre id="result">([^<]*)<\/pre>/);
if(!m){ console.error("결과 미검출(페이지 실행 실패)"); process.exit(1); }
if(m[1]==="PENDING"){ console.error("모듈 실행 미완료(PENDING)"); process.exit(1); }
const r=JSON.parse(m[1]);
console.log(JSON.stringify(r,null,1));
const ok=r.ok&&r.slices>0&&r.heightMatch&&r.allDataUrls&&r.fieldSizeReflected;
fs.writeFileSync("qa/fieldsize/pngqa/result.json", JSON.stringify(r,null,1));
console.log(ok?"\nPASS":"\nFAIL");
process.exit(ok?0:1);
'
