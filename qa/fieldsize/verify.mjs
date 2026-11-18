// [작업1/작업2] 단위 검증 — node 24 타입 스트리핑으로 .ts를 직접 임포트한다.
//
//  · baseline(qa/fieldsize/baseline-detail-html.orig.ts) = 변경 전 원본 스냅샷
//  · current(../../../src/lib/detail-html.ts) = 변경 후
//
// 실행: node qa/fieldsize/verify.mjs
// 종료 코드: 0 통과 / 1 실패

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = await import(path.join(ROOT, "qa/fieldsize/baseline-detail-html.orig.ts"));
const cur = await import(path.join(ROOT, "src/lib/detail-html.ts"));

const results = [];
let failed = 0;
const clone = (x) => structuredClone(x);
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failed++;
  results.push({ name, ok, detail });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail && !ok ? "  → " + detail : ""));
}

// ---------------------------------------------------------------------------
// 검사 문서
// ---------------------------------------------------------------------------

// 실제 서버 저장 데이터 (스냅샷) — 살아있는 파일이라 읽는 시점에 fieldSizes가
// 들어 있을 수 있다. 바이트 동일성 검사 대상은 "fieldSizes 없는 문서"이므로
// 읽은 뒤 fieldSizes만 떼어낸 사본으로 검사하고, 원본 스냅샷은 out/에 남긴다.
const liveDocRaw = JSON.parse(readFileSync(path.join(ROOT, "data/detail-builder.json"), "utf8"));
mkdirSync(path.join(ROOT, "qa/fieldsize/out"), { recursive: true });
writeFileSync(path.join(ROOT, "qa/fieldsize/out/data-snapshot.json"), JSON.stringify(liveDocRaw, null, 2));
const liveDoc = clone(liveDocRaw);
for (const s of liveDoc.sections) delete s.fieldSizes;

// 8종 템플릿 + 레거시 5종 전부를 담은 합성 문서 (fieldSizes 없음)
const synthDoc = {
  brand: "합성브랜드",
  name: "합성 상품",
  tagline: "한 줄 요약",
  kind: "living",
  sections: [
    { type: "hero", image: "http://example.com/hero.png", title: "히어로 제목", sub: "히어로 부제", notice: "경고 문구", badges: ["3PCS", "", "국내 유통"] },
    { type: "hero", image: "", title: "", sub: "", notice: "", badges: ["", "", ""] },
    { type: "problem", title: "문제공감 제목", body: "첫째 줄\n둘째 줄", image: "http://example.com/p.png", fontSize: 26 },
    { type: "change", title: "생활변화 제목", body: "변화 본문", image: "" },
    { type: "howto", title: "사용법 제목", body: "사용법 본문", image: "" },
    { type: "usp", title: "", items: ["01 번호로 시작하는 항목", "", "세 번째 항목"], fontSize: 20 },
    { type: "review", title: "구매자 후기", items: ["후기 하나", "후기 둘", ""], fontSize: 12 },
    { type: "evidence", image: "", w: "10.5", d: "6.5", h: "3.3", weight: "520g", colors: "아이보리", material: "실리콘", unit: "cm" },
    { type: "evidence", image: "", w: "10cm", d: "", h: "", weight: "", colors: "", material: "", unit: "" },
    { type: "notice", caption: "제품 정보", rows: [["품명", "값"], ["소재", ""], ["제조국", "한국"], ["크기", "해당 없음"]] },
    { type: "notice", title: "배송 안내", lines: ["배송비 : 무료", "도서산간 : 3,000원", "출고 : 2~3일"], fee: "", island: "", leadTime: "" },
    { type: "notice", title: "무상 서비스 안내", lines: [], asPeriod: "6개월", asTerms: "제조 결함 무상" },
    { type: "notice", title: "주의사항", lines: ["첫 줄", " ", "둘째 줄"] },
    { type: "detail", images: ["http://example.com/d1.png", "http://example.com/d2.png"], captions: ["캡션1", "캡션2"] },
    // 레거시 타입 — migrateSection을 거쳐 정규화 렌더된다
    { type: "point", title: "레거시 포인트", body: "포인트 본문", image: "" },
    { type: "check", items: ["레거시 체크"] },
    { type: "size", image: "", w: "1", d: "2", h: "3cm", weight: "4g", colors: "흰색", material: "플라스틱", unit: "" },
    { type: "table", caption: "레거시 표", rows: [["항목", "내용"]] },
    { type: "lines", title: "배송 안내(레거시)", lines: ["배송비 : 2,500원", "출고 : 3일"], fee: "", island: "", leadTime: "" },
  ],
};

