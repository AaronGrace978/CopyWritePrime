export interface VoiceTraits {
  sentence: string;
  person: string;
  energy: string;
  diction: string;
}

export interface VoiceSample {
  name: string;
  words: number;
}

export interface VoiceProfile {
  updatedAt: number;
  card: string;
  traits: VoiceTraits;
  samples: VoiceSample[];
  wordCount: number;
  sourceLabel: string;
}

export interface VoiceStats {
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentence: number;
  avgParagraph: number;
  contractionRate: number;
  questionRate: number;
  firstPerson: number;
  secondPerson: number;
  numeralRate: number;
  emDashRate: number;
  typeToken: number;
  topWords: string[];
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with", "at",
  "from", "by", "as", "is", "it", "that", "this", "are", "be", "was", "were", "been",
  "have", "has", "had", "i", "you", "we", "they", "he", "she", "them", "his", "her",
  "not", "no", "if", "then", "so", "than", "too", "very", "just", "into", "about",
  "my", "your", "our", "their", "me", "us",
]);

function sentencesOf(text: string) {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function wordsOf(text: string) {
  return text.toLowerCase().match(/[a-z0-9'$%]+/g) ?? [];
}

export function analyzeVoice(text: string): VoiceStats {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = sentencesOf(clean);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const words = wordsOf(clean);
  const unique = new Set(words);
  const contractions = (clean.match(/\b[a-zA-Z]+n't\b|\b(?:I'm|I've|I'd|I'll|you're|we're|they're|it's|that's|what's|who's|can't|won't|don't|doesn't)\b/g) ?? []).length;
  const questions = sentences.filter((s) => s.endsWith("?")).length;
  const first = (clean.match(/\b(?:I|I'm|I've|I'd|I'll|me|my|we|we're|our|us)\b/g) ?? []).length;
  const second = (clean.match(/\b(?:you|you're|you've|you'd|you'll|your)\b/gi) ?? []).length;
  const numerals = (clean.match(/\$[\d.,]+|\b\d+(?:\.\d+)?%?|\b\d+–\d+\b/g) ?? []).length;
  const emDashes = (clean.match(/[—–]| -- /g) ?? []).length;
  const counts = new Map<string, number>();
  for (const w of words) {
    if (w.length < 4 || STOP.has(w) || /^\d/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const topWords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);

  const avgSentence = sentences.length ? words.length / sentences.length : 0;
  const avgParagraph = paragraphs.length ? words.length / paragraphs.length : words.length;

  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    avgSentence,
    avgParagraph,
    contractionRate: words.length ? contractions / words.length : 0,
    questionRate: sentences.length ? questions / sentences.length : 0,
    firstPerson: first,
    secondPerson: second,
    numeralRate: words.length ? numerals / words.length : 0,
    emDashRate: sentences.length ? emDashes / sentences.length : 0,
    typeToken: words.length ? unique.size / words.length : 0,
    topWords,
  };
}

export function traitsFromStats(stats: VoiceStats): VoiceTraits {
  const sentence =
    stats.avgSentence < 12 ? "short punches" : stats.avgSentence > 22 ? "long rolling lines" : "mixed, mostly medium";
  const person =
    stats.secondPerson > stats.firstPerson * 1.2
      ? "talks to you"
      : stats.firstPerson > stats.secondPerson * 1.2
        ? "speaks as I/we"
        : "moves between I and you";
  const energy =
    stats.questionRate > 0.12 ? "asks, then answers" : stats.avgSentence < 14 ? "clipped and sure" : "steady, not breathless";
  const diction =
    stats.contractionRate > 0.03
      ? "spoken, contractions on"
      : stats.typeToken > 0.55
        ? "precise, less filler"
        : "plain and concrete";
  return { sentence, person, energy, diction };
}

export function cardFromStats(stats: VoiceStats, traits: VoiceTraits, extras?: string): string {
  const nums = stats.numeralRate > 0.012 ? "Keep numerals, $ and % as digits. Never spell those out." : "Write numbers the way they do. Prefer digits for money and percents if they show up.";
  const dashes = stats.emDashRate < 0.04 ? "No em dashes. Periods, commas, colons." : "Still never use an em dash.";
  const vocab = stats.topWords.length ? `Words they actually reach for: ${stats.topWords.slice(0, 8).join(", ")}.` : "";
  return [
    `Write like this person, not like a model.`,
    `Sentences: ${traits.sentence} (about ${Math.round(stats.avgSentence)} words).`,
    `Person: ${traits.person}.`,
    `Energy: ${traits.energy}.`,
    `Diction: ${traits.diction}.`,
    nums,
    dashes,
    vocab,
    extras?.trim() ?? "",
    `Do not announce the voice. Do not get fancier than they are. Match rhythm first, then vocabulary.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildVoiceProfile(opts: {
  text: string;
  samples: VoiceSample[];
  sourceLabel: string;
  distilled?: string;
}): VoiceProfile {
  const stats = analyzeVoice(opts.text);
  const traits = traitsFromStats(stats);
  const card = (opts.distilled?.trim() || cardFromStats(stats, traits)).trim();
  return {
    updatedAt: Date.now(),
    card,
    traits,
    samples: opts.samples.slice(0, 40),
    wordCount: stats.words,
    sourceLabel: opts.sourceLabel,
  };
}

export function excerptCorpus(text: string, maxChars = 9000) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 40);
  if (!blocks.length) return text.slice(0, maxChars);
  const take = Math.max(1, Math.ceil(blocks.length / 8));
  const picks: string[] = [];
  for (let i = 0; i < blocks.length && picks.join("\n\n").length < maxChars; i += take) {
    picks.push(blocks[i].slice(0, 900));
  }
  return picks.join("\n\n").slice(0, maxChars);
}

export const VOICE_FILE_EXTS = new Set(["pdf", "docx", "txt", "md", "html", "htm", "rtf"]);

export function isVoiceFileName(name: string) {
  const base = name.split("/").pop() ?? name;
  if (base.startsWith(".")) return false;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return VOICE_FILE_EXTS.has(ext);
}

export function skipVoiceDir(name: string) {
  return /^(node_modules|dist|target|\.git|\.next|vendor|__pycache__)$/i.test(name);
}
