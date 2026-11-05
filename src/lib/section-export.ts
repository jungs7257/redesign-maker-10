import JSZip from "jszip";

export type ExportCustomerCore = {
  who?: string;
  pain?: string;
  solution?: string;
  gain?: string;
  objection?: string;
};

export type ExportCustomerInsight = {
  pain?: string;
  solution?: string;
  gain?: string;
};

export type ExportSectionContract = {
  buyer_question?: string;
  focus?: string;
  one_sentence_answer?: string;
  proof_type?: string;
  proof_ref?: string;
  new_information?: string;
  forbidden?: string[];
};

export type ExportSection = {
  id: string;
  name: string;
  imageUrl?: string;
  copy?: {
    eyebrow?: string;
    headline?: string;
    subheadline?: string;
    points?: Array<{ label?: string; desc?: string }>;
    extras?: string[];
  };
  customer?: ExportCustomerInsight;
  contract?: ExportSectionContract;
};

const focusLabels: Record<string, string> = {
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

/** 01_히어로.png 형태의 순번 파일명 */
export function buildZipFileName(index: number, sectionName: string) {
  const safe = sectionName.replace(/^S\d+\s*/, "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "");
  return `${String(index + 1).padStart(2, "0")}_${safe || "섹션"}.png`;
}

export async function buildSectionsZip(
  sections: ExportSection[],
  title: string,
  customerCore?: ExportCustomerCore
): Promise<Blob> {
  const zip = new JSZip();
  let added = 0;

  sections.forEach((section, index) => {
    const base64 = section.imageUrl?.split(",")[1];
    if (!base64) return;
    zip.file(buildZipFileName(index, section.name), base64, { base64: true });
    added += 1;
  });

  if (added === 0) throw new Error("ZIP으로 묶을 이미지가 없습니다.");
  zip.file("카피.md", buildBlueprintMarkdown(sections, title, customerCore));
  return zip.generateAsync({ type: "blob" });
}

/** 외주·디자이너 전달용 카피 마크다운. 고객 불편/해결/이득을 카피 앞에 붙여 기획 의도를 남긴다. */
export function buildBlueprintMarkdown(
  sections: ExportSection[],
  title: string,
  customerCore?: ExportCustomerCore
) {
  const lines: string[] = [`# ${title} 상세페이지 카피`, ""];

  if (customerCore) {
    const coreLines = [
      customerCore.who ? `- **누구:** ${customerCore.who}` : "",
      customerCore.pain ? `- **불편:** ${customerCore.pain}` : "",
      customerCore.solution ? `- **해결:** ${customerCore.solution}` : "",
      customerCore.gain ? `- **이득:** ${customerCore.gain}` : "",
      customerCore.objection ? `- **망설임:** ${customerCore.objection}` : ""
    ].filter(Boolean);
    // H1/H2로 쓰면 copy_lint의 md 파서가 '고객 코어'를 섹션으로 오인한다. H3로 둔다.
    if (coreLines.length > 0) lines.push("### 고객 코어", ...coreLines, "");
  }

  sections.forEach((section, index) => {
    const copy = section.copy;
    const contract = section.contract;
    const customer = section.customer;
    lines.push(`## ${index + 1}. ${section.name}`);

    if (contract?.buyer_question || customer?.pain || customer?.solution || customer?.gain) {
      const insightLines = [
        contract?.buyer_question ? `- **고객 질문:** ${contract.buyer_question}` : "",
        contract?.focus ? `- **이 섹션의 역할:** ${focusLabels[contract.focus] || contract.focus}` : "",
        customer?.pain ? `- **고객 불편:** ${customer.pain}` : "",
        customer?.solution ? `- **해결 방식:** ${customer.solution}` : "",
        customer?.gain ? `- **고객 이득:** ${customer.gain}` : "",
        contract?.one_sentence_answer ? `- **한 문장 답:** ${contract.one_sentence_answer}` : "",
        contract?.proof_type ? `- **증거 유형:** ${contract.proof_type}` : "",
        contract?.proof_ref ? `- **근거 위치:** ${contract.proof_ref}` : "",
        contract?.new_information ? `- **새 정보:** ${contract.new_information}` : "",
        contract?.forbidden?.length ? `- **금지:** ${contract.forbidden.join(", ")}` : ""
      ].filter(Boolean);
      if (insightLines.length > 0) lines.push("", "**고객 인사이트:**", ...insightLines, "");
    }

    if (copy?.eyebrow) lines.push(`**라벨:** ${copy.eyebrow}`);
    if (copy?.headline) lines.push(`**대제목:** ${copy.headline}`);
    if (copy?.subheadline) lines.push(`**설명:** ${copy.subheadline}`);
    if (copy?.points?.length) {
      lines.push("", "**핵심 포인트:**", ...copy.points.map((point) => `- **${point.label || ""}** ${point.desc || ""}`.trim()));
    }
    if (copy?.extras?.length) lines.push("", `**아이콘 타일:** ${copy.extras.join(" · ")}`);
    if (!copy?.headline && !copy?.subheadline && !copy?.points?.length) {
      lines.push("_이 섹션은 카피 데이터 없이 생성되었습니다._");
    }
    lines.push("");
  });

  return lines.join("\n");
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