// 살아있는 데이터 원본(마이그레이션/항등 검사용 — fieldSizes 포함 그대로)
const liveDocMig = liveDocRaw;

// 합성 문서(바이트 동일성용) — 문자열 배지 히어로는 의도된 동작 변경(내용 보존)이므로 제외

// ---------------------------------------------------------------------------
// 1) 바이트 동일성 — fieldSizes가 없는 문서는 buildHtml 출력이 변경 전과 바이트 단위로 동일
// ---------------------------------------------------------------------------
{
  const cases = [
    ["실제 저장 데이터(data/detail-builder.json) — 기본 호출", liveDoc, false],
    ["실제 저장 데이터 — wrapSections(PNG용)", liveDoc, true],
    ["합성 문서(8종+레거시5종, fontSize 다양) — 기본 호출", synthDoc, false],
    ["합성 문서 — wrapSections", synthDoc, true],
  ];
  for (const [name, doc, wrap] of cases) {
    const a = base.buildHtml(doc, wrap);
    const b = cur.buildHtml(doc, wrap);
    check("[바이트동일] " + name, a === b, a.length + "자 vs " + b.length + "자");
  }

  // fieldSizes: {} (빈 객체)도 없는 것과 동일
  const emptyFs = clone(synthDoc);
  emptyFs.sections[3].fieldSizes = {};
  check(
    "[바이트동일] fieldSizes가 빈 객체면 없는 것과 동일",
    cur.buildHtml(emptyFs) === base.buildHtml(synthDoc)
  );

  // 필드 크기가 '섹션 실효 px'와 같으면 상속과 출력이 동일 (fontSize 26 + body 26)
  const samePx = clone(liveDoc);
  for (const s of samePx.sections) if (s.type === "problem") s.fieldSizes = { body: 26 };
  check(
    "[바이트동일] 필드px == 섹션 실효px(26)면 상속 출력과 동일",
    cur.buildHtml(samePx) === base.buildHtml(liveDoc)
  );
}

// ---------------------------------------------------------------------------
// 2) 마이그레이션 — badges 문자열 → "·" 기준 3칸 분리 (내용 100% 보존)
// ---------------------------------------------------------------------------
{
  const mig = (badges) => cur.migrateSection({ type: "hero", image: "", title: "", sub: "", notice: "", badges }).badges;
  check("[마이그레이션] 'A · B · C' → 3칸 분리", JSON.stringify(mig("A · B · C")) === JSON.stringify(["A", "B", "C"]), JSON.stringify(mig("A · B · C")));
  check("[마이그레이션] 공백 trim", JSON.stringify(mig("  A  · B ·  C ")) === JSON.stringify(["A", "B", "C"]), JSON.stringify(mig("  A  · B ·  C ")));
  check("[마이그레이션] 값 1개 → 빈칸 패딩", JSON.stringify(mig("A")) === JSON.stringify(["A", "", ""]), JSON.stringify(mig("A")));
  check("[마이그레이션] 빈 문자열 → 3빈칸", JSON.stringify(mig("")) === JSON.stringify(["", "", ""]), JSON.stringify(mig("")));
  check("[마이그레이션] 'A · · B' → 빈칸 유지", JSON.stringify(mig("A · · B")) === JSON.stringify(["A", "", "B"]), JSON.stringify(mig("A · · B")));
  check("[마이그레이션] 3칸 초과(4개)도 내용 보존", JSON.stringify(mig("A · B · C · D")) === JSON.stringify(["A", "B", "C", "D"]), JSON.stringify(mig("A · B · C · D")));
  check("[마이그레이션] 이미 3칸 배열은 그대로", JSON.stringify(mig(["X", "Y", "Z"])) === JSON.stringify(["X", "Y", "Z"]));
  check("[마이그레이션] 배열(1칸)은 그대로", JSON.stringify(mig(["X"])) === JSON.stringify(["X"]));
  check("[마이그레이션] undefined → 3빈칸", JSON.stringify(mig(undefined)) === JSON.stringify(["", "", ""]));
  check("[마이그레이션] 숫자 등 이상값 → 3빈칸", JSON.stringify(mig(123)) === JSON.stringify(["", "", ""]));

  // 실제 저장 데이터의 마이그레이션은 항등(이미 배열, fieldSizes 유효값 유지) — 전/후 JSON 동일
  const before = JSON.stringify(liveDocMig);
  const after = JSON.stringify(cur.migrateDoc(liveDocMig));
  check("[마이그레이션] 실제 저장 데이터 전/후 JSON 동일", before === after);

  // 렌더 결과 내용 보존 — 문자열 배지 문서가 배열 배지 문서와 같은 출력을 낸다
  const strDoc = { brand: "b", name: "n", tagline: "", kind: "living", sections: [{ type: "hero", image: "", title: "t", sub: "", notice: "", badges: "3PCS · 타원형 · 국내 유통" }] };
  const arrDoc = clone(strDoc);
  arrDoc.sections[0].badges = ["3PCS", "타원형", "국내 유통"];
  const a = cur.buildHtml(strDoc);
  const b = base.buildHtml(arrDoc);
  check("[마이그레이션] 문자열 배지 렌더 == 배열 배지 렌더(기준 구현)", a === b, a.slice(0, 120) + " vs " + b.slice(0, 120));
  check("[마이그레이션] 문자열 배지 내용이 출력에 100% 존재", ["3PCS", "타원형", "국내 유통"].every((t) => a.includes(t)));
}

