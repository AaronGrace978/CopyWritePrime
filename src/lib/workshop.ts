export interface Workshopish {
  role: "user" | "assistant" | string;
  content: string;
  failed?: boolean;
}

/** Empty, stalled, or the old "Nothing came back" line. Never send these back as history. */
export function isFailedWorkshopTurn(turn: Workshopish): boolean {
  if (turn.failed) return true;
  if (turn.role !== "assistant") return false;
  const c = turn.content.trim();
  if (!c) return true;
  if (c === "Nothing came back. Ask again.") return true;
  if (c === "(stopped before a reply.)") return true;
  if (c.startsWith("Couldn't answer.")) return true;
  if (c.startsWith("Nothing came back from ")) return true;
  return false;
}

/** Drop a trailing failed reply and the question that caused it, so a retry replaces the pair. */
export function withoutFailedTail<T extends Workshopish>(turns: T[]): T[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant" || !isFailedWorkshopTurn(last)) return turns;
  const cut = turns.length >= 2 && turns[turns.length - 2].role === "user" ? 2 : 1;
  return turns.slice(0, -cut);
}

/** Prior turns the model is allowed to see. Failed replies stay in the UI log only. */
export function workshopHistory(turns: Workshopish[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role === "user") {
      const next = turns[i + 1];
      if (next?.role === "assistant" && isFailedWorkshopTurn(next)) continue;
      out.push({ role: "user", content: t.content });
    } else if (t.role === "assistant" && !isFailedWorkshopTurn(t)) {
      out.push({ role: "assistant", content: t.content });
    }
  }
  return out;
}
