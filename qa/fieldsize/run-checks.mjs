// [검증 1] 마이그레이션/렌더 단위검증 — 변경 후 코드(src/lib/detail-html.ts)가
// 변경 전 기준 출력(qa/fieldsize/baseline-output.json)과 바이트 단위로 같은지,
// 배지 문자열 분리와 fieldSizes 렌더 수식이 의도대로인지 확인한다.
// 실행: node qa/fieldsize/run-checks.mjs
import { readFile, writeFile } from "node:fs/promises";
import * as New from "../../src/lib/detail-html.ts";
import * as Old from "./baseline-detail-html.orig.ts";

const corpus = JSON.parse(await readFile(new URL("./corpus.json", import.meta.url), "utf8"));
const baseline = JSON.parse(await readFile(new URL("./baseline-output.json", import.meta.url), "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : ""));
  return ok;
};

// ── 1. fieldSizes가 없는 문서는 기존 출력과 바이트 단위로 동일 ──────────────
let allByteEqual = true;
for (const [name, doc] of Object.entries(corpus)) {
  const base = baseline[name];
  const htmlEq = New.buildHtml(doc) === base.html;
  const wrapEq = New.buildHtml(doc, true) === base.wrapped;
  const migEq = JSON.stringify(New.migrateDoc(doc)) === base.migrated;
  const idemEq = JSON.stringify(New.migrateDoc(New.migrateDoc(doc))) === base.migratedFromMigrated;
  allByteEqual &&= htmlEq && wrapEq && migEq && idemEq;
  check(
    "byte-identity[" + name + "]",
    htmlEq && wrapEq && migEq && idemEq,
    "html " + (htmlEq ? "=" : "≠") + " / wrapped " + (wrapEq ? "=" : "≠") + " / migrate " + (migEq ? "=" : "≠") + " / idempotent " + (idemEq ? "=" : "≠") + " (" + Buffer.byteLength(base.html) + "B)"
  );
}
{
  const base = baseline["defaultDoc"];
  const d = New.defaultDoc();
  const ok =
    New.buildHtml(d) === base.html &&
    New.buildHtml(d, true) === base.wrapped &&
    JSON.stringify(New.migrateDoc(d)) === base.migrated;
  allByteEqual &&= ok;
  check("byte-identity[defaultDoc()]", ok);
}

// ── 2. 빈 fieldSizes({}) / 존재하지 않는 키 → 여전히 기존 출력과 동일 ────────
{
  const doc = structuredClone(corpus["sizemix"]);
  for (const s of doc.sections) s.fieldSizes = {};
  check(
    "empty fieldSizes == no fieldSizes",
    New.buildHtml(doc) === baseline["sizemix"].html,
    "빈 객체는 마이그레이션에서 키가 사라져야 함: " + JSON.stringify(New.migrateDoc(doc).sections.map((s) => s.fieldSizes ?? null))
  );
}

// ── 3. 배지 마이그레이션(작업2): 문자열 → 3칸 분리, 내용 100% 보존 ─────────
const badgeCases = [
  { input: "A · B · C", want: ["A", "B", "C"] },
  { input: "A·B·C", want: ["A", "B", "C"] },
  { input: "  3PCS · 타원형  ", want: ["3PCS", "타원형", ""] },
  { input: "A · B · C · D", want: ["A", "B", "C", "D"] },
  { input: "하나뿐인 배지", want: ["하나뿐인 배지", "", ""] },
  { input: "", want: ["", "", ""] },
];
for (const c of badgeCases) {
  const got = New.migrateSection({ type: "hero", image: "", title: "", sub: "", badges: c.input });
  const ok = JSON.stringify(got.badges) === JSON.stringify(c.want);
  // 내용 보존: 분리 결과를 다시 " · "로 붙였을 때 원본(빈칸 정리)과 동일
  const joined = got.badges.filter(Boolean).join(" · ");
  const original = c.input.split("·").map((x) => x.trim()).filter(Boolean).join(" · ");
  check(
    "badges-split[" + JSON.stringify(c.input) + "]",
    ok && joined === original,
    "→ " + JSON.stringify(got.badges)
  );
}
{
  // 이미 3칸 배열이면 그대로
  const got = New.migrateSection({ type: "hero", badges: ["x", "y", "z"] });
  check("badges-array-kept", JSON.stringify(got.badges) === JSON.stringify(["x", "y", "z"]));
  // 마이그레이션 2회 적용해도 동일(멱등)
  const twice = New.migrateSection(New.migrateSection({ type: "hero", badges: "A · B · C" }));
  check("badges-idempotent", JSON.stringify(twice.badges) === JSON.stringify(["A", "B", "C"]));
  // 배열이 없던 hero → 빈 3칸
  const none = New.migrateSection({ type: "hero" });
  check("badges-missing-default", JSON.stringify(none.badges) === JSON.stringify(["", "", ""]));
  // 마이그레이션 전후 렌더 내용 동일(배지 3개 모두 화면에 존재)
  const docStr = { brand: "b", name: "n", tagline: "", kind: "living", sections: [{ type: "hero", image: "", title: "t", sub: "s", badges: "first · second · third" }] };
  const html = New.buildHtml(docStr);
  const migrated = New.migrateDoc(docStr);
  const html2 = New.buildHtml(migrated);
  check(
    "badges-render-3",
    html.includes("first") && html.includes("second") && html.includes("third") && html === html2,
    "렌더에 3개 모두 존재 + 마이그레이션 전후 렌더 동일(" + (html === html2 ? "=" : "≠") + ")"
  );
}

// ── 4. fieldSizes 렌더 수식 — (섹션배율) × (필드px / 섹션실효px) ───────────
// problem 기본 24px. body 기본 14pt.
//   fieldSizes.body=12 → 14 × (12/24) = 7pt
//   fieldSizes.body=20 → 14 × (20/24) = 11.67pt
//   fontSize=26 + body=12 → 14 × (26/24) × (12/26) = 14 × 12/24 = 7pt (섹션 배율 상쇄)
const pt = (html, label) => {
  const re = new RegExp('font-size: ([0-9.]+)pt; color: #555555;">' + label);
  const m = html.match(re);
  return m ? Number(m[1]) : null;
};
{
  const mk = (fieldSizes, fontSize) => ({
    brand: "", name: "N", tagline: "", kind: "living",
    sections: [{ type: "problem", title: "", body: "BODYLINE", image: "", ...(fontSize ? { fontSize } : {}), ...(fieldSizes ? { fieldSizes } : {}) }],
  });
  const a = New.buildHtml(mk({ body: 12 }));
  const b = New.buildHtml(mk({ body: 20 }));
  const c = New.buildHtml(mk({ body: 12 }, 26));
  const d = New.buildHtml(mk()); // 상속
  check("formula body=12 → 7pt", pt(a, "BODYLINE") === 7, "got " + pt(a, "BODYLINE") + "pt");
  check("formula body=20 → 11.67pt", pt(b, "BODYLINE") === 11.67, "got " + pt(b, "BODYLINE") + "pt");
  check("formula fontSize=26+body=12 → 7pt", pt(c, "BODYLINE") === 7, "got " + pt(c, "BODYLINE") + "pt");
  check("inherit(값 없음) → 14pt(기존 출력)", pt(d, "BODYLINE") === 14, "got " + pt(d, "BODYLINE") + "pt");
  check("12 vs 20 문서 서로 다름", a !== b);
}
// 필드 크기 clamp: 8~72px 밖 값은 마이그레이션에서 잘린다
{
  const s1 = New.migrateSection({ type: "problem", title: "t", body: "b", fieldSizes: { body: 999 } });
  const s2 = New.migrateSection({ type: "problem", title: "t", body: "b", fieldSizes: { body: 1 } });
  const s3 = New.migrateSection({ type: "problem", title: "t", body: "b", fieldSizes: { body: "큰글씨" } });
  const s4 = New.migrateSection({ type: "problem", title: "t", body: "b", fieldSizes: {} });
  check(
    "fieldSizes sanitize(clamp/invalid/empty)",
    s1.fieldSizes.body === 72 && s2.fieldSizes.body === 8 && s3.fieldSizes === undefined && s4.fieldSizes === undefined,
    JSON.stringify({ clampUp: s1.fieldSizes, clampDown: s2.fieldSizes, invalid: s3.fieldSizes, empty: s4.fieldSizes })
  );
}

// ── 5. 섹션 유형별 필드 키가 실제 렌더에 반영되는지 (대표 1개씩) ───────────
{
  // hero: 배지3칸 개별 크기 → 배지마다 별도 span, 구분자는 섹션 배율(sz) 유지
  const hero = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "hero", image: "", title: "T", sub: "S", notice: "W", badges: ["b1", "b2", "b3"], fieldSizes: { badge0: 48, badge1: 16, badge2: 16, sub: 16, notice: 16, title: 32 } }] });
  const heroOk =
    /font-size: 18pt;[^>]*>b1</.test(hero) && // 12 × 48/32 = 18
    /font-size: 6pt;[^>]*>b2</.test(hero) && // 12 × 16/32 = 6
    /font-size: 6pt;[^>]*>b3</.test(hero) &&
    /font-size: 12pt; color: #666666;"> · </.test(hero); // 구분자는 섹션 배율(12pt)
  check("hero badge0=48→18pt, badge1/2=16→6pt, 구분자 12pt", heroOk);
  // usp/review item
  const usp = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "usp", items: ["01 FIRST", "SECOND"], fieldSizes: { item1: 36 } }] });
  check("usp item1=36 → 14×36/18=28pt", /font-size: 28pt; color: #555555;">SECOND</.test(usp));
  // evidence 치수 개별 span
  const ev = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "evidence", image: "", w: "10", d: "20", h: "30", weight: "1kg", colors: "red", material: "steel", unit: "cm", fieldSizes: { w: 36 } }] });
  check("evidence w=36 → 14×36/18=28pt (개별 span)", /font-size: 28pt; color: #555555;">10</.test(ev) && /font-size: 14pt; color: #555555;">20</.test(ev));
  // notice 표 셀 단위
  const nt = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "notice", caption: "C", rows: [["k0", "v0"], ["k1", "v1"]], fieldSizes: { row1v: 28 } }] });
  check("notice row1v=28 → 12×28/14=24pt", /font-size: 24pt;">v1</.test(nt) && /font-size: 12pt;">v0</.test(nt));
  // notice 문구형 구조화 라인
  const nl = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "notice", title: "배송 안내", lines: [""], fee: "무료", island: "3,000원", leadTime: "2일", fieldSizes: { fee: 28 } }] });
  check("notice fee=28 → 14×28/14=28pt", /font-size: 28pt; color: #555555;">배송비 : 무료</.test(nl) && /font-size: 14pt; color: #555555;">도서산간 : 3,000원</.test(nl));
  // detail 캡션
  const dt = New.buildHtml({ brand: "", name: "N", tagline: "", kind: "living", sections: [{ type: "detail", images: ["i1", "i2"], captions: ["c1", "c2"], fieldSizes: { caption0: 36 } }] });
  check("detail caption0=36 → 12×36/18=24pt", /font-size: 24pt; color: #666666;">c1</.test(dt));
}

// ── 6. PNG 캡처용 wrap 출력 — wrapper 유지 + 필드 크기 반영 + 검증 통과 ────
{
  const doc = { brand: "b", name: "n", tagline: "", kind: "living", sections: [
    { type: "hero", image: "", title: "T", sub: "S", badges: ["b1", "b2", "b3"], fieldSizes: { badge0: 48 } },
    { type: "problem", title: "t", body: "b", image: "", fieldSizes: { body: 20 } },
  ] };
  const wrapped = New.buildHtml(doc, true);
  const okWrap = wrapped.includes('data-png-section="0"') && wrapped.includes('data-png-section="1"') && wrapped.includes("font-size: 18pt") && New.validateHtml(wrapped).length === 0;
  check("png wrapSections=true 회귀", okWrap, "wrapper + 필드 크기(18pt) 포함, validateHtml 이슈 0건");
}

// ── 결과 저장 ──────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
await writeFile(
  new URL("./run-checks-result.json", import.meta.url),
  JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((f) => f.name), results }, null, 1),
  "utf8"
);
console.log("\n" + (failed.length === 0 ? "ALL PASS" : "FAILED: " + failed.map((f) => f.name).join(", ")) + "  (" + (results.length - failed.length) + "/" + results.length + ")");
process.exit(failed.length === 0 ? 0 : 1);
