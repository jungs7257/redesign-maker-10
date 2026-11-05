import { execFile } from "child_process";
import { writeFile, mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * 정쓰님 지시(2026-11-03): copy_lint 검수기를 generate 파이프라인의 G1 게이트로 연동.
 * 분석(AI 카피)이 만든 섹션 문구를 qa/copy_lint.py로 검사하고,
 * P0가 있으면 이미지 생성 전에 중단해 크레딧 낭비와 결함 문구의 이미지 굽기를 막는다.
 * 원본 qa/는 표준 라이브러리만 쓰는 Python 스크립트라 렌더 파이프라인과 무관하게 CLI로 호출한다.
 */

export type LintIssue = {
  rule: string;
  severity: "P0" | "P1" | "P2";
  section: string;
  quote: string;
  field?: string;
  message: string;
  fix?: string;
};

export type LintReport = {
  counts: { P0: number; P1: number; P2: number };
  blocked: boolean;
  verdict: "FAIL" | "WARN" | "PASS";
  issues: LintIssue[];
};

type CustomerCore = {
  who?: string;
  pain?: string;
  solution?: string;
  gain?: string;
  objection?: string;
};

type CustomerInsight = {
  pain?: string;
  solution?: string;
  gain?: string;
};

type SectionContract = {
  buyer_question?: string;
  focus?: string;
  one_sentence_answer?: string;
  proof_type?: string;
  proof_ref?: string;
  new_information?: string;
  forbidden?: string[];
};

type AnalysisSection = {
  section_id?: string;
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  points?: Array<{ label?: string; desc?: string }>;
  extras?: Array<string> | string[];
  customer?: CustomerInsight;
  contract?: SectionContract;
};

type ProductInferred = {
  brand_name?: string;
  brand?: string;
  product_name?: string;
  name?: string;
  product?: string;
  title?: string;
};

type AnalysisLike = {
  sections?: AnalysisSection[];
  customer_core?: CustomerCore;
  product_inferred?: string | ProductInferred;
};

/** 분석 JSON에는 섹션 이름이 없으므로, lint의 필수 섹션 검사가 알아볼 수 있게 S1~S9 이름을 붙인다. */
const SECTION_LINT_NAMES: Record<string, string> = {
  S1: "S1 히어로",
  S2: "S2 문제 공감",
  S3: "S3 생활 변화",
  S4: "S4 해결 방식",
  S5: "S5 근거/신뢰",
  S6: "S6 사용법",
  S7: "S7 사용 장면",
  S8: "S8 배송·교환·반품",
  S9: "S9 상품정보 고시",
};

/**
 * product_inferred는 모델에 따라 문자열이 아니라 { brand_name, product_name } 객체로 온다.
 * 이 값을 그대로 넘기면 copy_lint의 check_name_repeat가 .strip()을 호출하다 죽어서 P0 게이트가 조용히 꺼진다.
 */
function firstString(values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function productNameFromAnalysis(value: AnalysisLike["product_inferred"]): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const brand = firstString([value.brand_name, value.brand]);
  const name = firstString([value.product_name, value.name, value.product, value.title]);
  return [brand, name].filter(Boolean).join(" ").trim();
}

/** 분석 청사진(sections)을 copy_lint 입력 JSON 스키마로 변환 */
export function buildCopyPayload(analysis: AnalysisLike, reviewCount = 0) {
  const sections = (analysis.sections || []).map((section, index) => {
    const id = String(section.section_id || `S${index + 1}`).toUpperCase();
    return {
      id,
      name: SECTION_LINT_NAMES[id] || section.eyebrow || `섹션 ${index + 1}`,
      label: section.eyebrow || "",
      headline: String(section.headline || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      description: section.subheadline || "",
      points: (section.points || []).map((point) => ({
        key: point.label || "",
        text: point.desc || "",
      })),
      tiles: Array.isArray(section.extras) ? section.extras : [],
      customer: section.customer || {},
      contract: section.contract || {},
    };
  });
  return {
    // 이 플래그가 있으면 계약 필드가 비어 있을 때도 lint가 L028~L034를 검사한다.
    _contract_required: true,
    customer_core: analysis.customer_core || {},
    product_name: productNameFromAnalysis(analysis.product_inferred),
    review_count: reviewCount,
    sections,
  };
}

/** copy_lint.py 실행 → 리포트 파싱. P0가 있으면 blocked=true */
export async function runCopyLint(payload: unknown): Promise<LintReport> {
  const repoRoot = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), "copylint-"));
  const inputPath = join(tempDir, "copy.json");
  const outputPath = join(tempDir, "report.json");
  try {
    await writeFile(inputPath, JSON.stringify(payload, null, 2), "utf8");
    await new Promise<void>((resolve, reject) => {
      execFile(
        "python3",
        [join(repoRoot, "qa", "copy_lint.py"), "--copy", inputPath, "--json-out", outputPath],
        { cwd: repoRoot, timeout: 30000 },
        (error) => {
          // 종료코드 1 = P0 발견(정상 동작). 2만 진짜 입력 오류로 본다.
          if (error && typeof (error as { code?: number }).code === "number" && (error as { code?: number }).code === 2) {
            reject(new Error("copy_lint 실행 오류"));
            return;
          }
          resolve();
        }
      );
    });
    const raw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(raw) as LintReport;
    return {
      counts: parsed.counts || { P0: 0, P1: 0, P2: 0 },
      blocked: Boolean(parsed.blocked),
      verdict: parsed.verdict || "PASS",
      issues: parsed.issues || [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
