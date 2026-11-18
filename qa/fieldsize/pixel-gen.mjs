// [검증 2-1] 픽셀 실측용 HTML 두 벌 생성 — problem 섹션 본문(body) 글자 크기만
// 12px ↔ 20px로 다른 두 문서. buildHtml이 단일 출처라 미리보기·PNG·HTML 동일 반영.
// 실행: node qa/fieldsize/pixel-gen.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { buildHtml } from "../../src/lib/detail-html.ts";

const mk = (bodyPx) => ({
  brand: "",
  name: "픽셀측정",
  tagline: "",
  kind: "living",
  sections: [
    {
      type: "problem",
      title: "",
      body: "TEST BODY LINE Hpmn 0123",
      image: "",
      ...(bodyPx ? { fieldSizes: { body: bodyPx } } : {}),
    },
  ],
});

const wrap = (inner) =>
  "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
  "<style>html,body{margin:0;padding:0;background:#ffffff;width:780px;}p{margin:0;}</style>" +
  "</head><body>" + inner + "</body></html>";

await mkdir(new URL("./out/", import.meta.url), { recursive: true });
const a = buildHtml(mk(12));
const b = buildHtml(mk(20));
await writeFile(new URL("./out/body-12px.html", import.meta.url), wrap(a), "utf8");
await writeFile(new URL("./out/body-20px.html", import.meta.url), wrap(b), "utf8");

// pt 값 확인 로그 — problem 기본 24px, 본문 기본 14pt
//   12px → 14 × 12/24 = 7pt (≈9.33 CSS px)
//   20px → 14 × 20/24 = 11.67pt (≈15.56 CSS px)
// (주의: 제목이 비어도 빈 span이 먼저 나오므로 본문 텍스트에 붙어 있는 pt를 잡는다)
const ptOf = (html) => (html.match(/font-size: ([0-9.]+)pt; color: #555555;">TEST BODY/) || [])[1];
console.log("A(12px):", ptOf(a), "pt");
console.log("B(20px):", ptOf(b), "pt");
