import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    serverOpenaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    // 나노바나나 계열은 KIE 키로도 동작하므로 활성 표시에 포함한다.
    serverGoogleKeyConfigured: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.KIE_API_KEY),
    // 방식 B: 서버 키 존재 상태(값은 절대 내려보내지 않는다)
    serverKieKeyConfigured: Boolean(process.env.KIE_API_KEY),
    serverZaiKeyConfigured: Boolean(process.env.ZAI_API_KEY),
    serverGeminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    serverFluxKeyConfigured: Boolean(process.env.FLUX_API_KEY),
    serverDeepseekKeyConfigured: Boolean(process.env.DEEPSEEK_API_KEY)
  });
}
