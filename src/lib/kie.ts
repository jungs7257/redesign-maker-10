/**
 * kie.ai Market 제공자 연동(GPT-4o Image / Nano Banana 계열).
 * 기존 OpenAI/Google 직접 호출 로직은 절대 건드리지 않고, 여기에만 kie.ai 분기를 둔다.
 *
 * 통합 태스크 API 흐름:
 *  1. POST https://api.kie.ai/api/v1/jobs/createTask -> { code, data: { taskId } }
 *  2. GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=... -> { data: { state, resultJson } }
 *     - state: waiting | queuing | generating | success | fail
 *     - resultJson: '{ "resultUrls": ["https://..."] }' (JSON 문자열)
 *
 * 참조 이미지는 공개 URL이 필요해서, 업로드 API(kieai.redpandaai.co)를 거친다.
 */

export const KIE_GPT_IMAGE_MODEL = "gpt-image-2-image-to-image";
export const KIE_NANO_BANANA_MODEL = "nano-banana-2-1";
// GPT Image 2.5 (2026-09 출시). Flare = 저렴·빠른 소형 모델, Sunburst = 품질 최적화 베이스.
export const KIE_GPT_IMAGE_25_FLARE_TEXT_TO_IMAGE = "gpt-image-2-5-flare-text-to-image";
export const KIE_GPT_IMAGE_25_FLARE_IMAGE_TO_IMAGE = "gpt-image-2-5-flare-image-to-image";
export const KIE_GPT_IMAGE_25_SUNBURST_TEXT_TO_IMAGE = "gpt-image-2-5-sunburst-text-to-image";
export const KIE_GPT_IMAGE_25_SUNBURST_IMAGE_TO_IMAGE = "gpt-image-2-5-sunburst-image-to-image";

const KIE_API_BASE = "https://api.kie.ai";
const KIE_UPLOAD_BASE = "https://kieai.redpandaai.co";

export type KieReferenceImage = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

function kieApiKey() {
  const key = process.env.KIE_API_KEY || "";
  if (!key) throw new Error("KIE_API_KEY가 서버에 설정되어 있지 않습니다. 서버 관리자에게 kie.ai 키 설정을 요청해주세요.");
  return key;
}

async function readKieJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: response.status, msg: text || response.statusText };
  }
}

/** kie.ai는 실패여도 HTTP 200 + body.code 로 응답한다. 공통 검증. */
function assertKieOk(data: { code?: number; msg?: string }, fallback: string) {
  if (data.code !== 200) {
    throw new Error(data.msg || fallback);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 참조 이미지를 kie.ai 업로드 API에 올려 공개 URL을 받는다. */
async function uploadReference(reference: KieReferenceImage): Promise<string> {
  const apiKey = kieApiKey();
  const response = await fetch(KIE_UPLOAD_BASE + "/api/file-base64-upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      base64Data: "data:" + reference.mimeType + ";base64," + reference.buffer.toString("base64"),
      uploadPath: "redesign-maker/references",
      fileName: reference.name
    })
  });

  const data = await readKieJson(response);
  if (!response.ok || data?.success === false) {
    throw new Error(data?.msg || "kie.ai 참조 이미지 업로드 실패");
  }
  const url = data?.data?.downloadUrl;
  if (!url) throw new Error("kie.ai 업로드 응답에 다운로드 URL이 없습니다.");
  return url;
}

async function uploadReferences(references: KieReferenceImage[]): Promise<string[]> {
  const urls: string[] = [];
  for (const reference of references) {
    urls.push(await uploadReference(reference));
  }
  return urls;
}