// ---------------------------------------------------------------------------
// 3) fieldSizes 마이그레이션 정규화 — 유효 숫자만, 없으면 필드 자체를 두지 않음
// ---------------------------------------------------------------------------
{
  const norm = (fs) => cur.migrateSection({ type: "problem", title: "t", body: "b", image: "", fieldSizes: fs });
  check("[fieldSizes정규화] 200 → 72 클램프", norm({ body: 200 }).fieldSizes.body === 72);
  check("[fieldSizes정규화] 소수 반올림", norm({ body: 8.6 }).fieldSizes.body === 9);
  check("[fieldSizes정규화] 문자열 값 제거", norm({ body: "20" }).fieldSizes === undefined);
  check("[fieldSizes정규화] NaN 제거", norm({ body: NaN }).fieldSizes === undefined);
  check("[fieldSizes정규화] 빈 객체 → 필드 없음", norm({}).fieldSizes === undefined);
  check("[fieldSizes정규화] 섞인 값은 유효값만", JSON.stringify(norm({ body: 20, sub: "x" }).fieldSizes) === JSON.stringify({ body: 20 }));
  check("[fieldSizes정규화] 없으면 그대로 없음", norm(undefined).fieldSizes === undefined);
}

// ---------------------------------------------------------------------------
// 4) 필드 크기 수학 — (섹션배율) × (필드px / 섹션실효px)
// ---------------------------------------------------------------------------
{
  const spanOf = (html, text) => {
    const i = html.indexOf(">" + text + "<");
    if (i < 0) return null;
    const open = html.lastIndexOf("<span", i);
    const m = html.slice(open, i).match(/font-size: ([0-9.]+)pt/);
    return m ? Number(m[1]) : null;
  };
  const render1 = (sec) => cur.buildHtml({ brand: "", name: "상품", tagline: "", kind: "living", sections: [sec] });

  // problem(기본 24px): body 기본 14pt
  const p12 = render1({ type: "problem", title: "제목", body: "본문텍스트", image: "", fieldSizes: { body: 12 } });
  const p20 = render1({ type: "problem", title: "제목", body: "본문텍스트", image: "", fieldSizes: { body: 20 } });
  check("[수학] problem body 12px → 7pt (14×12/24)", spanOf(p12, "본문텍스트") === 7, String(spanOf(p12, "본문텍스트")));
  check("[수학] problem body 20px → 11.67pt (14×20/24)", spanOf(p20, "본문텍스트") === 11.67, String(spanOf(p20, "본문텍스트")));

  // 섹션 fontSize와 상쇄: fontSize 36 + body 20 → 14×1.5×20/36 = 11.67 (fontSize 무관 고정)
  const p36 = render1({ type: "problem", title: "제목", body: "본문텍스트", image: "", fontSize: 36, fieldSizes: { body: 20 } });
  check("[수학] fontSize 36 + body 20 → 동일 11.67pt (배율 상쇄)", spanOf(p36, "본문텍스트") === 11.67, String(spanOf(p36, "본문텍스트")));

  // hero(기본 32px): title 36pt / sub 14pt / notice 11pt / badge 12pt
  const hero = render1({
    type: "hero", image: "", title: "히어로제목", sub: "부제텍스트", notice: "경고텍스트", badges: ["배지일", "배지이", "배지삼"],
    fieldSizes: { title: 16, sub: 48, notice: 64, badge0: 48, badge1: 16 },
  });
  check("[수학] hero title 16px → 18pt (36×16/32)", spanOf(hero, "히어로제목") === 18, String(spanOf(hero, "히어로제목")));
  check("[수학] hero sub 48px → 21pt (14×48/32)", spanOf(hero, "부제텍스트") === 21, String(spanOf(hero, "부제텍스트")));
  check("[수학] hero notice 64px → 22pt (11×64/32)", spanOf(hero, "경고텍스트") === 22, String(spanOf(hero, "경고텍스트")));
  check("[수학] hero badge0 48px → 18pt (12×48/32)", spanOf(hero, "배지일") === 18, String(spanOf(hero, "배지일")));
  check("[수학] hero badge1 16px → 6pt (12×16/32)", spanOf(hero, "배지이") === 6, String(spanOf(hero, "배지이")));
  check("[수학] hero badge2 미지정 → 12pt 상속", spanOf(hero, "배지삼") === 12, String(spanOf(hero, "배지삼")));

  // 개별 배지 크기가 있으면 배지별 span 분리 + '·' 구분 한 줄 유지
  check("[출력] 배지 개별 크기 시 한 줄 · 구분 유지", hero.includes("배지일 · 배지이 · 배지삼") || (hero.includes("배지일") && hero.includes("·")));

  // 빈 배지 가운데 끼임 회귀 — ["A","","C"] + badge2=48 → C가 18pt
  const heroGap = render1({ type: "hero", image: "", title: "t", sub: "", notice: "", badges: ["갭배지A", "", "갭배지C"], fieldSizes: { badge2: 48 } });
  check("[회귀] 빈 배지 뒤 밀림 없음: badge2 48px → C가 18pt", spanOf(heroGap, "갭배지C") === 18, String(spanOf(heroGap, "갭배지C")));
  check("[회귀] 빈 배지 앞 항목은 상속 12pt", spanOf(heroGap, "갭배지A") === 12, String(spanOf(heroGap, "갭배지A")));

  // usp(기본 18px) 항목 — 빈 항목 회귀 + 01 번호 강조 경로
  const uspGap = render1({ type: "usp", title: "", items: ["항목에이", "", "항목씨"], fieldSizes: { item2: 36 } });
  check("[회귀] 빈 항목 뒤 밀림 없음: item2 36px → 28pt (14×36/18)", spanOf(uspGap, "항목씨") === 28, String(spanOf(uspGap, "항목씨")));
  const uspNum = render1({ type: "usp", title: "", items: ["01 번호항목", "02 둘째"], fieldSizes: { item0: 36 } });
  check("[수학] 01 번호 강조 항목도 크기 적용 (28pt)", uspNum.includes("font-size: 28pt; color: #555555;"), "");

  // review(기본 16px)
  const rev = render1({ type: "review", title: "", items: ["후기하나", "후기둘"], fieldSizes: { item1: 32 } });
  check("[수학] review item1 32px → 28pt (14×32/16)", spanOf(rev, "후기둘") === 28, String(spanOf(rev, "후기둘")));

  // evidence(기본 18px) — 치수 분할 span / weight / colors / material
  const ev = render1({ type: "evidence", image: "", w: "10.5", d: "6.5", h: "3.3", weight: "520g", colors: "아이보리", material: "실리콘", unit: "cm", fieldSizes: { d: 36, weight: 36, colors: 9 } });
  check("[수학] evidence d 36px → 28pt (치수 분할 span)", spanOf(ev, "6.5") === 28, String(spanOf(ev, "6.5")));
  check("[수학] evidence w 미지정 → 14pt 상속(분할 span)", spanOf(ev, "10.5") === 14, String(spanOf(ev, "10.5")));
  check("[출력] 치수 분할 시 마지막 값+단위 한 덩어리", ev.includes(">3.3cm<"), "");
  check("[수학] evidence weight 36px → 28pt", spanOf(ev, "무게 : 520g") === 28, String(spanOf(ev, "무게 : 520g")));
  check("[수학] evidence colors 9px → 7pt", spanOf(ev, "색상 : 아이보리") === 7, String(spanOf(ev, "색상 : 아이보리")));
  check("[수학] evidence material 18px(=기본) → 상속과 동일 14pt", spanOf(ev, "소재 : 실리콘") === 14, String(spanOf(ev, "소재 : 실리콘")));
  // 크기 지정 없으면 치수는 한 덩어리 span (바이트 동일 경로)
  const evPlain = render1({ type: "evidence", image: "", w: "10.5", d: "6.5", h: "3.3", weight: "", colors: "", material: "", unit: "cm" });
  const evPlainBase = base.buildHtml({ brand: "", name: "상품", tagline: "", kind: "living", sections: [{ type: "evidence", image: "", w: "10.5", d: "6.5", h: "3.3", weight: "", colors: "", material: "", unit: "cm" }] });
  check("[바이트동일] evidence 치수 크기 미지정 → 한 덩어리 span 유지", evPlain === evPlainBase);

  // notice 표(기본 14px) — 행/열별 키, 빈 행 필터 후에도 원본 행 번호 유지
  const rowsDoc = render1({
    type: "notice", caption: "표제목", rows: [["품명", "값A"], ["소재", ""], ["제조국", "값C"]],
    fieldSizes: { caption: 28, row0k: 21, row2v: 28 },
  });
  check("[수학] notice caption 28px → 48pt (24×28/14)", spanOf(rowsDoc, "표제목") === 48, String(spanOf(rowsDoc, "표제목")));
  check("[수학] notice row0k 21px → 18pt (12×21/14)", spanOf(rowsDoc, "품명") === 18, String(spanOf(rowsDoc, "품명")));
  check("[수학] notice row2v 28px → 24pt (12×28/14)", spanOf(rowsDoc, "값C") === 24, String(spanOf(rowsDoc, "값C")));
  check("[출력] 값 빈 행(소재)은 출력에서 제외", !rowsDoc.includes(">소재<"), "");

  // notice 문구(기본 14px) — 구조화 3줄(fee/island/leadTime)과 자유 문구(lines)
  const shipDoc = render1({ type: "notice", title: "배송 안내", lines: [""], fee: "무료", island: "3,000원", leadTime: "2~3일", fieldSizes: { title: 28, fee: 28, leadTime: 21 } });
  check("[수학] 배송비(fee) 28px → 28pt", spanOf(shipDoc, "배송비 : 무료") === 28, String(spanOf(shipDoc, "배송비 : 무료")));
  check("[수학] 도서산간 미지정 → 14pt 상속", spanOf(shipDoc, "도서산간 : 3,000원") === 14, String(spanOf(shipDoc, "도서산간 : 3,000원")));
  check("[수학] 출고(leadTime) 21px → 21pt", spanOf(shipDoc, "출고 : 2~3일") === 21, String(spanOf(shipDoc, "출고 : 2~3일")));
  const freeDoc = render1({ type: "notice", title: "주의사항", lines: ["자유첫줄", "자유둘째줄"], fieldSizes: { lines: 28 } });
  check("[수학] 자유 문구(lines) 28px → 28pt(전체 문단)", spanOf(freeDoc, "자유첫줄") === 28 && spanOf(freeDoc, "자유둘째줄") === 28, spanOf(freeDoc, "자유첫줄") + "/" + spanOf(freeDoc, "자유둘째줄"));

  // detail(기본 18px) — 캡션0/1
  const det = render1({ type: "detail", images: ["http://e/1.png", "http://e/2.png"], captions: ["첫캡션", "둘캡션"], fieldSizes: { caption0: 36 } });
  check("[수학] detail caption0 36px → 24pt (12×36/18)", spanOf(det, "첫캡션") === 24, String(spanOf(det, "첫캡션")));
  check("[수학] detail caption1 미지정 → 12pt 상속", spanOf(det, "둘캡션") === 12, String(spanOf(det, "둘캡션")));

  // 클램프/이상값
  const clamped = render1({ type: "problem", title: "t", body: "클램프본문", image: "", fieldSizes: { body: 200 } });
  check("[클램프] body 200px → 72px로 클램프 → 42pt", spanOf(clamped, "클램프본문") === 42, String(spanOf(clamped, "클램프본문")));
  const junk = render1({ type: "problem", title: "t", body: "정크본문", image: "", fieldSizes: { body: NaN } });
  const inherit = render1({ type: "problem", title: "t", body: "정크본문", image: "" });
  check("[방어] NaN 필드값은 무시(상속과 동일 출력)", junk === inherit);
}

