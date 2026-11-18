// [작업2] API 경로 마이그레이션 검증 — 서버 단일 출처(/api/detail-data)를 통해서만
// 데이터를 읽고, migrateDoc 결과와 비교한다. 차이가 있을 때만(레거시 형태 반영분)
// PUT으로 반영한다. 차이가 없으면 서버 데이터를 전혀 건드리지 않는다.
//
// 실행: node qa/fieldsize/api-migration-check.mjs [http://localhost:3002/redesign/15]

const BASE = process.argv[2] || "http://localhost:3002/redesign/15";
const API = BASE + "/api/detail-data";
const ROOT = new URL(import.meta.url).pathname.replace(/\/qa\/.*$/, "");
const cur = await import(ROOT + "/src/lib/detail-html.ts");

const res = await fetch(API, { cache: "no-store" });
if (!res.ok) throw new Error("GET 실패: " + res.status);
const data = await res.json();
if (!data.ok) throw new Error("API ok=false");

const before = data.doc;
const after = cur.migrateDoc(before);

const beforeStr = JSON.stringify(before);
const afterStr = JSON.stringify(after);
console.log("GET 성공 — sections:", before.sections.length);
console.log("마이그레이션 전/후 동일:", beforeStr === afterStr);

if (beforeStr !== afterStr) {
  // 차이 요약
  for (let i = 0; i < Math.max(before.sections.length, after.sections.length); i++) {
    const b = JSON.stringify(before.sections[i]);
    const a = JSON.stringify(after.sections[i]);
    if (b !== a) {
      console.log("섹션 " + i + " 변경:");
      console.log("  전:", b);
      console.log("  후:", a);
    }
  }
  const put = await fetch(API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc: after }),
  });
  console.log("PUT(마이그레이션 반영):", put.status, JSON.stringify(await put.json()));
} else {
  console.log("차이 없음 → PUT 없이 종료 (서버 데이터 미변경)");
}
