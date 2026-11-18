// 상세페이지 빌더 — 렌더/마이그레이션 순수 로직(React 의존 없음).
//
// 이 파일은 브라우저 없이 node로 직접 임포트해 검증할 수 있어야 해서
// DOM/React를 전혀 쓰지 않는다. 화면 컴포넌트(src/components/detail-builder.tsx)는
// 여기 있는 함수만 가져다 쓴다.
//
// 섹션 체계(8종 템플릿): hero / problem(문제공감) / change(생활변화) / usp(차별점) /
// evidence(근거·신뢰) / howto(사용법) / review(후기카드) / notice(상품고시).
// 예전 타입(point/check/size/table/lines)은 읽는 시점에 가장 유사한 템플릿으로
// 매핑된다(내용은 절대 버리지 않는다). detail은 커스텀으로 그대로 유지.

export type Kind = "living" | "fashion" | "food";

/** 모든 섹션이 가질 수 있는 편집 필드 — 글자 크기(px). 없으면 타입별 기본값. */
type WithFontSize = { fontSize?: number };

// [작업1] 섹션 안 개별 텍스트 칸(입력칸)의 글자 크기(px).
// 키는 렌더되는 텍스트 요소 단위로 붙인다:
//   hero      : title, sub, badge0~badgeN-1, notice
//   problem/change/howto : title, body(본문 전체 문단)
//   usp/review: title, item0~itemN-1
//   evidence  : title, w, d, h(치수 라인 구성값), weight, colors, material
//   notice(표): caption, row{N}k / row{N}v (N=편집 폼의 행 번호)
//   notice(문구): title, fee, island, leadTime, asPeriod, asTerms, lines(자유 문구 전체)
//   detail    : caption0, caption1
// 값이 없는 칸은 섹션 기본(fontSize → fontScale)을 상속한다(렌더 출력은 예전과 동일).
type WithFieldSizes = { fieldSizes?: Record<string, number> };

export type Section = WithFontSize & WithFieldSizes & { bg?: string } &
  (
    | { type: "hero"; image: string; title: string; sub: string; notice?: string; badges?: string[] }
    | { type: "problem" | "change" | "howto"; title: string; body: string; image: string }
    | { type: "usp"; title?: string; items: string[] }
    | { type: "evidence"; title?: string; image: string; w: string; d: string; h: string; weight: string; colors: string; material: string; unit?: string }
    | { type: "review"; title?: string; items: string[] }
    | { type: "notice"; caption?: string; rows?: [string, string][]; title?: string; lines?: string[]; fee?: string; island?: string; leadTime?: string; asPeriod?: string; asTerms?: string }
    | { type: "detail"; images: [string, string]; captions?: [string, string] }
    // 레거시(마이그레이션 전) 형태 — 아래 타입은 migrateSection을 거쳐 위 8종으로 바뀐다.
    | { type: "point"; title: string; body: string; image: string }
    | { type: "check"; items: string[] }
    | { type: "size"; image: string; w: string; d: string; h: string; weight: string; colors: string; material: string; unit?: string }
    | { type: "table"; caption: string; rows: [string, string][] }
    | { type: "lines"; title: string; lines: string[]; fee?: string; island?: string; leadTime?: string; asPeriod?: string; asTerms?: string }
  );

export type Doc = {
  brand: string;
  name: string;
  tagline: string;
  kind: Kind;
  sections: Section[];
};

export const KIND_LABELS: Record<Kind, { size: string[]; table: [string, string][] }> = {
  living: {
    size: ["가로 W", "깊이 D", "높이 H", "무게"],
    table: [["구성품", ""], ["조립 여부", ""], ["관리 방법", ""], ["사용 환경", ""]],
  },
  fashion: {
    size: ["총장", "어깨", "가슴", "소매"],
    table: [["소재", ""], ["세탁", ""], ["신축성", ""], ["안감", ""]],
  },
  food: {
    size: ["중량", "개수", "보관 온도", ""],
    table: [["원산지", ""], ["유통기한", ""], ["보관", ""], ["조리", ""]],
  },
};

