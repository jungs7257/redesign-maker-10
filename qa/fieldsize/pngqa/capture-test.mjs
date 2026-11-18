// [검증 5-1] PNG 내보내기 코드 경로 회귀 — detail-html.ts + png-slices.ts를
// tsc로 JS로 컴파일해 실제 브라우저(헤드리스 크롬)에서 planSlices/capturePngSlices를
// 돌려본다(toPng만 목업). 실행: bash qa/fieldsize/pngqa/run.sh
import { buildHtml } from "../../src/lib/detail-html.ts";
import { planSlices, capturePngSlices } from "../../src/lib/png-slices.ts";

document.getElementById("result").textContent = "STARTED:" + (typeof buildHtml) + "," + (typeof capturePngSlices);

const doc = {
  brand: "브랜드",
  name: "상품명",
  tagline: "",
  kind: "living",
  sections: [
    { type: "hero", image: "", title: "히어로 제목", sub: "부제", notice: "경고", badges: ["b1", "b2", "b3"], fieldSizes: { badge0: 48, sub: 16 } },
    { type: "problem", title: "문제", body: "본문 줄1\n본문 줄2", image: "", fieldSizes: { body: 20 } },
    { type: "usp", items: ["01 이득", "02 이득"], fieldSizes: { item1: 36 } },
    { type: "notice", caption: "정보", rows: [["품명", "x"], ["색상", "y"]], fieldSizes: { row1v: 28 } },
  ],
};

const root = document.getElementById("cap");
root.innerHTML = buildHtml(doc, true);

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAWMPnQkAAAAASUVORK5CYII=";
const t0 = performance.now();
try {
  const { plans, totalHeight } = planSlices(root, 3000);
  const slices = await capturePngSlices(plans, {
    toPng: async () => tinyPng,
    width: 780,
    maxSliceHeight: 3000,
    pixelRatio: 2,
    imagePlaceholder: tinyPng,
  });
  const heightSum = slices.reduce((a, s) => a + s.height, 0);
  document.getElementById("result").textContent = JSON.stringify({
    ok: true,
    plans: plans.length,
    slices: slices.length,
    totalHeight,
    heightSum,
    heightMatch: heightSum === totalHeight,
    sections: slices.flatMap((s) => s.sections),
    allDataUrls: slices.every((s) => String(s.dataUrl).startsWith("data:image/png")),
    fieldSizeReflected: root.innerHTML.includes("font-size: 18pt") && root.innerHTML.includes("font-size: 11.67pt"),
    elapsedMs: Math.round(performance.now() - t0),
  });
} catch (e) {
  document.getElementById("result").textContent = JSON.stringify({ ok: false, error: String(e && e.stack || e) });
}
