/**
 * What to send as `think`. Ollama turns thinking ON by default for any model that supports it,
 * and the trace counts against num_predict, so a short writing task can spend its whole budget
 * thinking and return an empty reply. We always say so explicitly. gpt-oss cannot switch it
 * off, only down, so it gets "low". `false` is accepted by models that cannot think at all.
 */
export function ollamaThink(model: string, reasoning: boolean): boolean | "low" | "high" {
  const gptOss = /gpt-oss/i.test(model);
  if (reasoning) return gptOss ? "high" : true;
  return gptOss ? "low" : false;
}

/** Thinking tokens come out of num_predict, so a thinking run needs headroom or the reply starves. */
export function ollamaBudget(maxTokens: number, think: boolean | "low" | "high"): number {
  if (think === false) return maxTokens;
  if (think === "low") return maxTokens + 1000;
  return maxTokens + 4000;
}
