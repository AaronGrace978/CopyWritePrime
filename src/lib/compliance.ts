export type GuardSeverity = "block" | "warn";

export interface GuardHit {
  phrase: string;
  instead: string;
  severity: GuardSeverity;
  index: number;
}

export interface GuardRule {
  phrase: string;
  instead: string;
  severity: GuardSeverity;
}

export const SUPERPOWER_NEVER: GuardRule[] = [
  { phrase: "prevent disease", instead: '"Detect early signs" / "Optimize health" / "May help support"', severity: "block" },
  { phrase: "cure", instead: '"Detect early signs" / "Optimize health" / "May help support"', severity: "block" },
  { phrase: "treat", instead: '"Detect early signs" / "Optimize health" / "May help support"', severity: "block" },
  { phrase: "diagnose", instead: '"Detect early signs" / "Optimize health" / "May help support"', severity: "block" },
  { phrase: "diagnosis", instead: '"picture" / "results" / "what\'s going on"', severity: "block" },
  { phrase: "fix", instead: '"Detect early signs" / "Optimize health" / "May help support"', severity: "warn" },
  { phrase: "lab test", instead: '"Biomarker" / "100+ biomarkers"', severity: "block" },
  { phrase: "lab tests", instead: '"Biomarker" / "100+ biomarkers"', severity: "block" },
  { phrase: "100+ lab tests", instead: '"100+ biomarkers"', severity: "block" },
  { phrase: "clinical team", instead: '"Care team"', severity: "block" },
  { phrase: "medical team", instead: '"Care team"', severity: "block" },
  { phrase: "24/7 access to clinicians", instead: '"On-demand access"', severity: "block" },
  { phrase: "year-round access", instead: '"On-demand access"', severity: "block" },
  { phrase: "ai doctor", instead: '"AI Concierge"', severity: "block" },
  { phrase: "ai dr.", instead: '"AI Concierge"', severity: "block" },
  { phrase: "ai dr", instead: '"AI Concierge"', severity: "block" },
  { phrase: "protocols created by clinicians", instead: '"Personalized protocols"', severity: "block" },
  { phrase: "harvard", instead: "Do not cite Harvard/UCLA MDs as protocol authors", severity: "block" },
  { phrase: "ucla md", instead: "Do not cite Harvard/UCLA MDs as protocol authors", severity: "block" },
  { phrase: "150,000 members", instead: '"Thousands of members"', severity: "block" },
  { phrase: "20% cashback", instead: '"20% off MSRP" / "Save up to 20% off supplements"', severity: "block" },
  { phrase: "function health", instead: "Do not name competitors in paid/landing copy", severity: "block" },
  { phrase: "inside tracker", instead: "Do not name competitors in paid/landing copy", severity: "block" },
  { phrase: "insidetracker", instead: "Do not name competitors in paid/landing copy", severity: "block" },
  { phrase: "mito health", instead: "Do not name competitors in paid/landing copy", severity: "block" },
  { phrase: "unlock your health potential", instead: "Write like a human. Be specific.", severity: "warn" },
];

export const SUPERPOWER_STATS = [
  "93% of members rated their Superpower Health Action Plan as more useful or even life-changing compared to their yearly checkup",
  "60% of members said Superpower identified something previously missed or overlooked by a doctor",
  "77% of members found something new or interesting in their results or action plan",
  "82% of members implemented recommendations from their Action Plan",
  "85% of members reported improved energy",
  "79% of members reported improved mental focus",
  "75% of members reported improved sleep",
  "34.3% improvement in Superpower score from first to second blood draw",
  "36.3% of members reduced their biological age score between first and second blood draw",
];

export const SUPERPOWER_ANCHORS = [
  "100+ biomarkers in 1 blood draw (120+ available with add-ons)",
  "17 health scores on the dashboard",
  "2,000+ lab locations in 39 states",
  "Early detection capabilities for 1,000+ conditions",
  "HSA/FSA eligible",
  '"Thousands of members" (we don\'t disclose exact counts)',
  "On-demand access to a care team",
  "Personalized protocols",
  "Results in 5-10 business days",
  'Approved tagline: "Most companies stop at testing. We go further."',
];

export const SUPERPOWER_SYSTEM = `You are writing Superpower copy. Health is regulated. Punchy because of the rails, not despite them.

NEVER SAY (auto-reject): prevent disease, cure, treat, diagnose, fix; "lab test" / "100+ lab tests" (say biomarker / 100+ biomarkers); clinical team / medical team (say care team); 24/7 access to clinicians / year-round access (say on-demand access); AI Doctor / AI Dr. (say AI Concierge); protocols created by clinicians / Harvard or UCLA MDs (say personalized protocols); specific member counts (say thousands of members); 20% cashback; paraphrased testimonials; made-up stats; competitor names (Function, Mito, InsideTracker) in landing/paid copy.

USE EXACT STAT WORDING from the approved bank when using numbers. Lead with an emotional trigger, then the stat as support.

Approved tagline, verbatim: Most companies stop at testing. We go further.

Offer: $349/year Superpower membership. 100+ biomarkers. Two blood draws per year. Personalized health insights and recommendations. On-demand access to a care team. A centralized view of their health data. HSA/FSA eligible.

Voice: a human wrote this for another human. Specificity over vibe. Not "unlock your health potential."`;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanCompliance(text: string): GuardHit[] {
  const hits: GuardHit[] = [];
  const lower = text.toLowerCase();
  for (const rule of SUPERPOWER_NEVER) {
    const needle = rule.phrase.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      const before = index === 0 ? " " : lower[index - 1];
      const after = lower[index + needle.length] ?? " ";
      const bounded = !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
      if (bounded || needle.includes(" ") || needle.includes("/") || needle.includes("%")) {
        hits.push({
          phrase: text.slice(index, index + needle.length),
          instead: rule.instead,
          severity: rule.severity,
          index,
        });
      }
      from = index + needle.length;
    }
  }

  const memberCount = /\b\d{1,3},\d{3}\s+members\b/gi;
  let m: RegExpExecArray | null;
  while ((m = memberCount.exec(text))) {
    hits.push({
      phrase: m[0],
      instead: '"Thousands of members"',
      severity: "block",
      index: m.index,
    });
  }

  const percentish = /\b\d{1,3}(?:\.\d+)?%\b/g;
  while ((m = percentish.exec(text))) {
    const window = text.slice(Math.max(0, m.index - 80), m.index + 120);
    const exact = SUPERPOWER_STATS.some((s) => s.includes(m![0]));
    if (!exact && /member|sleep|energy|focus|score|biological age|action plan/i.test(window)) {
      hits.push({
        phrase: m[0] + " (stat not in approved bank)",
        instead: "Use the approved stat bank verbatim, or drop the number.",
        severity: "warn",
        index: m.index,
      });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export function highlightQuery(rules: GuardRule[]) {
  return new RegExp(
    rules
      .map((r) => escapeRe(r.phrase))
      .sort((a, b) => b.length - a.length)
      .join("|"),
    "gi",
  );
}
