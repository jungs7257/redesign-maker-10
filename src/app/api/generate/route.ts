import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { generateKieImage, generateKieImage25, generateKieNanoBanana, KIE_GPT_IMAGE_MODEL, KIE_NANO_BANANA_MODEL } from "@/lib/kie";
import { buildCopyPayload, runCopyLint } from "@/lib/copyLintGate";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21";
const GOOGLE_NANO_BANANA_2_MODEL = "gemini-3.1-flash-image-preview";
const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.5";
const KIE_ANALYSIS_BASE_URL = process.env.KIE_ANALYSIS_BASE_URL || "https://open.bigmodel.cn/api/coding/paas/v4";
const KIE_ANALYSIS_MODEL = process.env.KIE_ANALYSIS_MODEL || "glm-4.6v";
const MAX_REFERENCE_IMAGES = 4;

type Provider = "openai" | "google" | "kie" | "kie-nano-banana" | "kie-gpt-image-2-5" | "kie-gpt-image-2-5-sunburst" | "openai-direct";

/**
 * restructure: 원본 근거를 지키되 구매전환 흐름(S1~S8)으로 재구성한다.
 * preserve: 원본의 섹션 구성과 문구를 그대로 두고 디자인과 레이아웃만 새로 만든다.
 */
type RedesignMode = "restructure" | "preserve";

const MAX_PRESERVE_SECTIONS = 10;

type ReferenceImage = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

type CopyPoint = {
  label: string;
  desc: string;
};

type SectionCopy = {
  eyebrow: string;
  headline: string;
  subheadline: string;
  points: CopyPoint[];
  extras: string[];
};

/** 페이지 전체에서 한 번만 정의하는 고객 인사이트. */
type CustomerCore = {
  who: string;
  pain: string;
  solution: string;
  gain: string;
  objection: string;
};

/** 섹션별 카피를 쓰기 전에 참고하는 고객 메모. 실제 카피에는 focus에 해당하는 것만 드러낸다. */
type CustomerInsight = {
  pain: string;
  solution: string;
  gain: string;
};

/** 각 섹션이 답하는 질문 하나와 증거 유형 하나를 고정하는 계약. */
type SectionContract = {
  buyer_question: string;
  focus: string;
  one_sentence_answer: string;
  proof_type: string;
  proof_ref: string;
  new_information: string;
  forbidden: string[];
};

type SectionContractTemplate = {
  id: string;
  question: string;
  focus: string;
  proofType: string;
  job: string;
  forbidden: string[];
};

/**
 * S1~S9는 각각 다른 구매 질문 하나만 맡는다.
 * 같은 불편/해결/이득을 여러 섹션에서 반복하지 않도록, 분석 프롬프트와 이미지 프롬프트가 이 표를 공유한다.
 */
const SECTION_CONTRACTS: Record<string, SectionContractTemplate> = {
  S1: {
    id: "S1",
    question: "이거 나한테 맞는 건가?",
    focus: "identity",
    proofType: "identity",
    job: "타겟의 상황과 정체성을 부르고, 이 페이지가 해결할 약속 하나를 건다.",
    forbidden: ["기능 나열", "근거", "후기", "배송 조건"]
  },
  S2: {
    id: "S2",
    question: "내 불편을 알기는 하나?",
    focus: "pain",
    proofType: "pain_scene",
    job: "고객이 실제로 겪는 불편을 구체적인 장면으로 되짚는다.",
    forbidden: ["제품 기능", "해결책", "브랜드 스토리"]
  },
  S3: {
    id: "S3",
    question: "그래서 내 하루가 어떻게 달라지나?",
    focus: "gain",
    proofType: "life_outcome",
    job: "구매 후 달라지는 생활과 감정을 보여준다.",
    forbidden: ["스펙", "비교표", "인증"]
  },
  S4: {
    id: "S4",
    question: "왜 하필 이거여야 하나?",
    focus: "solution",
    proofType: "mechanism",
    job: "이 제품의 구조·소재·방식이 불편을 어떻게 없애는지 보여준다.",
    forbidden: ["생활 변화 서사", "후기", "배송 조건"]
  },
  S5: {
    id: "S5",
    question: "말만 그런 거 아닌가?",
    focus: "proof",
    proofType: "objective_evidence",
    job: "앞의 약속을 받치는 확인 가능한 사실만 보여준다.",
    forbidden: ["개인 사용담", "평점", "CTA"]
  },
  S6: {
    id: "S6",
    question: "쓰기 번거롭지는 않나?",
    focus: "ease",
    proofType: "usage_step",
    job: "받은 뒤 무엇을 하면 되는지 순서로 보여준다.",
    forbidden: ["불편 반복", "근거 나열"]
  },
  S7: {
    id: "S7",
    question: "나 같은 사람이 써봤나?",
    focus: "trust",
    proofType: "human_experience",
    job: "사람이 실제로 쓴 장면과 말로 사용감을 보여준다.",
    forbidden: ["평점 숫자", "후기 개수", "스펙", "인증 주장"]
  },
  S8: {
    id: "S8",
    question: "잘못되면 어떡하지?",
    focus: "risk",
    proofType: "policy",
    job: "확인된 배송·교환·반품 조건으로 마지막 불안을 없앤다.",
    forbidden: ["마케팅 주장", "고시 표"]
  },
  S9: {
    id: "S9",
    question: "필수 정보가 빠지지 않았나?",
    focus: "legal",
    proofType: "legal",
    job: "상품정보 제공고시 항목과 값만 표로 보여준다.",
    forbidden: ["설득 카피", "후기", "혜택"]
  }
};

const FOCUS_LABELS: Record<string, string> = {
  identity: "타겟과 핵심 약속",
  pain: "구매 전 불편",
  gain: "구매 후 이득",
  solution: "해결 방식",
  proof: "객관적 근거",
  ease: "사용 편의",
  trust: "사용자 경험",
  risk: "구매 불안 제거",
  legal: "법정 고시"
};

const FOCUS_VISUALS: Record<string, string> = {
  identity: "타겟이 '내 얘기'라고 느끼는 한 장면. 제품은 등장해도 되지만 기능 설명은 뒤로 미룬다.",
  pain: "해결 전의 불편 장면. 제품을 해결책으로 강조하지 않고, 고객의 표정과 상황을 먼저 보여준다.",
  gain: "사용 후 달라진 생활 장면. 표정, 자세, 공간의 변화로 이득을 보여준다.",
  solution: "제품의 구조·소재·방식을 확대해서 보여준다. 과장된 비교 대신 실제 구조를 보여준다.",
  proof: "확인 가능한 근거를 문서·표·라벨로 보여준다. 새 인증 배지를 만들지 않는다.",
  ease: "사용 순서를 3단계 이내로 보여준다. 복잡한 설명 대신 행동으로.",
  trust: "사람이 실제로 쓴 장면과 말을 보여준다. 평점 숫자와 후기 개수는 금지.",
  risk: "배송·교환·반품 조건을 명확하게 보여준다. 마케팅 문구를 넣지 않는다.",
  legal: "법정 고시 표만. 설득 문구를 넣지 않는다."
};