async function waitForTaskResult(taskId: string, timeoutMs = 240000): Promise<string[]> {
  const apiKey = kieApiKey();
  const deadline = Date.now() + timeoutMs;
  let delayMs = 3000;

  while (Date.now() < deadline) {
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 1.5, 8000);

    const response = await fetch(KIE_API_BASE + "/api/v1/jobs/recordInfo?taskId=" + encodeURIComponent(taskId), {
      headers: { Authorization: "Bearer " + apiKey }
    });
    const data = await readKieJson(response);
    assertKieOk(data, "kie.ai 태스크 조회 실패");

    const state = data?.data?.state;
    if (state === "success") {
      let urls: string[] = [];
      try {
        const parsed = typeof data.data.resultJson === "string"
          ? JSON.parse(data.data.resultJson)
          : data.data.resultJson;
        urls = Array.isArray(parsed?.resultUrls) ? parsed.resultUrls : [];
      } catch {
        urls = [];
      }
      if (urls.length === 0) throw new Error("kie.ai 응답에 이미지 URL이 없습니다.");
      return urls;
    }
    if (state === "fail") {
      throw new Error(data?.data?.failMsg || "kie.ai 이미지 생성 태스크가 실패했습니다.");
    }
  }
  throw new Error("kie.ai 이미지 생성이 시간 안에 끝나지 않았습니다. 잠시 후 다시 시도해주세요.");
}

async function downloadImage(url: string): Promise<{ mimeType: string; buffer: Buffer }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("kie.ai 생성 이미지 다운로드 실패 (HTTP " + response.status + ")");
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  return { mimeType: mimeType.startsWith("image/") ? mimeType : "image/png", buffer };
}

/** createTask -> poll -> download 공통 흐름 */
async function runKieImageTask(model: string, input: Record<string, unknown>, references: KieReferenceImage[]): Promise<{ mimeType: string; buffer: Buffer }> {
  const apiKey = kieApiKey();
  const imageUrls = await uploadReferences(references);

  const response = await fetch(KIE_API_BASE + "/api/v1/jobs/createTask", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input: { ...input, image_urls: imageUrls } })
  });

  const data = await readKieJson(response);
  assertKieOk(data, "kie.ai 태스크 생성 실패");
  const taskId = data?.data?.taskId;
  if (!taskId) throw new Error("kie.ai 응답에 taskId가 없습니다.");

  const urls = await waitForTaskResult(taskId);
  return downloadImage(urls[0]);
}

/** GPT-4o Image(GPT Image 2) 계열 - 참조 이미지가 있을 때 image-to-image, 없으면 text-to-image. */
export async function generateKieImage({
  prompt,
  references,
  ratio
}: {
  prompt: string;
  references: KieReferenceImage[];
  ratio: string;
}) {
  const hasRefs = references.length > 0;
  const model = hasRefs ? KIE_GPT_IMAGE_MODEL : "gpt-image-2-text-to-image";
  return runKieImageTask(model, { prompt, aspect_ratio: ratio, resolution: "1K" }, references);
}

/** Nano Banana 계열 - 참조 이미지가 있을 때 nano-banana-2-1. */
export async function generateKieNanoBanana({
  prompt,
  references,
  ratio
}: {
  prompt: string;
  references: KieReferenceImage[];
  ratio: string;
}) {
  if (references.length === 0) {
    throw new Error("kie.ai Nano Banana 편집에는 참조 이미지가 필요합니다.");
  }
  return runKieImageTask(KIE_NANO_BANANA_MODEL, { prompt, aspect_ratio: ratio, resolution: "1K", output_format: "png" }, references);
}

/** GPT Image 2.5 계열 - quality: "flare"(저렴·빠름) | "sunburst"(고품질). 참조 이미지가 있으면 image-to-image. */
export async function generateKieImage25({
  prompt,
  references,
  ratio,
  quality = "flare"
}: {
  prompt: string;
  references: KieReferenceImage[];
  ratio: string;
  quality?: "flare" | "sunburst";
}) {
  const hasRefs = references.length > 0;
  const model = quality === "sunburst"
    ? (hasRefs ? KIE_GPT_IMAGE_25_SUNBURST_IMAGE_TO_IMAGE : KIE_GPT_IMAGE_25_SUNBURST_TEXT_TO_IMAGE)
    : (hasRefs ? KIE_GPT_IMAGE_25_FLARE_IMAGE_TO_IMAGE : KIE_GPT_IMAGE_25_FLARE_TEXT_TO_IMAGE);
  return runKieImageTask(model, { prompt, aspect_ratio: ratio, resolution: "1K" }, references);
}