// ---------------------------------------------------------------------------
// 섹션 템플릿(8종) 정의 — "섹션 추가" UI와 섹션 헤더 라벨에 쓴다.
// ---------------------------------------------------------------------------

export const TEMPLATE_LABELS: Record<string, string> = {
  hero: "히어로",
  problem: "문제공감",
  change: "생활변화",
  usp: "차별점",
  evidence: "근거·신뢰",
  howto: "사용법",
  review: "후기카드",
  notice: "상품고시",
  detail: "DETAIL(커스텀)",
};

export const SECTION_TEMPLATES: { type: Section["type"]; label: string; hint: string }[] = [
  { type: "hero", label: "히어로", hint: "대표 이미지 + 제목/부제" },
  { type: "problem", label: "문제공감", hint: "이런 불편 있으셨죠" },
  { type: "change", label: "생활변화", hint: "사용 후 달라진 생활" },
  { type: "usp", label: "차별점", hint: "왜 사야 하는지(이득)" },
  { type: "evidence", label: "근거·신뢰", hint: "규격·스펙 표 형태 유지" },
  { type: "howto", label: "사용법", hint: "사용 순서 안내" },
  { type: "review", label: "후기카드", hint: "구매자 후기" },
  { type: "notice", label: "상품고시", hint: "고시 정보 표" },
];

// 레거시 타입 → 8종 템플릿 매핑. 매핑되지 않는 타입(detail 등)은 커스텀으로 유지.
export const LEGACY_TYPE_MAP: Record<string, string> = {
  point: "problem",
  check: "usp",
  size: "evidence",
  table: "notice",
  lines: "notice",
};

// ---------------------------------------------------------------------------
// 글자 크기 — 섹션 객체의 fontSize(px). 없으면 타입별 기본값(읽기 시점에만 적용).
// 기본값일 때 렌더 출력은 예전과 바이트 단위로 같다(fontSize는 배율로만 작동).
// ---------------------------------------------------------------------------

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;

export const DEFAULT_FONT_SIZE: Record<string, number> = {
  hero: 32,
  problem: 24,
  change: 24,
  usp: 18,
  evidence: 18,
  howto: 18,
  review: 16,
  notice: 14,
  detail: 18,
  // 레거시 타입 예비값(마이그레이션 전 문서를 직접 렌더하는 방어 코드용)
  point: 24,
  check: 18,
  size: 18,
  table: 14,
  lines: 14,
};

