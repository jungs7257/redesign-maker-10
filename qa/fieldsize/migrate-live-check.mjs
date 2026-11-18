// [검증 3] 실서비스 데이터 마이그레이션 검증 — 실행 중인 서버(구 빌드)의
// /api/detail-data 에서 문서를 받아와 새 코드로 마이그레이션했을 때:
//   1) 내용이 보존되는지(배지 등 필드별 비교)
//   2) 이미 정규화된 문서라면 구조가 그대로인지(불필요한 필드 추가 없음)
// 를 확인한다. 서버 저장은 이 검증이 통과한 뒤 클라이언트(PUT) 경로로만 이뤄진다.
// 실행: node qa/fieldsize/migrate-live-check.mjs
import { writeFile } from "node:fs/promises";
import { migrateDoc, buildHtml } from "../../src/lib/detail-html.ts";

const BASE = process.env.DETAIL_API ?? "http://localhost:3002/redesign/15/api/detail-data";

const res = await fetch(BASE, { cache: "no-store" });
if (!res.ok) {
  console.error("GET 실패:", res.status);
  process.exit(1);
}
const data = await res.json();
if (!data.ok || !data.doc) {
  console.error("서버에 문서 없음:", JSON.stringify(data).slice(0, 200));
  process.exit(1);
}
const before = data.doc;
const after = migrateDoc(before);

// 1) 마이그레이션 전후 렌더 동일 여부 (이미 정규화된 문서면 바이트 동일해야 함)
const htmlBefore = buildHtml(before);
const htmlAfter = buildHtml(after);

// 2) 배지 등 주요 필드 보존 비교
const pickHero = (doc) => doc.sections.filter((s) => s.type === "hero");
const heroesB = pickHero(before);
const heroesA = pickHero(after);
let badgesPreserved = heroesB.length === heroesA.length;
for (let i = 0; i < heroesB.length && badgesPreserved; i++) {
  const b = heroesB[i].badges ?? [];
  const a = heroesA[i].badges ?? [];
  const joined = (x) => x.map((v) => String(v ?? "").trim()).filter(Boolean).join("·");
  badgesPreserved = joined(b) === joined(a);
}

// 3) 새 코드가 불필요한 필드(fieldSizes 등)를 추가하지 않았는지
const addedFields = [];
for (let i = 0; i < before.sections.length; i++) {
  for (const key of Object.keys(after.sections[i])) {
    if (!(key in before.sections[i])) addedFields.push("sections[" + i + "]." + key);
  }
}

const result = {
  api: BASE,
  sections: before.sections.length,
  htmlIdentical: htmlBefore === htmlAfter,
  htmlBytes: Buffer.byteLength(htmlBefore),
  badgesPreserved,
  fieldsAddedByMigration: addedFields,
  heroBadgesBefore: heroesB.map((h) => h.badges),
  heroBadgesAfter: heroesA.map((h) => h.badges),
};

console.log(JSON.stringify(result, null, 1));
await writeFile(new URL("./migrate-live-result.json", import.meta.url), JSON.stringify(result, null, 1), "utf8");

const ok = result.htmlIdentical && badgesPreserved && addedFields.length === 0;
console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
