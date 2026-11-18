// [작업1] PNG 내보내기 코드경로 회귀 — 실제 브라우저 DOM에서
// buildHtml(wrapSections=true) → waitForStableHeight → planSlices → capturePngSlices가
// 필드 크기가 반영된 문서에서 에러 없이 조각을 만드는지 확인한다.
//
// 실행: node qa/fieldsize/png-codepath.mjs
//
// 방법: tsc(typescript devDep, 신규 의존성 아님)로 detail-html.ts / png-slices.ts를
// JS로 컴파일해 인라인 모듈 테스트 페이지를 만들고, 헤드리스 크로뮴 --dump-dom으로
// 결과 마커를 읽는다. toPng 래스터라이저만 가짜(1×1 dataUrl)로 대체한다 —
// 분할/조립 로직(planSlices/capturePngSlices/renderNode)은 전부 실제 코드를 돌린다.

import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "qa/fieldsize/out");
mkdirSync(OUT, { recursive: true });

const TMP = "/tmp/opencode/fieldsize-png";
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// 1) tsc 컴파일 (ES 모듈, 브라우저 대상)
const tsc = path.join(ROOT, "node_modules/.bin/tsc");
execFileSync(tsc, [
  "--ignoreConfig",
  path.join(ROOT, "src/lib/detail-html.ts"),
  path.join(ROOT, "src/lib/png-slices.ts"),
  "--target", "es2020", "--module", "esnext", "--moduleResolution", "bundler",
  "--skipLibCheck", "--outDir", TMP,
], { stdio: "inherit" });

// 2) 두 모듈을 한 파일로 합친다 (import 없음 — 서로를 참조하지 않는 순수 모듈)
const stripExport = (s) => s.replace(/^export /gm, "");
const detailJs = stripExport(readFileSync(path.join(TMP, "detail-html.js"), "utf8"));
const pngJs = stripExport(readFileSync(path.join(TMP, "png-slices.js"), "utf8"));

// 3) 테스트 페이지 — fieldSizes가 골곳에 적용된 문서로 조각 생성
//    주의: --virtual-time-budget 환경에서는 rAF가 2프레임 밖에 발생하지 않아
//    waitForStableHeight가 끝나지 않는다. 테스트 페이지에서만 rAF를 타이머로
//    교체한다(프로덕션 코드는 그대로).
const page = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
/* 실제 앱은 Tailwind preflight(p/div 마진 0) 환경에서 캡처한다 — 같은 전제를 맞춘다. */
p { margin: 0; }
div { margin: 0; }
</style>
</head><body>
<script>
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(window.performance.now()), 0);
</script>
<script type="module">
${detailJs}
${pngJs}

const doc = {
  brand: "PNG코드경로", name: "테스트상품", tagline: "", kind: "living",
  sections: [
    { type: "hero", image: "", title: "히어로 제목", sub: "부제", notice: "경고", badges: ["배지1", "배지2", "배지3"], fieldSizes: { sub: 40, badge1: 48, notice: 20 } },
    { type: "problem", title: "문제공감 제목", body: "본문 첫 줄\\n본문 둘째 줄", image: "", fieldSizes: { body: 20, title: 30 } },
    { type: "usp", title: "", items: ["01 첫째", "02 둘째", "03 셋째"], fieldSizes: { item1: 36 } },
    { type: "notice", caption: "표 제목", rows: [["품명", "값"], ["제조국", "한국"]], fieldSizes: { row0v: 28 } },
    { type: "notice", title: "배송 안내", lines: [""], fee: "무료", island: "", leadTime: "2~3일", fieldSizes: { fee: 28 } },
    { type: "detail", images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0EQVR4nGNgAAIAAAUAAWqwzQAAAABJRU5ErkJggg==", ""], captions: ["캡션", ""], fieldSizes: { caption0: 36 } },
  ],
};

const r = { errors: [] };
try {
  const captureHtml = buildHtml(doc, true);
  r.captureLength = captureHtml.length;
  r.wrapperCount = (captureHtml.match(/<div data-png-section="/g) || []).length;
  r.hasBodySize = captureHtml.includes("font-size: 11.67pt"); // problem body 20px
  r.hasBadgeSize = captureHtml.includes("font-size: 18pt");   // badge1 48px
  r.validate = validateHtml(captureHtml);

  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-99999px;top:0;width:780px;";
  const root = document.createElement("div");
  root.style.cssText = "width:780px;background:#ffffff;overflow:hidden;";
  root.innerHTML = captureHtml;
  host.appendChild(root);
  document.body.appendChild(host);

  // 실제 플로우와 동일하게 이미지 안정화(크기 고정)를 먼저 한다
  await prepareCaptureImages(root, (raw) => raw);

  const totalHeight = await waitForStableHeight(root);
  r.totalHeight = Math.round(totalHeight);
  const { plans } = planSlices(root, MAX_SLICE_HEIGHT);
  r.planCount = plans.length;
  r.planHeights = plans.map((p) => Math.round(p.height));
  r.planSumEqualsTotal = Math.abs(plans.reduce((a, p) => a + p.height, 0) - totalHeight) < 1;
  r.planSections = plans.map((p) => p.sections).flat();

  // 가짜 toPng — 래스터라이즈만 대체. DOM 조립/디코딩 경로는 실제 코드.
  const fakePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0EQVR4nGNgAAIAAAUAAWqwzQAAAABJRU5ErkJggg==";
  const slices = await capturePngSlices(plans, {
    toPng: async () => fakePng,
    width: PNG_WIDTH,
    maxSliceHeight: MAX_SLICE_HEIGHT,
    pixelRatio: PNG_PIXEL_RATIO,
    imagePlaceholder: PNG_PLACEHOLDER,
  });
  r.sliceCount = slices.length;
  r.allSlicesHaveData = slices.every((s) => s.dataUrl === fakePng);
  r.slicePixelSizes = slices.map((s) => s.pixelWidth + "x" + s.pixelHeight);
  r.ok = r.planCount > 0 && r.sliceCount === r.planCount && r.allSlicesHaveData && r.validate.length === 0;
} catch (e) {
  r.ok = false;
  r.errors.push(String(e && e.stack || e));
}
document.title = "RESULT";
const el = document.createElement("pre");
el.id = "png-codepath-result";
el.textContent = "RESULT_JSON:" + JSON.stringify(r);
document.body.appendChild(el);
</script>
</body></html>`;

const pagePath = path.join(TMP, "png-codepath.html");
writeFileSync(pagePath, page);

// 4) 헤드리스 크로뮴으로 실행
const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find((p) => {
  try { execFileSync(p, ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
});
if (!chrome) throw new Error("헤드리스 렌더용 크로뮴/크롬을 찾을 수 없습니다");

const dom = execFileSync(chrome, [
  "--headless", "--no-sandbox", "--disable-gpu",
  "--virtual-time-budget=5000",
  "--dump-dom", "file://" + pagePath,
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const m = dom.match(/RESULT_JSON:(\{.*?\})<\/pre>/s);
if (!m) throw new Error("결과 마커를 찾을 수 없음 — 페이지 실행 실패:\n" + dom.slice(0, 2000));
const r = JSON.parse(m[1]);
console.log(JSON.stringify(r, null, 2));
writeFileSync(path.join(OUT, "png-codepath-report.json"), JSON.stringify(r, null, 2));

const ok = r.ok === true;
console.log(ok ? "\nPNG 코드경로 회귀 통과" : "\nPNG 코드경로 회귀 실패");
process.exit(ok ? 0 : 1);
