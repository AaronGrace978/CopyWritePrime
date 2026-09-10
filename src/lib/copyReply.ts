/**
 * Models sometimes dump the plan onto the page: think tags, "let me restructure",
 * paragraph-by-paragraph notes. Fix/Enhance must land only the copy.
 */

const THINK_BLOCK = /<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\s*/gi;
const CUT_MARKER =
  /(?:^|\n)\s*(?:the (?:fixed |final )?(?:cut|copy)|here(?:'s| is) (?:the )?(?:fixed |final )?(?:cut|copy|page))\s*:\s*\n+/i;
const PLAN_HINT =
  /\b(the user wants|let me |paragraph \d|fix the broken|hmm,?|wait,?|i'll bold|no commentary|restructure|clean, keep|return only the|thinking out loud)\b/i;

function firstLineStart(source: string): string {
  const line = source.trim().split(/\n/)[0]?.trim() ?? "";
  return line.slice(0, 48);
}

export function stripLeakedThinking(text: string, source = ""): string {
  let out = text
    .replace(/^\uFEFF/, "")
    .replace(THINK_BLOCK, "")
    .replace(/<\/?(?:think|thinking)>/gi, "")
    .trim();

  const marked = out.search(CUT_MARKER);
  if (marked >= 0) {
    const after = out.slice(marked).replace(CUT_MARKER, "").trim();
    if (after.length > 20) out = after;
  }

  const start = firstLineStart(source);
  if (start.length >= 24) {
    const idx = out.indexOf(start);
    if (idx > 40 && PLAN_HINT.test(out.slice(0, idx))) {
      out = out.slice(idx);
    }
  }

  return out.trim();
}