export function clampFontSize(v: number): number {
  if (!Number.isFinite(v)) return 18;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

/** 섹션의 실효 글자 크기(px). fontSize 필드가 없으면 타입별 기본값. */
export function sectionFontSize(sec: Section): number {
  const def = DEFAULT_FONT_SIZE[sec.type] ?? 18;
  const raw = sec.fontSize;
  const v = typeof raw === "number" && Number.isFinite(raw) ? raw : def;
  return clampFontSize(v);
}

/** 기본값 대비 배율. 기본일 때 정확히 1 → 렌더 출력이 예전과 동일하다. */
export function fontScale(sec: Section): number {
  const def = DEFAULT_FONT_SIZE[sec.type] ?? 18;
  return sectionFontSize(sec) / def;
}

// [작업1] 필드(개별 텍스트 칸) 단위 글자 크기 — fieldSizes[key](px).
// 렌더 배율은 (섹션배율 k) × (필드px / 섹션 실효 px) 이다:
//   · 값이 없으면 배율 1 → 기존 sz(pt) 출력과 바이트 단위로 동일.
//   · 값이 (입력 시점의 섹션 실효 px)와 같으면 역시 배율 1(= 상속과 같은 크기).
//   · 필드에 값을 지정하면 그 칸은 fieldPx/기본px 배율로 고정된다(섹션 fontSize와는 무관).
export function fieldSize(sec: Section, key: string): number | undefined {
  const v = sec.fieldSizes?.[key];
  return typeof v === "number" && Number.isFinite(v) ? clampFontSize(v) : undefined;
}

/** 필드 배율 — fieldSizes[key] px를 섹션 실효 px 대비 비율로 바꾼다. 없으면 1(상속). */
export function fieldScale(sec: Section, key: string): number {
  const px = fieldSize(sec, key);
  return px === undefined ? 1 : px / sectionFontSize(sec);
}


// ---------------------------------------------------------------------------
// HTML 조립 — 복사/HTML 내보내기/PNG 캡처 모두 이 출력을 공유한다.
// ---------------------------------------------------------------------------

// F1 — 값이 비었거나 의미 없는 값으로 판정되는 표 셀
const BLANK_VALUE_RE = /^(해당\s*없음|해당없음|없음|-|—|n\/a)$/i;

export function isBlankCell(v: unknown): boolean {
  const t = String(v ?? "").trim();
  return t === "" || BLANK_VALUE_RE.test(t);
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function P(inner: string): string {
  return '<p style="text-align: center;">' + inner + "</p>";
}

function SP(txt: string, size: number, color?: string, bold?: boolean): string {
  let st = "font-family: arial, helvetica, sans-serif; font-size: " + size + "pt;";
  if (color) st += " color: " + color + ";";
  return '<span style="' + st + '">' + (bold ? "<strong>" + esc(txt) + "</strong>" : esc(txt)) + "</span>";
}

function BR(): string {
  return P("&nbsp;");
}

function IMG(src: string): string {
  if (!src) {
    return P('<span style="font-size: 12pt; color: #b6c0c9;">[이미지]</span>');
  }
  return '<p style="text-align: center;"><img src="' + src + '" alt="" width="780" /></p>';
}

type Sz = (pt: number) => number;

// 표 셀 하나의 pt 크기 — (행 번호, 열(0=항목/1=값), 기본 pt)를 받는다.
// 행 번호는 편집 폼의 원본 rows 인덱스를 그대로 쓴다(fieldSizes.row{n}k/v와 1:1).
type CellSize = (rowIdx: number, col: 0 | 1, pt: number) => number;

function TABLE(rows: [string, string][], cellSize: CellSize): string {
  let b = '<table style="border-collapse: collapse; width: 62%; margin-left: auto; margin-right: auto;" border="1"><tbody>';
  rows.forEach((r, ri) => {
    // F1 — 값이 비었거나 '해당 없음'/'-'/'없음'인 행은 출력하지 않는다
    if (isBlankCell(r[0]) && isBlankCell(r[1])) return;
    if (isBlankCell(r[1])) return;
    b += '<tr><td style="width: 30%; text-align: center; padding: 9px;">' + SP(r[0], cellSize(ri, 0, 12)) + '</td><td style="text-align: center; padding: 9px;">' + SP(r[1], cellSize(ri, 1, 12)) + "</td></tr>";
  });
  return b + "</tbody></table>";
}

// 문구 줄의 pt 크기 — (원본 줄 인덱스, 기본 pt)를 받는다.
type LineSize = (idx: number, pt: number) => number;

function LINES(lines: string[], sizeAt: LineSize): string {
  const a = lines.map((x, i) => ({ x, i })).filter((e) => e.x.trim());
  if (a.length === 0) return "";
  return a.map((e) => P(SP(e.x, sizeAt(e.i, 14), "#555555"))).join("\n");
}

export function isShippingSection(title: string): boolean {
  return /배송/.test(title || "");
}

export function isFreeServiceSection(title: string): boolean {
  return /무상|a\/s/i.test(title || "");
}

// 섹션 1개분의 HTML. 복사/HTML 내보내기 출력은 이 함수를 그대로 합친 결과다.
// 레거시 타입이 새어 들어와도 migrateSection으로 정규화한 뒤 렌더한다.
export function sectionHtml(doc: Doc, input: Section): string {
  const sec = migrateSection(input);
  const k = fontScale(sec);
  // 기본 글자 크기면 배율이 정확히 1이라 예전 출력과 바이트 단위로 같다.
  const sz: Sz = (pt: number) => Math.round(pt * k * 100) / 100;
  // [작업1] 필드별 크기 — fieldSizes[key](px)가 있으면 (필드px / 섹션 실효 px)를
  // 추가 배율로 곱한다. 키에 값이 없으면 배율 1 → sz(pt)와 완전히 같은 출력.
  const szf = (key: string, pt: number): number => {
    const fk = fieldScale(sec, key);
    return fk === 1 ? sz(pt) : Math.round(pt * k * fk * 100) / 100;
  };
  let h = "";
  if (sec.type === "hero") {
    if (doc.brand) h += P(SP(doc.brand, sz(12), "#888888")) + BR();
    h += P(SP(sec.title || doc.name || "[상품명]", szf("title", 36), "#111111", true)) + BR();
    if (sec.sub || doc.tagline) h += P(SP(sec.sub || doc.tagline, szf("sub", 14), "#555555")) + BR();
    // F4 — 배지: 부제 아래, 경고 위, 한 줄로 (배경 없이 · 구분)
    // [작업2] 배지마다 개별 크기(badge0~)를 줄 수 있다. 지정이 하나라도 있을 때만
    // 배지별 span으로 쪼개고, 없으면 예전처럼 한 덩어리 span(바이트 동일 출력).
    // 크기 키는 '원본 배열 인덱스' 기준 — 빈 배지가 가운데 끼어도 편집 폼의
    // N번째 칸(badgeN)과 출력이 어긋나지 않는다.
    const badges = (sec.badges ?? [])
      .map((b, bi) => ({ t: (b || "").trim(), bi }))
      .filter((x) => x.t);
    if (badges.length) {
      const anyBadgeSize = badges.some((x) => fieldScale(sec, "badge" + x.bi) !== 1);
      if (!anyBadgeSize) {
        h += P(SP(badges.map((x) => x.t).join(" · "), sz(12), "#666666")) + BR();
      } else {
        const sep = SP(" · ", sz(12), "#666666");
        h += P(badges.map((x) => SP(x.t, szf("badge" + x.bi, 12), "#666666")).join(sep)) + BR();
      }
    }
    // F3 — 상단 경고 문구: 반품 사유 예방
    const notice = (sec.notice ?? "").trim();
    if (notice) h += P(SP(notice, szf("notice", 11), "#c0392b")) + BR();
    if (sec.image) h += IMG(sec.image) + BR() + BR() + BR();
  } else if (sec.type === "problem" || sec.type === "change" || sec.type === "howto") {
    // 문제공감/생활변화/사용법 — 예전 point 렌더와 동일(본문형 섹션)
    if (!sec.title && !sec.body) return "";
    h += P(SP(sec.title, szf("title", 24), "#111111", true)) + BR();
    if (sec.body) h += LINES(sec.body.split("\n"), (_i, pt) => szf("body", pt)) + BR();
    if (sec.image) h += IMG(sec.image) + BR();
    h += BR() + BR();
  } else if (sec.type === "usp" || sec.type === "review") {
    // 차별점(예전 CHECK POINT)/후기카드 — 예전 check 렌더와 동일(항목형 섹션)
    // [작업1] 항목 크기 키(item0~)도 원본 items 인덱스 기준 — 빈 항목이 가운데
    // 끼어도 편집 폼의 N번째 칸(itemN)과 출력이 어긋나지 않는다.
    const items = sec.items.map((t, ii) => ({ t, ii })).filter((x) => x.t);
    if (items.length === 0) return "";
    const heading = sec.type === "usp" ? sec.title || "CHECK POINT" : sec.title || "REVIEW";
    h += P(SP(heading, szf("title", 36), "#111111", true)) + BR();
    items.forEach(({ t: raw, ii }) => {
      let t = esc(raw);
      const num = t.match(/^0\d/);
      if (num) {
        t = t.replace(/^(0\d)\s*/, "<strong>$1</strong> ");
        h += P('<span style="font-family: arial, helvetica, sans-serif; font-size: ' + szf("item" + ii, 14) + 'pt; color: #555555;">' + t + "</span>");
      } else {
        h += P(SP(raw, szf("item" + ii, 14), "#555555"));
      }
    });
    h += BR() + BR() + BR();
  } else if (sec.type === "evidence") {
    // 근거·신뢰 — 예전 size 렌더와 동일(스펙/표 형태 그대로, 제목만 편집 가능)
    const labels = KIND_LABELS[doc.kind].size;
    const vals = [sec.w, sec.d, sec.h, sec.weight];
    // F2 — 치수는 '10.5 × 6.5 × 3.3cm' 형태로, 단위는 마지막에 1회만
    // [작업1] 치수값(w/d/h)은 개별 입력칸이라 필드 키를 함께 들고 다닌다.
    const dimsRaw: { v: string; key: string }[] = [
      { v: (sec.w ?? "").trim(), key: "w" },
      { v: (sec.d ?? "").trim(), key: "d" },
      { v: (sec.h ?? "").trim(), key: "h" },
    ].filter((x) => x.v);
    const dims = dimsRaw.map((x) => x.v);
    const dimsHaveUnit = dims.some((v) => /(cm|mm|m|인치|inch)/i.test(v));
    const unit = ((sec.unit ?? "") || "cm").trim();
    const dimsLine = dims.length
      ? dimsHaveUnit ? dims.join(" × ") : dims.join(" × ") + unit
      : "";
    const hasAny = dims.length || vals[3] || sec.colors || sec.material || sec.image;
    if (!hasAny) return "";
    h += P(SP(sec.title || "SIZE & COLOR", szf("title", 36), "#111111", true)) + BR();
    if (sec.image) h += IMG(sec.image) + BR();
    if (dimsLine) {
      const anyDimSize = dimsRaw.some((x) => fieldScale(sec, x.key) !== 1);
      if (!anyDimSize) {
        // 개별 치수 크기 지정이 없으면 예전처럼 한 덩어리 span (바이트 동일)
        h += P(SP(dimsLine, sz(14), "#555555"));
      } else {
        // 지정이 있을 때만 치수값마다 별도 span. 구분자( × )와 단위는 섹션 배율을 따른다.
        const sep = SP(" × ", sz(14), "#555555");
        h += P(
          dimsRaw
            .map((x, di) => {
              const isLast = di === dimsRaw.length - 1;
              const text = isLast && !dimsHaveUnit ? x.v + unit : x.v;
              return SP(text, szf(x.key, 14), "#555555");
            })
            .join(sep)
        );
      }
    }
    if (vals[3]) h += P(SP(labels[3] + " : " + esc(vals[3]), szf("weight", 14), "#555555"));
    if (sec.colors) h += P(SP("색상 : " + esc(sec.colors), szf("colors", 14), "#555555"));
    if (sec.material) h += P(SP("소재 : " + esc(sec.material), szf("material", 14), "#555555"));
    h += BR() + BR() + BR();
  } else if (sec.type === "notice") {
    // 상품고시 — 두 형태를 보존한다:
    //  · rows(예전 table): 표 형태 그대로
    //  · lines(예전 lines: 배송/주의/무상서비스): 문구 형태 그대로
    if (Array.isArray(sec.rows)) {
      // F1 — 화면에 나올 행만 남긴다 (값이 빈 행/해당 없음 행 제외)
      const visibleRows = sec.rows.filter((r) => !isBlankCell(r[1]));
      if (visibleRows.length === 0) return "";
      // TABLE에는 원본 rows를 그대로 넘긴다(내부에서 빈 행을 걸러낸다).
      // 그래야 cellSize의 행 번호가 편집 폼의 행 번호(row{n}k/v 키)와 1:1로 맞는다.
      const cellSize: CellSize = (ri, col, pt) => szf("row" + ri + (col === 0 ? "k" : "v"), pt);
      h += P(SP(sec.caption ?? "", szf("caption", 24), "#111111", true)) + BR() + TABLE(sec.rows, cellSize) + BR() + BR();
    } else {
      const out: { text: string; key: string }[] = [];
      const title = sec.title ?? "";
      // F6 — 배송 안내: 배송비/도서산간/출고 3줄 분리 (각 줄 = 편집 입력칸 1:1)
      if (isShippingSection(title)) {
        const fee = (sec.fee ?? "").trim();
        const island = (sec.island ?? "").trim();
        const lead = (sec.leadTime ?? "").trim();
        if (fee) out.push({ text: "배송비 : " + fee, key: "fee" });
        if (island) out.push({ text: "도서산간 : " + island, key: "island" });
        if (lead) out.push({ text: "출고 : " + lead, key: "leadTime" });
      }
      // F7 — 무상 서비스: 기간/조건
      if (isFreeServiceSection(title)) {
        const p = (sec.asPeriod ?? "").trim();
        const t = (sec.asTerms ?? "").trim();
        if (p) out.push({ text: "기간 : " + p, key: "asPeriod" });
        if (t) out.push({ text: "조건 : " + t, key: "asTerms" });
      }
      // 구조화 필드가 비어 있으면 기존 자유 문구로 대체 (데이터 손실 방지)
      const filled = out.length ? out : (sec.lines ?? []).filter((l) => l.trim()).map((l) => ({ text: l, key: "lines" }));
      if (filled.length === 0) return "";
      h += P(SP(title, szf("title", 24), "#111111", true)) + BR() + filled.map((e) => P(SP(e.text, szf(e.key, 14), "#555555"))).join("\n") + BR() + BR();
    }
  } else if (sec.type === "detail") {
    // 커스텀 유지 섹션 — 예전 detail 렌더와 동일
    const has = sec.images.filter(Boolean).length;
    if (has === 0) return "";
    h += P(SP("DETAIL", sz(36), "#111111", true)) + BR();
    for (let k = 0; k < sec.images.length; k++) {
      const im = sec.images[k];
      if (im) {
        h += IMG(im) + BR();
        // F5 — 이미지별 캡션 (1:1 대응)
        const cap = (sec.captions?.[k] ?? "").trim();
        if (cap) h += P(SP(cap, szf("caption" + k, 12), "#666666")) + BR();
      }
    }
    h += BR() + BR();
  }
  return h;
}

// 기본 호출(인자 없음)은 기본 글자 크기일 때 예전 buildHtml과 바이트 단위로
// 동일한 문자열을 만든다. wrapSections=true는 PNG 캡처용으로만 섹션 wrapper를
// 덧씌운다. wrapper에 margin/padding/border를 0으로 고정해 조각 높이가
// 단순히 더해지게 한다.
export function buildHtml(doc: Doc, wrapSections = false, showBoundary = false): string {
  let h = "";
  for (let i = 0; i < doc.sections.length; i++) {
    const sec = doc.sections[i];
    const part = sectionHtml(doc, sec);
    if (!part) continue;
    // 기본 호출(인자 없음, 배경색 미지정)은 예전 출력과 바이트 단위로 동일하게
    // wrapper 없이 그대로 내보낸다. wrapper는 캡처 분할/경계 표시/배경색 중
    // 하나라도 필요할 때만 덧씌운다.
    const bg = typeof sec.bg === "string" && sec.bg.trim() ? sec.bg.trim() : "";
    if (!wrapSections && !showBoundary && !bg) {
      h += part;
      continue;
    }
    let style = "margin:0;padding:0;border:0;";
    if (bg) style += "background:" + bg + ";";
    if (showBoundary) style += "outline:2px dashed #7c3aed;outline-offset:-2px;";
    h += '<div data-png-section="' + i + '" style="' + style + '">' + part + "</div>";
  }
  return h;
}

// F10 — 복사 결과 자체 검증
export function validateHtml(html: string): string[] {
  const issues: string[] = [];
  const scripts = (html.match(/<script/gi) || []).length;
  const styles = (html.match(/<style/gi) || []).length;
  if (scripts > 0) issues.push("<script " + scripts + "개 포함");
  if (styles > 0) issues.push("<style " + styles + "개 포함");
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const badWidth = imgs.filter((t) => !/width\s*=\s*"780"/.test(t));
  if (badWidth.length > 0) issues.push('width="780" 없는 이미지 ' + badWidth.length + "개");
  if (/\[이미지\]/.test(html)) issues.push("이미지 주소가 비어 있는 자리가 출력에 포함됨");
  if (/\[상품명\]/.test(html)) issues.push("상품명이 비어 있음");
  if (/undefined|NaN/.test(html)) issues.push("undefined/NaN이 출력에 포함됨");
  return issues;
}

// ---------------------------------------------------------------------------
// 마이그레이션 — 레거시 타입을 8종 템플릿으로 매핑 + 필드 정규화.
// 원본 내용(텍스트·이미지·행)은 절대 버리지 않는다. fontSize는 기본값을
// 강제로 쓰지 않고 없으면 그대로 둔다(읽는 쪽에서 기본값 적용).
// ---------------------------------------------------------------------------

export function migrateSection(input: unknown): Section {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fromType = typeof raw.type === "string" ? raw.type : "";
  const type = LEGACY_TYPE_MAP[fromType] ?? fromType;
  const sec: Record<string, unknown> = { ...raw, type };

  if (type === "hero") {
    if (typeof sec.notice !== "string") sec.notice = "";
    // [작업2] 배지 — 문자열("A · B · C" 등 레거시 저장 형태)이면 "·" 기준으로 쪼개
    // 배열(3칸 기본)로 만든다. 내용은 100% 보존(공백만 trim)하고, 3칸보다 많으면
    // 전부 유지한다. 이미 배열이면 그대로 둔다.
    if (typeof sec.badges === "string") {
      const parts = sec.badges.split("·").map((p) => p.trim());
      while (parts.length < 3) parts.push("");
      sec.badges = parts;
    } else if (!Array.isArray(sec.badges)) {
      sec.badges = ["", "", ""];
    }
  } else if (type === "detail") {
    if (!Array.isArray(sec.captions)) sec.captions = ["", ""];
    if (!Array.isArray(sec.images)) sec.images = ["", ""];
  } else if (type === "usp" || type === "review") {
    const items = Array.isArray(sec.items) ? sec.items.map((x) => String(x ?? "")) : [];
    sec.items = items;
  } else if (type === "evidence") {
    if (typeof sec.unit !== "string" || !sec.unit.trim()) sec.unit = "cm";
  } else if (type === "notice") {
    // 표 형태(예전 table)
    if (Array.isArray(sec.rows)) {
      sec.rows = sec.rows
        .filter((r) => Array.isArray(r))
        .map((r) => [String(r[0] ?? ""), String(r[1] ?? "")] as [string, string]);
    }
    // 문구 형태(예전 lines)
    const lines: string[] = Array.isArray(sec.lines) ? sec.lines.map((l) => String(l ?? "")) : [];
    if (lines.length > 0 || typeof raw.lines !== "undefined") {
      sec.lines = lines;
      const title = typeof sec.title === "string" ? sec.title : "";
      if (isShippingSection(title)) {
        if (typeof sec.fee !== "string") {
          const m = lines.find((l) => /^\s*배송비/.test(l));
          sec.fee = m ? m.replace(/^\s*배송비\s*[:：]?\s*/, "").trim() : "";
        }
        if (typeof sec.island !== "string") {
          const m = lines.find((l) => /^\s*도서산간/.test(l));
          sec.island = m ? m.replace(/^\s*도서산간\s*[:：]?\s*/, "").trim() : "";
        }
        if (typeof sec.leadTime !== "string") {
          const m = lines.find((l) => /^\s*출고/.test(l));
          sec.leadTime = m ? m.replace(/^\s*출고\s*[:：]?\s*/, "").trim() : "";
        }
      }
      if (isFreeServiceSection(title)) {
        if (typeof sec.asPeriod !== "string") sec.asPeriod = "";
        if (typeof sec.asTerms !== "string") sec.asTerms = "";
      }
    }
  }
  // [작업1] fieldSizes 정규화 — 유효한 숫자(px)만 남긴다. 값이 하나도 없으면
  // 키 자체를 두지 않는다(마이그레이션 기본값 = 필드 없음 상태).
  const fs = sec.fieldSizes;
  if (fs && typeof fs === "object" && !Array.isArray(fs)) {
    const clean: Record<string, number> = {};
    for (const [key, v] of Object.entries(fs)) {
      if (typeof v === "number" && Number.isFinite(v)) clean[key] = clampFontSize(v);
    }
    if (Object.keys(clean).length > 0) sec.fieldSizes = clean;
    else delete sec.fieldSizes;
  } else if (fs !== undefined) {
    delete sec.fieldSizes;
  }
  return sec as Section;
}

export function migrateDoc(parsed: unknown): Doc {
  const d = parsed as Doc;
  if (!d || !Array.isArray(d.sections)) return defaultDoc();
  return {
    ...d,
    sections: d.sections.map((s) => migrateSection(s)),
  };
}

// 새로 추가하는 섹션의 기본 형태. notice는 복제 대상(like)이 문구형이면
// 문구형으로 만들고, 그 외에는 상품고시 표 형태로 만든다.
export function makeSection(type: Section["type"], like?: Section): Section {
  const t = (LEGACY_TYPE_MAP[type] ?? type) as Section["type"];
  if (t === "hero") return { type: "hero", image: "", title: "", sub: "", notice: "", badges: ["", "", ""] };
  if (t === "problem" || t === "change" || t === "howto") return { type: t, title: "", body: "", image: "" };
  if (t === "usp") return { type: "usp", items: ["", "", ""] };
  if (t === "evidence") return { type: "evidence", image: "", w: "", d: "", h: "", weight: "", colors: "", material: "", unit: "cm" };
  if (t === "review") return { type: "review", items: ["", "", ""] };
  if (t === "notice") {
    if (like && like.type === "notice" && !Array.isArray(like.rows)) {
      return { type: "notice", title: "제목", lines: [""] };
    }
    return {
      type: "notice",
      caption: "Product Info.",
      rows: [["품명", ""], ["소재", ""], ["색상", ""], ["크기", ""], ["제조국", ""], ["A/S 책임자", ""]],
    };
  }
  if (t === "detail") return { type: "detail", images: ["", ""], captions: ["", ""] };
  // 레거시 타입("point" 등)이 직접 들어오면 대응 템플릿으로 만든다
  return { type: "problem", title: "", body: "", image: "" };
}

export function defaultDoc(): Doc {
  const t = KIND_LABELS.living.table;
  return {
    brand: "",
    name: "",
    tagline: "",
    kind: "living",
    sections: [
      { type: "hero", image: "", title: "", sub: "", notice: "", badges: ["", "", ""] },
      { type: "problem", title: "", body: "", image: "" },
      { type: "detail", images: ["", ""], captions: ["", ""] },
      { type: "usp", items: ["", "", ""] },
      { type: "evidence", image: "", w: "", d: "", h: "", weight: "", colors: "", material: "", unit: "cm" },
      { type: "notice", caption: "제품 정보", rows: t.map(([a]) => [a, ""] as [string, string]) },
      { type: "notice", title: "배송 안내", lines: [""], fee: "", island: "", leadTime: "" },
      { type: "notice", title: "주의사항", lines: [""] },
      { type: "notice", title: "무상 서비스", lines: [""], asPeriod: "", asTerms: "" },
      { type: "notice", caption: "Product Info.", rows: [["품명", ""], ["소재", ""], ["색상", ""], ["크기", ""], ["제조국", ""], ["A/S 책임자", ""]] },
    ],
  };
}