type Section = {
  section_id: string;
  image_id: string;
  name: string;
  purpose: string;
  source: string;
  copy: SectionCopy;
  customer?: CustomerInsight;
  contract?: SectionContract;
  prompt: string;
  promptText: string;
  imageUrl?: string;
  mimeType?: string;
  error?: string;
};

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    const productFiles = form.getAll("productFiles").filter((file): file is File => file instanceof File);
    const requestText = String(form.get("request") || "");
    const rolloutRequest = String(form.get("rolloutRequest") || "");
    const target = String(form.get("target") || "");
    const modelParam = String(form.get("model") || "openai");
    const provider: Provider = modelParam === "openai-direct"
      ? "openai-direct"
      : modelParam === "google" || modelParam === "kie-nano-banana"
      ? "kie-nano-banana"
      : modelParam === "kie-gpt-image-2-5"
        ? "kie-gpt-image-2-5"
        : modelParam === "kie-gpt-image-2-5-sunburst"
          ? "kie-gpt-image-2-5-sunburst"
          : "kie";
    const channel = String(form.get("channel") || "스마트스토어");
    const ratio = String(form.get("ratio") || "9:16");
    const count = clamp(Number(form.get("count") || 1), 1, 1);
    const startSection = clamp(Number(form.get("startSection") || 1), 1, 10);
    const openaiKey = String(form.get("openaiKey") || "");
    const googleKey = String(form.get("googleKey") || "");
    const heroImageUrl = String(form.get("heroImageUrl") || "");
    const blueprintJson = String(form.get("blueprint") || "");
    const mode: RedesignMode = String(form.get("mode") || "restructure") === "preserve" ? "preserve" : "restructure";
    const apiKey = provider === "openai-direct"
      ? (openaiKey || process.env.OPENAI_API_KEY || "")
      : "server-side-kie";

    console.info(`[generate] request provider=${provider} mode=${mode} count=${count} startSection=${startSection} files=${files.length} productFiles=${productFiles.length} channel=${channel} target=${target || "(none)"}`);

    if (!apiKey) {
      return NextResponse.json(
        { error: "이미지 생성에 사용할 API 키가 설정되어 있지 않습니다. 설정에서 키를 확인해주세요." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "기존 상세페이지 이미지 또는 PDF를 업로드해주세요." }, { status: 400 });
    }

    const jobId = randomUUID();
    const sourceReferences = await prepareReferenceImages(files);
    const productReferences = await prepareReferenceImages(productFiles);
    const heroReference = parseDataUrlReference(heroImageUrl);
    console.info(`[generate] references prepared job=${jobId} source=${sourceReferences.length} product=${productReferences.length} hero=${heroReference ? 1 : 0}`);
    if (sourceReferences.length === 0) {
      return NextResponse.json({ error: "이미지 생성에 사용할 참조 이미지가 없습니다. PDF는 브라우저에서 PNG로 변환한 뒤 전송됩니다." }, { status: 400 });
    }

    const modelInfo = modelMeta(provider);
    const payload: AnalysisPayload = {
      request: requestText,
      rolloutRequest,
      target,
      options: { channel, ratio, count },
      hasProductImage: productReferences.length > 0,
      mode
    };

    // 이어서 생성할 때는 첫 요청에서 확정한 카피 블루프린트를 그대로 재사용한다(8장 카피 일관성 유지).
    const reusedAnalysis = parseMaybeJson(blueprintJson);
    const hasReusableBlueprint = Array.isArray((reusedAnalysis as { sections?: unknown })?.sections)
      && ((reusedAnalysis as { sections: unknown[] }).sections.length > 0);

    let analysis: unknown;
    if (hasReusableBlueprint) {
      analysis = reusedAnalysis;
      console.info(`[generate] blueprint reused job=${jobId}`);
    } else {
      console.info(`[generate] analysis start job=${jobId}`);
      analysis = await analyzeSource({
        provider,
        apiKey,
        references: [...productReferences, ...sourceReferences].slice(0, MAX_REFERENCE_IMAGES),
        payload,
        modelInfo
      });
      console.info(`[generate] analysis done job=${jobId}`);
    }

    // 원본 구성 유지 모드에서는 총 장수를 원본에서 읽어낸 섹션 수가 결정한다.
    const sectionTotal = mode === "preserve" ? blueprintSectionCount(analysis) : 9;
    if (mode === "preserve") {
      if (sectionTotal === 0) {
        return NextResponse.json(
          { error: "원본 상세페이지의 섹션 구성을 읽지 못했습니다. 원본 이미지를 다시 올리고 시도해주세요." },
          { status: 502 }
        );
      }
      if (startSection > sectionTotal) {
        return NextResponse.json(
          { error: `원본 구성 유지 모드에서는 총 ${sectionTotal}장까지만 생성됩니다.` },
          { status: 400 }
        );
      }
    }

    // G1 카피 검수 게이트: 분석이 만든 문구를 qa/copy_lint.py로 검사하고, P0이 있으면 이미지 생성 전에 중단한다.
    // preserve 모드는 원본 문구 전사 작업이므로 검수를 적용하지 않는다.
    if (mode !== "preserve") {
      try {
        const copyPayload = buildCopyPayload(analysis as Parameters<typeof buildCopyPayload>[0]);
        const lintReport = await runCopyLint(copyPayload);
        if (lintReport.blocked) {
          console.warn(`[generate] copy_lint G1 blocked: P0=${lintReport.counts.P0}`);
          const topIssues = lintReport.issues.filter((issue) => issue.severity === "P0").slice(0, 8);
          for (const issue of topIssues) {
            console.warn(
              `[generate] copy_lint ${issue.rule} ${issue.severity} section=${issue.section} field=${issue.field || "-"} quote=${issue.quote} message=${issue.message}`
            );
          }
          return NextResponse.json(
            {
              error: `카피 검수에서 심각한 문제(P0 ${lintReport.counts.P0}건)를 발견해 이미지 생성을 중단했습니다. 아래 문제 문구를 수정한 뒤 다시 시도해주세요.`,
              copyLint: { blocked: true, verdict: lintReport.verdict, counts: lintReport.counts, issues: topIssues },
              // 사용자가 '카피 직접 수정'으로 문제 문구를 고칠 수 있도록 분석 결과를 함께 돌려준다.
              analysis,
            },
            { status: 422 }
          );
        }
        console.info(`[generate] copy_lint G1 pass: verdict=${lintReport.verdict} P0=${lintReport.counts.P0} P1=${lintReport.counts.P1}`);
      } catch (lintError) {
        console.warn(`[generate] copy_lint failed (continue): ${lintError instanceof Error ? lintError.message : lintError}`);
      }
    }
    const sections = buildSections(count, startSection, payload, analysis, modelInfo);
    const projectTitle = inferProjectTitle(analysis, channel);

    const generatedSections: Section[] = [];
    const failedSections: Section[] = [];
    for (const [index, section] of sections.entries()) {
      const references = buildSectionReferences({
        sectionId: section.section_id,
        productReferences,
        sourceReferences,
        heroReference
      });
      try {
        console.info(`[generate] ${provider} ${section.section_id} start (${index + 1}/${sections.length}) refs=${references.length}`);
        const image = await withTransientRetry(section.section_id, () => {
          const ratioForProvider = provider === "kie" || provider === "kie-nano-banana" || provider === "kie-gpt-image-2-5" || provider === "kie-gpt-image-2-5-sunburst" ? ratio : "";
          if (provider === "kie") {
            return generateKieImage({ prompt: section.promptText, references, ratio: ratioForProvider || "9:16" });
          }
          if (provider === "kie-nano-banana") {
            return generateKieNanoBanana({ prompt: section.promptText, references, ratio: ratioForProvider || "9:16" });
          }
          if (provider === "kie-gpt-image-2-5") {
            return generateKieImage25({ prompt: section.promptText, references, ratio: ratioForProvider || "9:16", quality: "flare" });
          }
          if (provider === "kie-gpt-image-2-5-sunburst") {
            return generateKieImage25({ prompt: section.promptText, references, ratio: ratioForProvider || "9:16", quality: "sunburst" });
          }
          if (provider === "openai-direct") {
            return generateOpenAIImage({ apiKey, prompt: section.promptText, references });
          }
          return generateOpenAIImage({ apiKey, prompt: section.promptText, references });
        });
        console.info(`[generate] ${provider} ${section.section_id} done bytes=${image.buffer.length} mime=${image.mimeType}`);
        generatedSections.push({
          ...section,
          imageUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
          mimeType: image.mimeType
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "이미지 생성 실패";
        console.error(`[generate] ${provider} ${section.section_id} failed: ${message}`);
        failedSections.push({
          ...section,
          error: message
        });
        if (generatedSections.length === 0) {
          throw new Error(`${section.name} 생성 실패: ${humanizeProviderError(message)}`);
        }
        break;
      }
    }

    console.info(`[generate] complete provider=${provider} generated=${generatedSections.length} failed=${failedSections.length}`);

    return NextResponse.json({
      project: {
        id: jobId,
        title: projectTitle,
        channel,
        mode,
        sectionTotal,
        // 원본 구성 유지 모드에서 클라이언트가 "남은 섹션" 이름을 서버와 같은 기준으로 보여주도록 내려준다.
        sectionNames: mode === "preserve"
          ? preserveBlueprintRecords(analysis).map((record, index) => text(record.name) || `원본 ${index + 1}번째 섹션`)
          : undefined,
        model: provider,
        modelLabel: modelInfo.label,
        modelId: modelInfo.id,
        count: generatedSections.length,
        ratio,
        status: failedSections.length > 0 ? "부분완료" : "완료",
        files: files.map((file) => file.name),
        productFiles: productFiles.map((file) => file.name),
        request: requestText,
        createdAt: new Date().toISOString(),
        analysis,
        sections: generatedSections,
        failedSections,
        warning: failedSections.length > 0
          ? `${generatedSections.length}장은 생성됐고 ${failedSections.length}장 이후는 실패했습니다. 요청 제한이면 잠시 후 섹션별 재생성을 실행하세요.`
          : ""
      }
    });
  } catch (error) {
    console.error("[api/generate]", error);
    return NextResponse.json({ error: error instanceof Error ? humanizeProviderError(error.message) : "이미지 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}

/**
 * 방식 B 서버 키 분석. OpenAI 호환 chat/completions 엔드포인트(GLM 기본, KIE_ANALYSIS_PROVIDER=deepseek이면 DeepSeek).
 */
async function analyzeWithServerChat({ prompt, references }: { prompt: string; references: ReferenceImage[] }) {
  const useDeepSeek = process.env.KIE_ANALYSIS_PROVIDER === "deepseek";
  const apiKey = useDeepSeek ? (process.env.DEEPSEEK_API_KEY || "") : ((process.env.ZAI_BIGMODEL_API_KEY || process.env.ZAI_API_KEY) || "");
  if (!apiKey) {
    throw new Error(useDeepSeek
      ? "DEEPSEEK_API_KEY가 서버에 설정되어 있지 않습니다."
      : "ZAI_API_KEY가 서버에 설정되어 있지 않습니다. 서버 관리자에게 키 설정을 요청해주세요.");
  }
  const baseUrl = useDeepSeek ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com") : KIE_ANALYSIS_BASE_URL;
  const model = useDeepSeek ? (process.env.DEEPSEEK_ANALYSIS_MODEL || "deepseek-chat") : KIE_ANALYSIS_MODEL;

  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [{ type: "text", text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${reference.mimeType};base64,${reference.buffer.toString("base64")}` }
    });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }]
    })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || data?.message || "서버 분석 요청 실패", response));
  const text = data?.choices?.[0]?.message?.content || "";
}
type AnalysisPayload = {
  request: string;
  rolloutRequest: string;
  target: string;
  options: { channel: string; ratio: string; count: number };
  hasProductImage: boolean;
  mode: RedesignMode;
};

async function analyzeSource({
  provider,
  apiKey,
  references,
  payload,
  modelInfo
}: {
  provider: Provider;
  apiKey: string;
  references: ReferenceImage[];
  payload: AnalysisPayload;
  modelInfo: ReturnType<typeof modelMeta>;
}) {
  const prompt = payload.mode === "preserve"
    ? preserveAnalysisPrompt(payload, modelInfo)
    : restructureAnalysisPrompt(payload, modelInfo);

  try {
    if (provider === "google") {
      return await analyzeWithGoogle({ apiKey, prompt, references });
    }
    if (provider === "kie" || provider === "kie-nano-banana" || provider === "kie-gpt-image-2-5" || provider === "kie-gpt-image-2-5-sunburst") {
      return await analyzeWithServerChat({ prompt, references });
    }
    return await analyzeWithOpenAI({ apiKey, prompt, references });
  } catch (error) {
    return {
      product_inferred: { category: "업로드 자료 기반 추정", confidence: 0.4 },
      diagnostic_summary: `AI 분석 호출 실패: ${error instanceof Error ? error.message : "unknown"}`,
      strategy: "원본 자료의 제품컷/USP/근거를 보존하고, 8장 섹션 구조로 전환 설계를 적용합니다.",
      sections: [],
      compliance_notes: "근거 없는 수치, 리뷰, 인증, 효과 표현은 생성하지 않습니다."
    };
  }
}

/** 원본 구성 유지 모드: 카피를 새로 쓰지 않고 원본 섹션과 문구를 그대로 전사한다. */
function preserveAnalysisPrompt(payload: AnalysisPayload, modelInfo: ReturnType<typeof modelMeta>) {
  return [
    "너는 한국 이커머스 상세페이지 원본 전사기다.",
    "업로드된 기존 상세페이지를 위에서 아래로 읽으면서, 실제 섹션 구성과 문구를 그대로 옮긴 한국어 JSON을 작성하라.",
    "이 작업은 카피라이팅이 아니다. 문구를 새로 쓰거나 요약하거나 다듬지 않는다.",
    `판매 채널: ${payload.options.channel}`,
    `사용자 요청사항(디자인 참고용이며 문구에는 반영하지 않는다): ${payload.request || "없음"}`,
    "",
    "# 섹션을 나누는 기준",
    "원본을 위에서 아래로 읽다가 배경색이 바뀌거나, 큰 제목이 새로 나오거나, 주제가 바뀌는 지점에서 섹션을 끊는다.",
    "한 섹션은 고객이 한 화면에서 읽는 메시지 하나다. 제목 하나에 딸린 설명과 포인트가 한 섹션이다.",
    "원본이 번호나 'Point 01, 02'처럼 항목을 나눠 놓았으면 그 항목 하나하나를 각각 섹션으로 잡는다. 묶지 않는다.",
    "반대로 해시태그 줄, 구분선, 로고만 있는 띠, 법적 고지 한 줄처럼 대제목도 설명도 없는 블록은 섹션이 아니다. 앞 섹션에 붙이거나 건너뛴다.",
    "",
    "# 전사 규칙(강제)",
    "- 원본 이미지에 적힌 문장을 그대로 옮긴다. 새 문장을 만들거나 의역하지 않는다",
    "- 원본에 없는 섹션을 추가하지 않고, 있는 섹션을 빼지 않으며, 순서도 바꾸지 않는다",
    "- 원본에 해당 요소가 없으면 빈 문자열이나 빈 배열로 둔다. 억지로 채우지 않는다",
    "- 구매 버튼이나 CTA 버튼 문구는 옮기지 않는다",
    "- 후기 개수, 평균 별점, 평점, 판매량, 순위처럼 시점마다 바뀌는 수치와 누르는 메뉴 이름은 원본에 있어도 옮기지 않는다. 다른 플랫폼에 올리면 거짓이 되고 이미지는 클릭되지 않는다",
    "",
    "# 출력 형식",
    "JSON 키: product_inferred, diagnostic_summary, strategy, sections, compliance_notes",
    `sections는 원본에 실제로 존재하는 섹션 수만큼(최대 ${MAX_PRESERVE_SECTIONS}개) 위에서 아래 순서로 만든다.`,
    '{ "section_id": "S1", "name": "이 섹션을 부르는 이름 12자 이내", "eyebrow": "원본 상단 작은 라벨", "headline": "원본 대제목", "subheadline": "원본 설명 문장", "points": [{"label": "원본 소제목", "desc": "원본 설명"}], "extras": ["원본 짧은 라벨"], "evidence": "원본에서 이 섹션이 있던 위치" }',
    "원본에 실제로 인쇄된 문구만 옮긴다. 화면 구성 설명이나 제작 메모(노출, 표기, 영역)는 문구가 아니므로 옮기지 않는다.",
    "한 섹션에 문장이 많으면 points를 최대 6개까지 쓰고, 남는 짧은 문구는 extras에 담는다.",
    "product_inferred에는 원본에서 확인되는 브랜드명, 제품명, 카테고리만 적는다.",
    "diagnostic_summary에는 원본의 섹션 구성을 한 줄로 요약한다.",
    `이미지 생성 모델: ${modelInfo.label} (${modelInfo.id})`
  ].join("\n");
}

/** 기본 모드: 원본 근거를 지키되 구매전환 흐름으로 카피와 구성을 다시 설계한다. */
function restructureAnalysisPrompt(payload: AnalysisPayload, modelInfo: ReturnType<typeof modelMeta>) {
  return [
    "# 누가 누구에게 쓰는 글인가",
    "너는 이 제품을 파는 가게의 카피라이터다. 독자는 지금 이 제품을 살까 말까 망설이는 한 사람이다.",
    "그 사람은 페이지를 점검하러 온 것이 아니라, 자기 문제가 풀릴지 확인하러 왔다.",
    "네가 쓰는 모든 문장은 그 사람의 등을 한 번씩 밀어야 한다. 밀지 못하는 문장은 자리를 차지할 자격이 없다.",
    "업로드된 기존 상세페이지는 제품이 무엇인지 알아내는 재료일 뿐이다. 독자는 그 원본을 본 적도 없고 관심도 없다.",
    "",
    `판매 채널: ${payload.options.channel}`,
    `추가 요청사항: ${payload.request || "전환율 중심으로 리디자인"}`,
    payload.rolloutRequest ? `히어로 검토 후 반영할 요청: ${payload.rolloutRequest}` : "히어로 검토 후 요청: 없음",
    "",
    "# 타겟 고객 (최우선 지시)",
    payload.target
      ? `이 페이지의 독자는 다음 타겟이다: ${payload.target}`
      : "타겟이 지정되지 않았다. 제품 카테고리에서 가장 대표적인 구매층을 스스로 정한다.",
    payload.target ? "타겟 지정 시 규칙(강제):" : "자체 지정 시 규칙(강제):",
    "- 제품을 소개하는 것이 아니라, 타겟의 문제를 해결하는 페이지가 된다. 모든 섹션에서 제품보다 독자가 먼저 나온다.",
    "- S1은 타겟의 상황·정체성을 부르는 문장이어야 한다. 독자가 아, 내 얘기네라고 멈추는 문장.",
    "- S2 불편은 타겟 연령·상황에서 실제로 겪는 장면으로 쓴다. (예: 20대=외모·자신감, 30대=대인관계·상쾌함, 40대=건강·노화 대비, 주부=가족 관리, 직장인=시간 효율, 아이 있는 집=안전·간편)",
    "- S3 생활변화·S5 근거·S8 안심도 타겟의 관심사에 맞춰 각도를 조정한다. 타겟이 신경 쓰지 않는 근거는 쓰지 않는다.",
    "- 문구 톤과 이미지 연출(색·배경·장면)도 타겟에 맞춘다. 단, 근거 없는 수치·효능 창작은 여전히 금지다.",
    "# 독자의 머릿속에서 일어나는 일",
    "독자는 위에서 아래로 내려오며 질문을 순서대로 던진다. 앞 질문이 풀려야 다음 질문으로 넘어간다.",
    "각 섹션은 그중 질문 하나를 맡는다. 그 질문에 답하지 않는 섹션은 독자를 떠나게 만든다.",
    "",
    "S1  \"이거 나한테 맞는 건가?\"",
    "    누구의 어떤 상황을 위한 제품인지 한 문장으로 선언한다. 독자가 '아, 내 얘기네' 하고 멈추게.",
    "S2  \"내 불편을 알기는 하나?\"",
    "    독자가 실제로 겪는 장면을 독자의 말로 되짚는다. 문제를 먼저 꺼내야 해결이 귀에 들어온다.",
    "S3  \"그래서 내 하루가 어떻게 달라지나?\"",
    "    기능이 아니라 달라지는 생활을 말한다. 쿠션이 두껍다가 아니라, 퇴근길 발이 덜 아프다.",
    "S4  \"왜 하필 이거여야 하나?\"",
    "    다른 선택지 대신 이걸 고를 이유를 압축한다. 비교 대상을 굳이 말하지 않아도 차이가 느껴지게.",
    "S5  \"말만 그런 거 아닌가?\"",
    "    앞에서 한 약속을 받치는 확인 가능한 사실을 댄다. 소재, 구조, 만든 곳. 인증·특허·시험은 원본에 인증번호·시험기관·측정값이 함께 있을 때만 쓴다.",
    "S6  \"쓰기 번거롭지는 않나?\"",
    "    받은 다음 무엇을 하면 되는지 순서로 보여준다. 구매 후 막막함을 미리 없앤다.",
    "S7  \"나 같은 사람이 써봤나?\"",
    "    실제 사용감을 사람이 말한 문장처럼 옮긴다. 숫자가 아니라 장면으로. '후기', '리뷰', '구매평'이라는 단어는 화면에 쓰지 않는다.",
    "S8  \"잘못되면 어떡하지?\"",
    "    확인된 배송·교환 조건으로 마지막 불안을 치운다. 조건이 없으면 이 섹션은 짧아도 된다.",
    "",
    "# 고객의 불편 → 해결 → 이득 (페이지 전체 계약)",
    "이 페이지는 제품 소개서가 아니라, 고객의 불편을 없애고 얻고 싶은 생활을 보여주는 페이지다.",
    "아래 세 가지를 페이지 전체에서 한 번씩만, 서로 다른 섹션에서 보여준다.",
    "- 불편(pain): S2에서 고객이 실제로 겪는 장면으로. 제품 기능보다 먼저 꺼낸다.",
    "- 해결(solution): S4에서 이 제품의 구조·소재·방식이 그 불편을 어떻게 없애는지로.",
    "- 이득(gain): S3와 S7에서 구매 후 달라지는 생활과 사람의 표정으로.",
    "- 원본 상세페이지에 적힌 고객 고민·사용 장면·소재/구조 설명에서 근거를 찾고, 원본에 없는 효능·후기·수치는 만들지 않는다.",
    "S1은 타겟과 약속, S5는 확인 가능한 근거, S6는 사용법, S8은 구매 불안 제거, S9는 고시만 맡는다.",
    "같은 불편·해결·이득을 두 섹션에서 반복하지 않는다. 각 섹션은 아래 계약의 '답의 종류' 하나만 맡는다.",
    "",
    "# 섹션 계약 (강제)",
    ...Object.values(SECTION_CONTRACTS).map((contract) =>
      `- ${contract.id}: focus=${contract.focus}, proof_type=${contract.proofType}, 금지=${contract.forbidden.join(", ")}`
    ),
    "각 섹션의 contract.focus와 contract.proof_type은 위 표와 같아야 한다.",
    "각 섹션의 contract.one_sentence_answer는 그 섹션만의 답이어야 한다. 다른 섹션의 답과 같은 말을 쓰지 않는다.",
    "각 섹션의 contract.new_information에는 앞 섹션에 없던 새 정보 하나를 적는다.",
    "",
    "# 설득이 되는 문장의 구조",
    "독자가 얻는 것(headline)과 그것이 사실인 이유(desc)가 붙어 있어야 한다.",
    "이득만 있으면 허풍으로 읽히고, 사실만 있으면 부품표로 읽힌다. 둘이 붙어야 믿고 원하게 된다.",
    "  얻는 것: 하루 종일 서 있어도 덜 지치는 발",
    "  이유:   뒤꿈치를 감싸는 젤 쿠션",
    "독자가 친구에게 말하듯 쓴다. 제품을 모르는 사람이 읽어도 한 번에 그림이 그려져야 한다.",
    "",
    "# 사실의 경계",
    "원본과 제품 사진에서 확인되는 사실만 근거로 쓴다. 브랜드명, 수치, 인증, 효능, 후기를 새로 만들지 않는다.",
    "후기 개수나 평점처럼 시점마다 바뀌는 숫자는 쓰지 않는다. 이 페이지는 여러 곳에 오래 걸린다.",
    "근거가 없는 자리는 비운다. 없다는 말을 문장으로 쓰는 것은 독자에게 할 말이 아니다.",
    "규제 리스크가 있으면 단정하지 않고 안전하게 표현한다.",
    "",
    "# P0 금지 (고객에게 나가면 안 되는 문구)",
    "- 화면 문구에 '후기', '리뷰', '구매평'을 쓰지 않는다. 리뷰 수를 확인할 수 없으므로 '사용 장면', '사용감'으로 쓴다.",
    "- '일반 상세페이지', '기존 상세페이지', '타사 상세', '경쟁사 상세'를 비교 대상으로 쓰지 않는다.",
    "- '인증', '특허', '시험 완료'는 원본에 인증번호·시험기관·측정값이 함께 있을 때만 쓴다. 없으면 소재·구조·만든 곳만 쓴다.",
    "- 고시 값에 '상세페이지 참조', '상세 참조', '컨텐츠 참조'를 쓰지 않는다. 모르면 '미확인(검수 필요)'으로 표기한다.",
    "- '100%'와 복수 소재를 함께 쓰지 않는다. 소재는 구성요소별로 나눠 쓴다.",
    "- 경쟁 소재(석고, 유리섬유, 포름알데히드 등)를 깎는 표현을 쓰지 않는다.",
    "",
    "# 출력 형식",
    "JSON 키: customer_core, product_inferred, diagnostic_summary, strategy, sections, compliance_notes",
    "customer_core는 페이지 전체의 고객 인사이트다. 모든 섹션은 이 코어와 모순되지 않아야 한다.",
    '{ "who": "이 페이지를 보는 사람", "pain": "그 사람이 지금 겪는 가장 큰 불편", "solution": "이 제품이 그 불편을 없애는 방식", "gain": "구매 후 그 사람이 얻는 것", "objection": "구매를 망설이는 이유" }',
    "sections는 S1~S9 9개 배열이며 각 항목은 다음 형식을 반드시 지킨다. S9은 상품정보 고시다.",
    '{ "section_id": "S1", "eyebrow": "제품 카테고리나 특징을 말하는 라벨 12자 이내(예: 남성 테니스화, 무기자차 선크림). 확인 근거·착용 의견·구매 기준처럼 제작자가 붙인 분류 이름은 금지", "headline": "굵은 대제목 30자 이내, 2~3줄로 끊어 읽히게", "subheadline": "설명 45자 이내", "points": [{"label": "굵은 소제목 10자 이내", "desc": "구체적인 사실 설명 30자 이내"}], "extras": ["제품의 구체적 사실을 담은 짧은 라벨 8자 이내. 메뉴 이름 금지"], "evidence": "원본에서 확인된 근거만", "customer": { "pain": "이 섹션에서 보여줄 고객의 불편", "solution": "이 제품이 해결하는 방식", "gain": "구매 후 고객이 얻는 것" }, "contract": { "buyer_question": "이 섹션이 답하는 질문", "focus": "identity|pain|gain|solution|proof|ease|trust|risk|legal", "one_sentence_answer": "이 섹션만의 한 문장 답", "proof_type": "identity|pain_scene|life_outcome|mechanism|objective_evidence|usage_step|human_experience|policy|legal", "proof_ref": "원본에서 확인된 근거 위치", "new_information": "앞 섹션에 없던 새 정보", "forbidden": ["이 섹션에서 하지 말 것"] } }',
    "각 섹션의 customer는 그 섹션 카피를 쓰기 전에 참고하는 메모다. 실제 카피에는 contract.focus에 해당하는 내용만 드러내고, 나머지는 문장으로 반복하지 않는다.",
    "contract.focus는 위 섹션 계약의 값과 같아야 한다. 한 섹션에 불편·해결·이득을 모두 쓰지 않는다.",
    "eyebrow는 제품이 무엇인지 말하는 짧은 라벨이다(예: 남성 테니스화, 무기자차 선크림).",
    "points는 최대 3개, extras는 최대 5개. 확인되는 만큼만 쓰고, 없으면 줄이거나 비운다.",
    "구매 버튼이나 CTA 문구는 만들지 않는다. 한국 상세페이지는 이미지 안에 구매 버튼을 넣지 않는다.",
    "각 문장은 짧게 끊어 크게 읽히게 쓰되, 정보량 자체를 줄이지는 않는다. 섹션마다 다른 헤드라인을 쓴다.",
    `이미지 생성 모델: ${modelInfo.label} (${modelInfo.id})`
  ].join("\n");
}

async function analyzeWithOpenAI({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [{ type: "input_text", text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    content.push({
      type: "input_image",
      image_url: `data:${reference.mimeType};base64,${reference.buffer.toString("base64")}`
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      input: [{ role: "user", content }]
    })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "OpenAI 분석 요청 실패", response));
  const text = data.output_text || extractOpenAIText(data);
  return parseMaybeJson(text);
}

async function analyzeWithGoogle({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    parts.push({
      inlineData: {
        mimeType: reference.mimeType,
        data: reference.buffer.toString("base64")
      }
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_NANO_BANANA_2_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "Google 분석 요청 실패", response));
  const text = data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text || "";
  return parseMaybeJson(text);
}

async function generateOpenAIImage({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", "1152x2048");
  form.append("quality", "low");
  form.append("output_format", "png");

  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    form.append("image[]", new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }), reference.name);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "OpenAI Image 2.0 생성 실패", response));
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("OpenAI 응답에 이미지 데이터가 없습니다.");
  return { mimeType: "image/png", buffer: Buffer.from(imageBase64, "base64") };
}

async function generateGoogleImage({ apiKey, prompt, references }: { apiKey: string; prompt: string; references: ReferenceImage[] }) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const reference of references.slice(0, MAX_REFERENCE_IMAGES)) {
    parts.push({
      inlineData: {
        mimeType: reference.mimeType,
        data: reference.buffer.toString("base64")
      }
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_NANO_BANANA_2_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ contents: [{ parts }] })
  });

  const data = await readJsonResponse(response);
  if (!response.ok) throw new Error(withRequestId(data?.error?.message || "Google Nano Banana 2 생성 실패", response));
  const imagePart = data?.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string } }) => part.inlineData);
  if (!imagePart?.inlineData?.data) throw new Error("Google 응답에 이미지 데이터가 없습니다.");
  return {
    mimeType: imagePart.inlineData.mimeType || "image/png",
    buffer: Buffer.from(imagePart.inlineData.data, "base64")
  };
}

/** 제품컷 → 히어로(스타일 통일) → 원본 순으로 참조 이미지 예산을 채운다. */
function buildSectionReferences({
  sectionId,
  productReferences,
  sourceReferences,
  heroReference
}: {
  sectionId: string;
  productReferences: ReferenceImage[];
  sourceReferences: ReferenceImage[];
  heroReference: ReferenceImage | null;
}) {
  const references: ReferenceImage[] = [];
  references.push(...productReferences.slice(0, MAX_REFERENCE_IMAGES));
  if (heroReference && sectionId !== "S1" && references.length < MAX_REFERENCE_IMAGES) references.push(heroReference);
  for (const reference of sourceReferences) {
    if (references.length >= MAX_REFERENCE_IMAGES) break;
    references.push(reference);
  }
  return references.slice(0, MAX_REFERENCE_IMAGES);
}

type SectionPlan = {
  id: string;
  name: string;
  purpose: string;
  source: string;
  layout: string;
  order: number;
  copy: SectionCopy;
  customer?: CustomerInsight;
  contract?: SectionContract;
};

function buildSections(
  count: number,
  startSection: number,
  payload: AnalysisPayload,
  analysis: unknown,
  modelInfo: ReturnType<typeof modelMeta>
): Section[] {
  const preserve = payload.mode === "preserve";
  const customerCore = readCustomerCore(analysis);
  const plans: SectionPlan[] = preserve
    ? preserveSectionPlans(analysis, count, startSection)
    : sectionTemplates(count, startSection).map((template, index) => {
        const match = findSectionRecord(analysis, template.id);
        return {
          ...template,
          order: startSection + index,
          copy: match ? readSectionCopy(match) : emptySectionCopy(),
          customer: readCustomerInsight(match, customerCore),
          contract: readSectionContract(match, SECTION_CONTRACTS[template.id])
        };
      });

  return plans.map((plan) => {
    const copy = plan.copy;
    const promptText = [
      "너는 한국 커머스 상세페이지 섹션 이미지 생성 엔진이다.",
      "이 이미지를 보는 사람은 지금 이 제품을 살까 말까 망설이는 고객이다. 화면의 모든 글자와 그림은 그 사람을 향한다.",
      `이미지 생성 모델: ${modelInfo.label} (${modelInfo.id})`,
      "세로형 9:16 상세페이지 섹션 이미지 1장을 생성한다.",
      preserve
        ? "이번 작업은 '원본 구성 유지' 리디자인이다. 원본의 섹션 구성과 문구는 그대로 두고 디자인과 레이아웃만 새로 만든다."
        : "이번 작업은 전환 구조 리디자인이다. 원본의 사실만 지키고 구매전환 흐름으로 다시 구성한다.",
      preserve ? `원본 위치: 위에서 ${plan.order}번째 섹션` : `권장 레이아웃: ${plan.layout}`,
      `판매 채널: ${payload.options.channel}`,
      payload.target ? `타겟 고객(최우선): 이 이미지를 보는 사람은 ${payload.target}이다. 색감·배경·장면·모델 연출을 이 타겟에 맞춘다.` : "",
      preserve
        ? `추가 요청사항(디자인과 레이아웃에만 반영하고 문구는 바꾸지 않는다): ${payload.request || "없음"}`
        : `추가 요청사항: ${payload.request || "전환율 중심으로 리디자인"}`,
      payload.rolloutRequest
        ? `${preserve ? "첫 장 검토 후 사용자가 요청한 반영사항(디자인 한정)" : "히어로 검토 후 사용자가 요청한 반영사항"}: ${payload.rolloutRequest}`
        : "검토 후 반영사항: 없음",
      "",
      preserve
        ? "# 이미지에 넣을 문구 (원본에서 그대로 옮겨온 문장이다. 한 글자도 바꾸지 말고 그대로 렌더링한다)"
        : "# 이미지에 넣을 문구 (아래 문구를 그대로 사용하고 새 문구를 지어내지 않는다)",
      copy.eyebrow ? `상단 라벨(작은 알약 배지): ${copy.eyebrow}` : "상단 라벨: 없음",
      copy.headline ? `대제목(가장 크게, 2~3줄로 끊어서): ${copy.headline}` : "대제목: 없음",
      copy.subheadline ? `설명: ${copy.subheadline}` : "설명: 없음",
      copy.points.length > 0
        ? `핵심 포인트(각각 아이콘 + 굵은 소제목 + 설명 2줄 구조로 배치):\n${copy.points.map((point, pointIndex) => [
            `  ${pointIndex + 1}번 소제목) ${point.label}`,
            point.desc ? `  ${pointIndex + 1}번 설명) ${point.desc}` : ""
          ].filter(Boolean).join("\n")).join("\n")}`
        : "핵심 포인트: 없음",
      copy.extras.length > 0 ? `아이콘 타일 라벨(가로로 나열):\n${copy.extras.map((extra) => `  ${extra}`).join("\n")}` : "아이콘 타일 라벨: 없음",
      "",
      "위 목록에서 괄호와 기호 뒤에 적힌 문장만 이미지에 그린다. '상단 라벨', '대제목', '설명', '1번 소제목' 같은 안내말과 콜론, 괄호, 번호, 하이픈, 쌍점 기호는 이미지에 그리지 않는다.",
      "위 목록에 적힌 문장이 이미지에 들어갈 유일한 텍스트다. 아래는 그림 그리는 방법 설명이며, 한 글자도 이미지에 그리지 않는다.",
      !preserve && plan.contract && plan.customer
        ? sectionContractPrompt(plan.contract, plan.customer, customerCore)
        : "",
      "",
      "# 디자인 규칙",
      "스타일: 한국 스마트스토어에서 흔히 보는 완성형 상세페이지 디자인을 따른다. 단, 위 [레이아웃: ...] 지시가 이 섹션의 뼈대이며 절대 우선이다. 다른 섹션과 레이아웃이 겹치면 실패다.",
      "레이아웃 다양성(강제): 이 이미지는 상세페이지 9장 중 1장이다. 다른 장에서 흔히 쓰는 조합(알약 라벨 + 카드 3개 세로 스택 + 아이콘 타일)을 무조건 반복하지 않는다. [레이아웃] 지시에 없는 요소는 이 섹션에 필요 없다면 그리지 않는다.",
      "색상 리듬(강제): 섹션마다 배경 톤과 강조색을 다르게 한다. 흰 배경이 3장 이상 연속되지 않게 하고, 강조색은 제품 사진에서 추출한 보색 계열 1가지로 통일한다. 형광·네온 원색 금지.",
      preserve
        ? "구성 유지(최우선): 위 문구의 순서와 의미를 원본 그대로 유지한다. 문구를 추가·삭제·요약·의역·번역하지 않고, 섹션의 주제도 바꾸지 않는다. 새로 만드는 것은 오직 디자인이다. 타이포 위계, 여백, 정렬, 카드와 그리드 구조, 아이콘, 컬러, 사진 배치만 현대적으로 끌어올린다."
        : "정보 밀도: 화면을 정보로 가득 채운다. 위에서 아래로 상단 라벨 → 대제목 → 설명 → 제품 사진 → 포인트 카드 → 아이콘 타일 줄 → 안내 문구 순으로 층을 쌓아 빈 곳을 남기지 않는다. 큰 빈 여백, 문구 3~4개만 떠 있는 헐렁한 구성은 실패로 간주한다.",
      preserve
        ? "정보 밀도: 위 문구를 하나도 빠뜨리지 말고 전부 넣되, 시각 위계와 그룹핑으로 정돈해 훨씬 읽기 쉽게 만든다. 빈 여백만 넓은 구성은 실패로 간주한다."
        : "구성 원칙: 이 섹션의 목적에 맞는 정보 흐름을 스스로 설계한다.",
      "모바일 가독성: 정보량을 줄이는 대신 글자를 시원하게 키워 스마트폰에서 한 손에 들고 봐도 편히 읽히게 한다. 대제목은 화면 가로를 거의 채울 만큼 아주 크게, 소제목과 라벨은 대제목의 절반쯤, 설명문도 작아지지 않게 또렷하게 쓴다. 깨알 같은 글씨와 빽빽한 표는 피한다.",
      "# 첨부 이미지의 역할",
      "첨부된 기존 상세페이지 이미지는 제품이 무엇인지, 어떤 문구와 정보가 있는지 알아내는 자료다. 그 페이지의 레이아웃, 배경, 모델 사진, 장식을 따라 그리거나 잘라 붙이지 않는다. 너는 그 페이지를 편집하는 것이 아니라 같은 제품으로 새 페이지를 만든다.",
      "원본에 사람 모델이 있더라도 옮기지 않는다. 제품 자체와 제품이 놓인 장면을 새로 연출한다.",
      payload.hasProductImage
        ? "첨부된 제품 사진은 제품의 형태, 패키지 디자인, 라벨 문구, 색상, 로고를 정확히 그리기 위한 기준이다. 이것만은 그대로 유지하고 새로 그리거나 변형하거나 다른 제품으로 바꾸지 않는다."
        : "제품의 형태, 패키지, 라벨, 색감은 첨부된 원본에서 보이는 그대로 보존한다. 제품을 새로 지어내지 않는다. 단, 제품을 둘러싼 배경과 연출은 새로 만든다.",
      "금지: 구매 버튼, 장바구니 버튼, '구매하기'·'지금 구매' 같은 CTA 버튼이나 화살표 버튼을 이미지 안에 그리지 않는다. 한국 상세페이지 관습에 맞춰 정보 전달에만 집중한다.",
      "금지: 메뉴 바, 탭, 링크, 검색창, 하단 아이콘 메뉴처럼 누를 수 있어 보이는 UI를 그리지 않는다. 상세페이지는 이미지라서 클릭되지 않는다.",
      "금지: 평점 숫자, 후기 개수, 판매량, 순위 배지처럼 시점마다 바뀌는 숫자를 그리지 않는다. 위 문구 목록에 없는 숫자를 새로 만들어 넣지 않는다. 참조 이미지에 그런 숫자가 있어도 흐리게 처리하거나 가려서 옮기지 말고, 애초에 없는 화면으로 새로 그린다.",
      "허용: 후기 카드의 별 아이콘은 한국 상세페이지 관습이므로 장식으로 그려도 된다. 다만 별 옆에 점수나 후기 개수를 숫자로 적지 않는다.",
      "글자 규칙: 이미지에 들어가는 글자는 위 '이미지에 넣을 문구' 목록에 적힌 문장이 전부다. 섹션 이름, 목적, 레이아웃 설명, 이 지시문의 어떤 줄도 고객이 읽을 글자가 아니다.",
      "한글 정확도: 위 문구 목록의 한글을 한 글자도 틀리지 않게 그린다. 받침, 모음, 자음 하나가 달라져도 다른 단어가 되어 고객이 읽을 수 없다. 글자가 긴 문장은 줄을 나눠서라도 또렷하게 쓰고, 모양이 불확실한 글자는 크게 그려 정확도를 확보한다.",
      TYPOGRAPHY_RULE,
      unifyRule(plan.order === 1, preserve),
      "브랜드 규칙: '한이룸', 'HANEERUM', 'HR'은 도구 이름일 뿐이며 제품 브랜드가 아니다. 이미지 안에 절대 쓰지 않는다. 제품 브랜드명과 제품명은 업로드된 원본이나 제품 패키지에서 확인되는 이름만 사용한다.",
      preserve
        ? "안전 규칙: 위에 적힌 원본 문구만 사용한다. 원본에 없는 수치, 리뷰, 인증, 효과를 새로 만들지 않는다. 오탈자 없는 자연스러운 한국어로 표기한다."
        : "안전 규칙: 근거 없는 수치, 리뷰, 인증, 효과를 만들지 않는다. 한 장에 메시지 하나만 담는다. 오탈자 없는 자연스러운 한국어로 표기한다."
    ].join("\n");

    return {
      section_id: plan.id,
      image_id: `IMG_${plan.id}`,
      name: plan.name,
      purpose: plan.purpose,
      source: plan.source,
      copy,
      customer: plan.customer,
      contract: plan.contract,
      prompt: promptText.replaceAll("\n", "<br>"),
      promptText
    };
  });
}

/**
 * 서체를 Pretendard 하나로 못 박는다.
 * "폰트 감각을 맞춘다" 정도로는 모델이 장마다 다른 서체를 골라도 규칙 위반이 아니어서
 * 특히 OpenAI Image 2.0에서 8장의 서체가 제각각으로 나온다.
 */
const TYPOGRAPHY_RULE =
  "서체 규칙: 이미지 안의 모든 한글, 영문, 숫자는 Pretendard 하나로만 쓴다. Pretendard는 획 굵기가 고른 현대적인 한국어 산세리프이고, 자소가 네모틀에 꽉 차며 끝이 직각으로 잘린 깔끔한 서체다. 정보 위계는 서체를 바꾸지 말고 굵기(Regular / SemiBold / ExtraBold)와 크기로만 만든다. 명조·바탕·궁서·붓글씨·손글씨·기울임체·장식체를 한 글자도 섞지 않고, 영문과 숫자도 세리프로 바꾸지 않는다. 한 화면 안은 물론 모든 섹션이 같은 서체로 보여야 한다.";

function unifyRule(isFirstSection: boolean, preserve: boolean) {
  if (isFirstSection) {
    return "통일 규칙: 이 첫 장이 전체의 스타일 기준이 된다. 배경 색, 포인트 색, 카드 스타일을 명확하게 잡는다. 서체는 위 서체 규칙대로 Pretendard로 고정한다.";
  }
  return preserve
    ? "통일 규칙: 첨부된 첫 섹션 이미지와 같은 배경 색, 포인트 색, 카드 스타일, 그리고 같은 Pretendard 서체를 사용한다. 레이아웃은 이 섹션이 담은 원본 정보 구조에 맞춰 자연스럽게 짠다."
    : "통일 규칙: 첨부된 히어로 섹션 이미지와 같은 배경 색, 포인트 색, 카드 스타일, 그리고 같은 Pretendard 서체를 사용하되, 레이아웃 구성은 반드시 다르게 한다. 모든 섹션이 큰 상단 헤드라인 + 중앙 제품컷으로 반복되면 안 된다.";
}

/** 원본 구성 유지 모드에서는 분석이 전사한 원본 섹션이 그대로 생성 계획이 된다. */
function preserveSectionPlans(analysis: unknown, count: number, startSection: number): SectionPlan[] {
  return preserveBlueprintRecords(analysis)
    .map((record, index) => ({
      id: `S${index + 1}`,
      name: text(record.name) || `원본 ${index + 1}번째 섹션`,
      purpose: "원본 섹션의 정보와 문구를 그대로 유지한 채 디자인과 레이아웃만 새로 만든다.",
      source: text(record.evidence) || "원본 상세페이지 해당 구간",
      layout: "",
      order: index + 1,
      copy: readSectionCopy(record, 6, 6)
    }))
    .slice(startSection - 1, startSection - 1 + count);
}

/**
 * 전사 결과 중 실제로 그릴 문구가 있는 섹션만 남긴다.
 * 해시태그 줄, 구분선, 로고만 있는 띠처럼 대제목도 포인트도 없는 블록은 한 장을 차지할 내용이 없다.
 * 이런 블록이 들어오면 이미지 모델이 빈 제목 자리를 채우려다 지시문을 그대로 그리는 사고가 난다.
 */
function preserveBlueprintRecords(analysis: unknown): Record<string, unknown>[] {
  return blueprintSections(analysis)
    .map((item) => (item || {}) as Record<string, unknown>)
    .filter((record) => {
      const copy = readSectionCopy(record, 6, 6);
      const hasBody = Boolean(copy.headline || copy.subheadline) || copy.points.length > 0;
      if (!hasBody) console.info(`[generate] 그릴 문구가 없는 원본 블록 제외: ${text(record.name) || "(이름 없음)"}`);
      return hasBody;
    });
}

function blueprintSections(analysis: unknown): unknown[] {
  const sections = (analysis as { sections?: unknown })?.sections;
  return Array.isArray(sections) ? sections.slice(0, MAX_PRESERVE_SECTIONS) : [];
}

function blueprintSectionCount(analysis: unknown) {
  return preserveBlueprintRecords(analysis).length;
}

function emptySectionCopy(): SectionCopy {
  return { eyebrow: "", headline: "", subheadline: "", points: [], extras: [] };
}

/** 분석 결과에서 S1~S9 중 해당 섹션 레코드를 찾는다. 카피/고객 메모/계약을 같은 레코드에서 읽기 위함이다. */
function findSectionRecord(analysis: unknown, sectionId: string): Record<string, unknown> | undefined {
  const sections = (analysis as { sections?: unknown })?.sections;
  const list = Array.isArray(sections) ? sections : [];
  return list.find((item) => {
    const id = (item as { section_id?: unknown })?.section_id;
    return typeof id === "string" && id.toUpperCase() === sectionId;
  }) as Record<string, unknown> | undefined;
}

function readCustomerCore(analysis: unknown): CustomerCore {
  const raw = (analysis as { customer_core?: unknown })?.customer_core;
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    who: text(record.who),
    pain: text(record.pain),
    solution: text(record.solution),
    gain: text(record.gain),
    objection: text(record.objection)
  };
}

function readCustomerInsight(match: Record<string, unknown> | undefined, core: CustomerCore): CustomerInsight {
  const raw = match?.customer;
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    pain: text(record.pain) || core.pain,
    solution: text(record.solution) || core.solution,
    gain: text(record.gain) || core.gain
  };
}

function readSectionContract(
  match: Record<string, unknown> | undefined,
  template: SectionContractTemplate
): SectionContract {
  const raw = match?.contract;
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawForbidden = record.forbidden;
  const forbidden = Array.isArray(rawForbidden)
    ? rawForbidden.map((item) => text(item)).filter(Boolean)
    : text(rawForbidden)
      ? [text(rawForbidden)]
      : template.forbidden;
  return {
    buyer_question: text(record.buyer_question) || template.question,
    focus: text(record.focus) || template.focus,
    one_sentence_answer: text(record.one_sentence_answer),
    proof_type: text(record.proof_type) || template.proofType,
    proof_ref: text(record.proof_ref),
    new_information: text(record.new_information),
    forbidden: forbidden.length > 0 ? forbidden : template.forbidden
  };
}

/**
 * 이미지 프롬프트에는 이 섹션의 역할만 넣는다.
 * 고객의 불편/해결/이득을 모든 섹션에 반복하면 이미지도 같은 이야기를 반복하므로,
 * focus에 해당하는 한 줄만 꺼내 쓴다.
 */
function sectionContractPrompt(
  contract: SectionContract,
  customer: CustomerInsight,
  core: CustomerCore
): string {
  const lines = [
    "# 이 섹션이 고객에게 남겨야 하는 것 (연출 지시, 글자로 그리지 않는다)",
    `- 고객의 질문: ${contract.buyer_question}`,
    `- 이 섹션의 역할: ${FOCUS_LABELS[contract.focus] || contract.focus}`
  ];
  if (contract.one_sentence_answer) lines.push(`- 이 섹션의 한 문장 답: ${contract.one_sentence_answer}`);
  if (contract.focus === "identity" && core.who) lines.push(`- 이 페이지를 보는 사람: ${core.who}`);
  if (contract.focus === "pain" && customer.pain) lines.push(`- 고객의 불편: ${customer.pain}`);
  if (contract.focus === "solution" && customer.solution) lines.push(`- 해결 방식: ${customer.solution}`);
  if (contract.focus === "gain" && customer.gain) lines.push(`- 고객이 얻는 것: ${customer.gain}`);
  if (contract.focus === "proof" && contract.proof_ref) lines.push(`- 확인 가능한 근거 위치: ${contract.proof_ref}`);
  if (contract.focus === "risk" && core.objection) lines.push(`- 고객이 망설이는 이유: ${core.objection}`);
  if (contract.new_information) lines.push(`- 이 섹션에서 새로 말할 것: ${contract.new_information}`);
  if (contract.forbidden.length > 0) lines.push(`- 이 섹션에서 하지 말 것: ${contract.forbidden.join(", ")}`);
  lines.push(`- 연출: ${FOCUS_VISUALS[contract.focus] || "이 섹션의 역할에 맞는 장면 하나를 고른다."}`);
  lines.push("이 줄들은 연출 지시이며 이미지에 글자로 그리지 않는다.");
  return lines.join("\n");
}

/**
 * 사실 경계 필터. 말투는 프롬프트의 이해로 해결하고, 여기서는 데이터 정책만 지킨다.
 * 후기 개수·평점·판매량·순위는 시점마다 바뀌고 이 페이지는 여러 플랫폼에 오래 걸리므로,
 * 원본에 박혀 있어도 이미지에는 옮기지 않는다. 모델이 아무리 잘 이해해도 원본을 옮겨 적을 수 있어서 코드로 막는다.
 */
const VOLATILE_CLAIM_PATTERNS = [
  /별점|평점|만점/,
  /[\d][\d,.]*\s*점(?![검수화])/,
  /[\d][\d,.]*\s*(개|건|명|만|천|억)\s*(이상)?\s*(의)?\s*(후기|리뷰|구매평|구매|판매|고객|재구매)/,
  /(후기|리뷰|구매평|구매자|고객|판매)\s*[\d][\d,.]*/,
  /누적\s*(판매|후기|리뷰|구매)|재구매율|리뷰\s*수|후기\s*수/,
  /[\d]+\s*위(?![치험생])/,
  /★|⭐/,
  // "13314개", "4.8점"처럼 숫자만 있는 배지
  /^[\d][\d,.]*\s*(개|건|명|점|만|천|억|위)?\+?$/
];

/** 시점마다 바뀌는 수치면 버린다. 이미지에 그려지는 것보다 비는 편이 낫다. */
function consumerText(value: unknown) {
  const trimmed = text(value);
  if (!trimmed) return "";
  if (VOLATILE_CLAIM_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    console.warn(`[generate] 변동 수치로 판단해 카피에서 제외: ${trimmed}`);
    return "";
  }
  return trimmed;
}

function readSectionCopy(match: Record<string, unknown>, maxPoints = 4, maxExtras = 5): SectionCopy {
  const points = Array.isArray(match.points)
    ? match.points
        .map((point) => {
          if (typeof point === "string") return { label: consumerText(point), desc: "" };
          const record = point as Record<string, unknown>;
          const rawDesc = text(record?.desc);
          const desc = consumerText(rawDesc);
          // 설명이 걸러졌으면 라벨만 남겨도 정보가 없으니 포인트 전체를 버린다.
          if (rawDesc && !desc) return { label: "", desc: "" };
          return {
            label: consumerText(record?.label),
            desc
          };
        })
        .filter((point) => point.label || point.desc)
        .slice(0, maxPoints)
    : [];

  const extras = Array.isArray(match.extras)
    ? match.extras.map((extra) => consumerText(extra)).filter((extra) => extra.length > 0).slice(0, maxExtras)
    : [];

  return {
    eyebrow: consumerText(match.eyebrow),
    headline: consumerText(match.headline),
    subheadline: consumerText(match.subheadline),
    points,
    extras
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function prepareReferenceImages(files: File[]): Promise<ReferenceImage[]> {
  const references: ReferenceImage[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = sanitizeFileName(file.name || "upload");
    const mimeType = file.type || guessMimeType(safeName);

    if (mimeType.startsWith("image/")) {
      references.push({ name: safeName, mimeType, buffer });
    }
  }
  return references.slice(0, MAX_REFERENCE_IMAGES);
}

function parseDataUrlReference(value: string): ReferenceImage | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  // 파일명 확장자가 실제 mime과 다르면 OpenAI 편집 API가 입력을 거부한다.
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return {
    name: `hero-style-reference.${extension}`,
    mimeType,
    buffer: Buffer.from(match[2], "base64")
  };
}

function sectionTemplates(count: number, startSection = 1) {
  const templates = [
    ["S1 히어로", "3초 안에 제품, 타겟, 핵심 약속을 전달합니다.", "제품컷, 대표 USP", "[레이아웃: 풀블리드 히어로] 화면 전체를 제품 실사용 컷으로 채우고 그 위에 그라데이션 오버레이로 텍스트를 얹는다. 정보 카드와 아이콘 타일을 쓰지 않는다. 질문형 훅 한 줄(손글씨 느낌) - 제품명 대제목 - 핵심 약속 1줄 순으로, 하단에 요약 칩 3개만 가로 배치한다."],
    ["S2 문제 공감", "고객이 자기 상황이라고 느끼는 체크리스트를 배치합니다.", "사용 전 고민 문구", "[레이아웃: 좌우 분할 다크] 화면을 세로로 반 나눈다. 왼쪽 절반은 밝은 배경에 질문형 대제목과 고민 3개(체크 박스 대신 손글씨 밑줄 스타일), 오른쪽 절반은 어둡고 차가운 톤의 고민 장면 사진을 세로로 꽉 채운다. 카드 프레임을 만들지 않고 텍스트를 배경 위에 직접 놓는다."],
    ["S3 생활 변화", "구매 후 달라지는 생활을 체감 언어로 보여줍니다.", "사용 후 변화, 생활 장면", "[레이아웃: 가로 풀폭 배너 3단] 카드 프레임 없이 화면을 가로로 3등분한 풀폭 배너 3개를 위에서 아래로 쌓는다. 각 배너는 왼쪽에 아주 큰 숫자(01/02/03), 가운데 체감 언어 소제목, 오른쪽에 반쯤 잘린 근접 사진. 배너마다 배경 톤을 살짝 다르게 한다."],
    ["S4 해결 방식", "이 제품의 구조·소재·방식이 불편을 어떻게 없애는지 보여줍니다.", "소재, 구조, 작동 방식", "[레이아웃: 구조 확대 다이어그램] 상단에 짧은 대제목 1줄, 중앙에 제품 단면이나 핵심 부위를 크게 확대한 사진 1장. 사진 위에 3개의 얇은 리더선과 짧은 라벨로 '무엇이 / 어떻게 / 그래서'를 표시한다. 하단에 3단 원리 카드(문제 → 구조 → 결과)를 가로로 배치한다. 비교표와 X/체크 표시는 쓰지 않는다."],
    ["S5 근거/신뢰", "결과, 조건, 해석의 3단 구조로 신뢰를 설계합니다.", "인증, 수치, 테스트", "[레이아웃: 다크 패널 - 페이지 전체에서 유일한 어두운 배경] 짙은 네이비 또는 차콜 배경에 흰 텍스트. 중앙에 큰 따옴표 스타일의 근거 문장 1개, 그 아래 작은 근거 나열 3개(아이콘 없이 숫자와 라벨만). 밝은 색 카드를 만들지 않는다."],
    ["S6 사용법", "구매 후 사용 장벽을 낮춥니다.", "루틴, 구성품", "[레이아웃: 지그재그 매거진] 사진과 텍스트가 좌우로 엇갈리는 3단 구조. 각 단은 반쯤 차는 큰 사진 한 장에 STEP 숫자와 짧은 설명 2줄을 살짝 겹쳐 놓는다. 카드 테두리 없이 사진에 텍스트를 겹치는 매거진 스타일."],
    ["S7 사용 장면", "사람이 실제로 쓴 장면과 말로 사용감을 보여줍니다.", "사용 장면, 사용감 문장", "[레이아웃: 대형 인용구] 말풍선과 카드를 쓰지 않고, 큰 따옴표 기호와 함께 사용 장면에서 확인된 문장 3개를 세로로 크게 배치한다. 각 문장 아래 작은 작성자 라벨 하나. 배경은 아이보리 톤으로 다른 섹션과 구분한다. 별 아이콘은 장식으로 써도 되지만 평점 숫자와 후기 개수는 그리지 않는다."],
    ["S8 배송·교환 안내", "마지막 구매 저항을 해소합니다.", "배송, AS, 교환", "[레이아웃: 심플 텍스트 리스트] 카드와 배지 없이 흰 배경에 항목당 한 줄씩(굵은 라벨 + 설명) 정돈된 리스트 4~5줄. 각 줄 왼쪽에 작은 라인 아이콘 하나만. 여백을 넉넉히 두고 마지막에 마무리 문구 한 줄. 확인된 조건이 적으면 줄 수를 줄인다."],
    ["S9 상품정보 고시", "가격 분쟁·취소·반품 같은 구매 분쟁을 예방하는 법정 표시 세션이다.", "품명, 재질, 크기, 제조국, 제조자/수입자, A/S", "[레이아웃: 검은 배경의 테이블 - 페이지에서 유일한 어두운 테이블 형태이며 고시전용 세션] 각 행의 왼쪽에는 고시 조항명, 오른쪽에는 값. 원본 상세에 실제로 적힌 항목과 값만 행으로 만들고, 원본에 없는 항목은 행을 만들지 않는다(미확인·빈값·참조 문구 금지). 단 하나의 예외: 제조자·수입자 행은 원본에 어떤 상호가 적혀 있든 반드시 쩡스하우스로 표기한다. 한이룸·HANEERUM·HR 등 도구·브랜드 이름은 어떤 칸에도 쓰지 않는다. 확인된 항목이 적으면 표를 작게 하고 여백을 넉넉히 한다. 고시 섹션 생략 금지."],
  ];

  return templates
    .map(([name, purpose, source, layout], index) => ({ id: `S${index + 1}`, name, purpose, source, layout }))
    .slice(startSection - 1, startSection - 1 + count);
}

function inferProjectTitle(analysis: unknown, channel: string) {
  const product = typeof analysis === "object" && analysis && "product_inferred" in analysis
    ? (analysis as { product_inferred?: Record<string, unknown> }).product_inferred || {}
    : {};
  const brand = pickString(product, ["brand_name", "brand", "manufacturer", "maker"]);
  const productName = pickString(product, ["product_name", "name", "product", "title"]);
  const category = pickString(product, ["category", "product_category"]);

  if (brand && productName) {
    return productName.includes(brand) ? `${productName} 리디자인` : `${brand} ${productName} 리디자인`;
  }
  if (productName) return `${productName} 리디자인`;
  if (category) return `${category} 상세페이지 리디자인`;
  return `${channel} 상세페이지 리디자인`;
}

function pickString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseMaybeJson(text: string) {
  const raw = String(text || "").trim();
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return { summary: raw };
  try {
    return JSON.parse(jsonText);
  } catch {
    return { summary: raw };
  }
}

function extractOpenAIText(data: { output?: Array<{ content?: Array<{ text?: string }> }> }) {
  return data.output?.flatMap((item) => item.content || []).map((content) => content.text || "").filter(Boolean).join("\n") || "";
}

function modelMeta(provider: Provider) {
  if (provider === "google") {
    return { provider: "google" as const, label: "Google Nano Banana 2", id: GOOGLE_NANO_BANANA_2_MODEL };
  }
  if (provider === "kie") {
    return { provider: "kie" as const, label: "KIE GPT-4o Image", id: KIE_GPT_IMAGE_MODEL };
  }
  if (provider === "kie-gpt-image-2-5") {
    return { provider: "kie-gpt-image-2-5" as const, label: "KIE GPT Image 2.5 (Flare)", id: "gpt-image-2-5-flare-image-to-image" };
  }
  if (provider === "kie-gpt-image-2-5-sunburst") {
    return { provider: "kie-gpt-image-2-5-sunburst" as const, label: "KIE GPT Image 2.5 (Sunburst)", id: "gpt-image-2-5-sunburst-image-to-image" };
  }
  if (provider === "kie-nano-banana") {
    return { provider: "kie-nano-banana" as const, label: "KIE Nano Banana", id: KIE_NANO_BANANA_MODEL };
  }
  if (provider === "openai-direct") {
    return { provider: "openai-direct" as const, label: "GPT Image 2.0 (OpenAI 직접)", id: OPENAI_IMAGE_MODEL };
  }
  return { provider: "openai" as const, label: "OpenAI Image 2.0", id: OPENAI_IMAGE_MODEL };
}

/**
 * 이미지 API의 일시적 실패(요청 제한, 5xx, 타임아웃)는 잠시 뒤 다시 시도한다.
 * 히어로 직후 나머지 섹션을 연속 생성할 때 요청 제한으로 전체가 중단되던 문제를 막는다.
 */
async function withTransientRetry<T>(sectionId: string, run: () => Promise<T>): Promise<T> {
  const delays = [8000, 20000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= delays.length || !isTransientProviderError(message)) throw error;
      console.warn(`[generate] ${sectionId} 일시 오류로 ${delays[attempt] / 1000}초 후 재시도 (${attempt + 1}/${delays.length}): ${message}`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

function isTransientProviderError(message: string) {
  return /rate limit|rate_limit|too many requests|429|timeout|timed out|temporarily|overloaded|unavailable|internal server error|server_error|\b50[0234]\b/i.test(message);
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text || response.statusText } };
  }
}

function withRequestId(message: string, response: Response) {
  const requestId = response.headers.get("x-request-id");
  return requestId ? `${message} (request_id: ${requestId})` : message;
}

function humanizeProviderError(message: string) {
  if (message.includes("Incorrect API key provided")) {
    return [
      "OpenAI API 키가 올바르지 않습니다.",
      "API 키 설정에서 기존 키를 삭제한 뒤 OpenAI Platform에서 발급한 최신 키를 다시 입력해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("invalid_api_key")) {
    return [
      "API 키가 올바르지 않습니다.",
      "선택한 이미지 생성 모델에 맞는 API 키를 다시 입력해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("must be verified") && message.includes("gpt-image-2-2026-04-21")) {
    return [
      "OpenAI Image 2.0 사용 권한이 아직 없습니다.",
      "이 모델은 OpenAI 조직 인증이 필요합니다.",
      "OpenAI Platform > Settings > Organization > General에서 Verify Organization을 완료한 뒤 15분 정도 기다려주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("does not have access to model") && message.includes("gpt-image-2-2026-04-21")) {
    return [
      "현재 입력한 OpenAI API 키의 프로젝트가 OpenAI Image 2.0 모델에 접근할 수 없습니다.",
      "OpenAI 조직 인증, 프로젝트 권한, 결제 상태를 확인한 뒤 Image 2.0 권한이 있는 프로젝트의 API 키를 다시 입력해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("Billing hard limit has been reached")) {
    return [
      "OpenAI 결제 한도에 도달해 이미지 생성이 중단되었습니다.",
      "OpenAI Platform의 Billing 한도 또는 사용량 제한을 올린 뒤 다시 시도해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  if (message.includes("exceeded your current quota") || message.includes("Quota exceeded")) {
    return "Google Nano Banana 2 API 할당량을 초과했습니다. Google AI Studio 또는 Cloud Console에서 현재 사용량과 rate limit을 확인한 뒤 잠시 후 다시 시도해주세요.";
  }
  if (message.includes("Invalid image file or mode") || message.includes("Invalid input image")) {
    return [
      "업로드 이미지 형식이 OpenAI Image 2.0 편집 입력과 맞지 않습니다.",
      "앱에서 PNG 변환/분할 후 다시 전송하도록 되어 있으니 새로고침 후 다시 생성해주세요.",
      message.match(/request_id: [^)]+/)?.[0] || ""
    ].filter(Boolean).join(" ");
  }
  return message;
}

function sanitizeFileName(name: string) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "upload";
}

function guessMimeType(name: string) {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
