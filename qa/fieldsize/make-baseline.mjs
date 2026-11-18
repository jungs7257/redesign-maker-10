// 바이트 동일성 검증의 기준 출력 생성 — 변경 "전" 코드(qa/fieldsize/baseline-detail-html.orig.ts)로
// 코퍼스 문서들을 렌더한 결과를 baseline-output.json에 저장한다.
// 실행: node qa/fieldsize/make-baseline.mjs  (코드 변경 전 1회만 실행)
import { readFile, writeFile } from "node:fs/promises";
import * as Old from "./baseline-detail-html.orig.ts";

const corpus = JSON.parse(await readFile(new URL("./corpus.json", import.meta.url), "utf8"));

const out = {};
for (const [name, doc] of Object.entries(corpus)) {
  const d = Old.migrateDoc(doc);
  out[name] = {
    html: Old.buildHtml(doc),
    wrapped: Old.buildHtml(doc, true),
    migrated: JSON.stringify(d),
    migratedFromMigrated: JSON.stringify(Old.migrateDoc(d)),
  };
}
// defaultDoc() 오브젝트도 기준으로 남긴다(빈 문서·기본 문서 경계).
{
  const d = Old.defaultDoc();
  out["defaultDoc"] = {
    html: Old.buildHtml(d),
    wrapped: Old.buildHtml(d, true),
    migrated: JSON.stringify(Old.migrateDoc(d)),
    migratedFromMigrated: JSON.stringify(Old.migrateDoc(Old.migrateDoc(d))),
  };
}

await writeFile(new URL("./baseline-output.json", import.meta.url), JSON.stringify(out, null, 1), "utf8");
console.log("baseline written:", Object.keys(out).join(", "));