// ---------------------------------------------------------------------------
// 5) 배지 3칸 입력 → 렌더 HTML에 3개 모두 존재
// ---------------------------------------------------------------------------
{
  const doc = {
    brand: "b", name: "n", tagline: "", kind: "living",
    sections: [{ type: "hero", image: "", title: "t", sub: "", notice: "", badges: ["첫번째배지", "두번째배지", "세번째배지"] }],
  };
  const html = cur.buildHtml(doc);
  check("[배지3칸] 렌더 HTML에 3개 모두 존재", ["첫번째배지", "두번째배지", "세번째배지"].every((t) => html.includes(t)));
  check("[배지3칸] 한 줄 · 구분 출력", html.includes("첫번째배지 · 두번째배지 · 세번째배지"));
}

// ---------------------------------------------------------------------------
// 6) PNG 경로 입력 회귀 — wrapSections 래퍼 구조 + 검증 + 언랩 동일성
// ---------------------------------------------------------------------------
{
  const doc = clone(synthDoc);
  doc.sections[3].fieldSizes = { body: 20 }; // problem
  doc.sections[0].fieldSizes = { badge0: 48, badge2: 24 }; // hero
  const wrapped = cur.buildHtml(doc, true);
  const plain = cur.buildHtml(doc);
  const wrappers = (wrapped.match(/<div data-png-section="/g) || []).length;
  check("[PNG경로] 래퍼 개수 = 내용 있는 섹션 수(" + wrappers + ")", wrappers === (plain ? wrapped.split("<div data-png-section=").length - 1 : 0) && wrappers > 0);
  // 래퍼 내부를 순서대로 이어붙이면 기본 호출 출력과 동일
  const inner = wrapped.split(/<div data-png-section="\d+" style="margin:0;padding:0;border:0;">/).slice(1).map((s) => s.replace(/<\/div>$/, ""));
  check("[PNG경로] 래퍼 내부 이어붙이기 = 기본 호출 출력", inner.join("") === plain);
  check("[PNG경로] 필드 크기가 래퍼 출력에도 반영(body 11.67pt)", wrapped.includes("font-size: 11.67pt"));
  check("[PNG경로] validateHtml 경고 0건", cur.validateHtml(wrapped).length === 0, cur.validateHtml(wrapped).join(", "));
  check("[PNG경로] 래퍼 스타일 고정(margin:0;padding:0;border:0)", wrapped.includes('style="margin:0;padding:0;border:0;"'));
}

// ---------------------------------------------------------------------------
// 리포트
// ---------------------------------------------------------------------------
mkdirSync(path.join(ROOT, "qa/fieldsize/out"), { recursive: true });
writeFileSync(path.join(ROOT, "qa/fieldsize/out/verify-report.json"), JSON.stringify({ passed: results.filter((r) => r.ok).length, failed, results }, null, 2));
console.log("\n" + (failed === 0 ? "모두 통과" : failed + "건 실패") + " — " + results.filter((r) => r.ok).length + "/" + results.length);
process.exit(failed === 0 ? 0 : 1);
