function severityRank(severity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function appendReasoningSection(lines, reasoningSummary) {
  if (!Array.isArray(reasoningSummary) || reasoningSummary.length === 0) {
    return;
  }

  lines.push("", "Reasoning:");
  for (const section of reasoningSummary) {
    lines.push(`- ${section}`);
  }
}

function validateSessionReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Missing string `verdict`.";
  }
  if (typeof data.phase !== "string" || !data.phase.trim()) {
    return "Missing string `phase`.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`.";
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`.";
  }
  return null;
}

function normalizeSessionReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  return {
    category: typeof source.category === "string" && source.category.trim() ? source.category.trim() : "process",
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    evidence: typeof source.evidence === "string" && source.evidence.trim() ? source.evidence.trim() : "No evidence provided.",
    recommendation:
      typeof source.recommendation === "string" && source.recommendation.trim()
        ? source.recommendation.trim()
        : "Review the evidence and decide whether a fix is needed.",
    suggested_owner:
      typeof source.suggested_owner === "string" && source.suggested_owner.trim()
        ? source.suggested_owner.trim()
        : "claude"
  };
}

function normalizeSessionReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    phase: data.phase.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeSessionReviewFinding(finding, index)),
    next_steps: data.next_steps
      .filter((step) => typeof step === "string" && step.trim())
      .map((step) => step.trim())
  };
}

export function renderSessionReviewResult(parsedResult, meta = {}) {
  if (!parsedResult.parsed) {
    const lines = [
      "# Codex Session Review",
      "",
      "Codex did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult.parseError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateSessionReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [
      "# Codex Session Review",
      "",
      `Phase: ${meta.phase ?? "unknown"}`,
      "Codex returned JSON with an unexpected session-review shape.",
      "",
      `- Validation error: ${validationError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeSessionReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    "# Codex Session Review",
    "",
    `Phase: ${data.phase}`,
    `Verdict: ${data.verdict}`,
    meta.reviewId ? `Review ID: ${meta.reviewId}` : "",
    "",
    data.summary,
    ""
  ].filter((line, index, all) => line || all[index - 1] !== "");

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      lines.push(`- [${finding.severity}] [${finding.category}] ${finding.title}`);
      lines.push(`  ${finding.body}`);
      lines.push(`  Evidence: ${finding.evidence}`);
      lines.push(`  Recommendation: ${finding.recommendation}`);
      lines.push(`  Suggested owner: ${finding.suggested_owner}`);
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}
