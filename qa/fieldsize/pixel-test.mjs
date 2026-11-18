// [작업1] 픽셀 실측 — problem 섹션 본문 문단 글자 크기 12px vs 20px 두 문서의
// buildHtml을 파일로 저장 → 헤드리스 크로뮴 렌더 → PIL로 실제 픽셀 차이 측정.
//
// 실행: node qa/fieldsize/pixel-test.mjs
// 산출: qa/fieldsize/out/pixel-12.html, pixel-20.html, pixel-12.png, pixel-20.png,
//       pixel-measure.json

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "qa/fieldsize/out");
mkdirSync(OUT, { recursive: true });

const cur = await import(path.join(ROOT, "src/lib/detail-html.ts"));

// 두 문서 — fieldSizes.body(본문 문단 칸 크기)만 다르고 나머지는 완전히 동일.
// 이미지 없음 → 텍스트 픽셀만 측정. 제목은 위에 동일하게 존재.
const makeDoc = (bodyPx) => ({
  brand: "",
  name: "픽셀측정상품",
  tagline: "",
  kind: "living",
  sections: [
    { type: "problem", title: "픽셀 측정 제목", body: "가나다라마바사 아자차카타파하", image: "", fieldSizes: { body: bodyPx } },
  ],
});

const wrap = (body) =>
  "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>body{margin:0;background:#ffffff;}</style></head><body>" + body + "</body></html>";

const jobs = [
  { px: 12, html: wrap(cur.buildHtml(makeDoc(12))), htmlFile: "pixel-12.html", pngFile: "pixel-12.png" },
  { px: 20, html: wrap(cur.buildHtml(makeDoc(20))), htmlFile: "pixel-20.html", pngFile: "pixel-20.png" },
];

for (const j of jobs) {
  const htmlPath = path.join(OUT, j.htmlFile);
  writeFileSync(htmlPath, j.html);
  console.log("HTML 저장: " + j.htmlFile + " (" + j.html.length + "자)");
  // 본문 span 크기 확인 (12px→7pt, 20px→11.67pt)
  const m = j.html.match(/font-size: ([0-9.]+)pt; color: #555555;">가나다라/);
  if (!m) throw new Error("본문 span을 찾을 수 없음");
  console.log("  본문 span font-size: " + m[1] + "pt (CSS px 환산 " + (Number(m[1]) * 4 / 3).toFixed(2) + "px)");
  j.pt = Number(m[1]);
  j.cssPx = Number(m[1]) * 4 / 3;

  const pngPath = path.join(OUT, j.pngFile);
  const args = [
    "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--default-background-color=FFFFFFFF",
    "--window-size=780,420",
    "--screenshot=" + pngPath,
    "file://" + htmlPath,
  ];
  const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find((p) => {
    try { execFileSync(p, ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
  });
  if (!chrome) throw new Error("헤드리스 렌더용 크로뮴/크롬을 찾을 수 없습니다");
  execFileSync(chrome, args, { stdio: "inherit" });
  console.log("PNG 저장: " + j.pngFile);
}

// PIL로 측정
const py = path.join(ROOT, "qa/fieldsize/measure.py");
const report = JSON.parse(execFileSync("python3", [py, path.join(OUT, "pixel-12.png"), path.join(OUT, "pixel-20.png")], { encoding: "utf8" }));
report.docs = jobs.map((j) => ({ bodyPx: j.px, pt: j.pt, cssPx: Number(j.cssPx.toFixed(2)) }));
writeFileSync(path.join(OUT, "pixel-measure.json"), JSON.stringify(report, null, 2));
console.log("\n측정 결과:", JSON.stringify(report, null, 2));
