export type EvalFinding = {
  label: string;
  score: number;
  notes: string;
};

export type EvalResult = {
  overall: number;
  findings: EvalFinding[];
  recommendations: string[];
};

export type DeterministicRule = {
  label: string;
  type: "contains" | "missing" | "max_words" | "min_words" | "regex" | "llm_judge";
  value: string;
  importance: number;
};

function scoreLength(text: string): EvalFinding {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 25) {
    return { label: "Substance", score: 45, notes: "Draft is too thin to evaluate deeply." };
  }
  if (words > 450) {
    return { label: "Substance", score: 68, notes: "Draft may need tightening for most feeds." };
  }
  return { label: "Substance", score: 84, notes: "Draft has enough material for a meaningful pass." };
}

function scoreProof(text: string): EvalFinding {
  const hasProof = /\b(data|case|proof|because|example|result|customer|evidence)\b/i.test(text);
  return hasProof
    ? { label: "Grounding", score: 82, notes: "Draft includes at least one proof or evidence signal." }
    : { label: "Grounding", score: 52, notes: "Draft needs a concrete proof point or example." };
}

function scoreClarity(text: string): EvalFinding {
  const longSentences = text.split(/[.!?]/).filter((sentence) => sentence.trim().split(/\s+/).length > 32);
  return longSentences.length > 2
    ? { label: "Clarity", score: 61, notes: "Several sentences are long enough to slow scanning." }
    : { label: "Clarity", score: 86, notes: "Draft is reasonably scannable." };
}

export function evaluateDraft(text: string): EvalResult {
  const findings = [scoreLength(text), scoreProof(text), scoreClarity(text)];
  const overall = Math.round(findings.reduce((sum, finding) => sum + finding.score, 0) / findings.length);
  const recommendations = findings
    .filter((finding) => finding.score < 75)
    .map((finding) => `${finding.label}: ${finding.notes}`);

  return {
    overall,
    findings,
    recommendations: recommendations.length ? recommendations : ["Draft is ready for a stronger editorial pass."]
  };
}

export function evaluateRules(text: string, rules: DeterministicRule[]): EvalResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const findings = rules.map((rule) => {
    const values = rule.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    let pass = true;
    if (rule.type === "contains") {
      pass = values.some((value) => text.toLowerCase().includes(value.toLowerCase()));
    }
    if (rule.type === "missing") {
      pass = values.every((value) => !text.toLowerCase().includes(value.toLowerCase()));
    }
    if (rule.type === "min_words") {
      pass = words.length >= Number(rule.value);
    }
    if (rule.type === "max_words") {
      pass = words.length <= Number(rule.value);
    }
    if (rule.type === "regex") {
      try {
        pass = new RegExp(rule.value, "i").test(text);
      } catch {
        pass = false;
      }
    }
    if (rule.type === "llm_judge") {
      return {
        label: rule.label,
        score: 50,
        notes: "LLM judge rubrics require a model-backed evaluator and were not scored mechanically."
      };
    }
    return {
      label: rule.label,
      score: pass ? 100 : 35,
      notes: pass ? "Rule passed." : `Rule failed: ${rule.type} ${rule.value}.`
    };
  });
  const totalWeight = Math.max(1, rules.reduce((sum, rule) => sum + rule.importance, 0));
  const overall = Math.round(
    findings.reduce((sum, finding, index) => sum + finding.score * rules[index].importance, 0) /
      totalWeight
  );
  return {
    overall,
    findings,
    recommendations: findings
      .filter((finding) => finding.score < 75)
      .map((finding) => `${finding.label}: ${finding.notes}`)
  };
}

export function comparePromptVariants(input: string, variantA: string, variantB: string, expected: string) {
  const a = evaluateDraft(`${variantA}\n\n${input}\n\nExpected: ${expected}`);
  const b = evaluateDraft(`${variantB}\n\n${input}\n\nExpected: ${expected}`);
  return {
    a,
    b,
    winner: a.overall === b.overall ? "tie" : a.overall > b.overall ? "A" : "B"
  };
}
