import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, "..", "assessment", "Aaron-Grace-Superpower-Copywriter-Assessment.docx");

const run = (text, opts = {}) =>
  new TextRun({ text, font: "Calibri", size: 22, ...opts });

const p = (text, extra = {}) =>
  new Paragraph({ spacing: { after: 160 }, ...extra, children: [run(text, extra.run)] });

const h = (text, level = HeadingLevel.HEADING_1) =>
  new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [run(text, { bold: true, size: level === HeadingLevel.TITLE ? 48 : 28 })],
  });

const doc = new Document({
  sections: [
    {
      children: [
        h("You’re fine. That’s the problem.", HeadingLevel.TITLE),
        p("Aaron Grace · Superpower Copywriter Assessment · Campaign for “Your annual physical isn’t enough.” · $349/year · 100+ biomarkers · two blood draws", { run: { italics: true, size: 20 } }),

        h("Part 1 — The Rationale"),
        p("150 words max. One direction.", { run: { italics: true, size: 20 } }),
        p("The annual physical is a pass/fail exam for people who already passed. Our audience isn’t sick. They’re health-conscious adults 35+ who eat well, train, take the supplements, and still walk out with the same sentence: you’re fine. Fine is a relief. Fine is also a dead end. It answers the only question the physical is built to ask — is something clinically wrong — and leaves the more useful question untouched: what’s actually happening in my body, and what do I do next? That’s the tension. Not fear. Not biohacking. The gap between feeling healthy and having a picture. Superpower doesn’t compete with the physical. It finishes the sentence the physical starts."),

        h("Part 2 — The Narrative"),
        p("You already do the work. You eat like you mean it, you train, you show up for the physical, and they tell you you’re fine. Months later you’re still guessing at the tiredness, still stacking supplements, still using a shrug like a plan. Superpower measures 100+ biomarkers in one blood draw, twice a year, then gives you a Superpower Health Action Plan and on-demand access to a care team. 60% of members said Superpower identified something previously missed or overlooked by a doctor — not because someone failed, but because a handful of markers was never a picture. Most companies stop at testing. We go further."),

        h("Part 3 — Bring it to life"),
        h("Campaign headlines", HeadingLevel.HEADING_2),
        p("1. You’re fine. That’s the problem."),
        p("2. Fine isn’t a picture."),
        p("3. Your physical asked if something was wrong. You still don’t know what’s going on."),
        p("Endline, verbatim: Most companies stop at testing. We go further."),

        h("Brand film — 45 seconds", HeadingLevel.HEADING_2),
        p("Open. Fluorescent exam room. Paper gown. The cuff inflates. A doctor, warm and automatic: “You’re fine.” Handshake. Parking lot."),
        p("Life continues. Gym at 6. Groceries. A 3pm crash at the desk. A cabinet of supplements that never quite adds up."),
        p("VO. You’re fine is what they say when they only came to see if something was clinically wrong."),
        p("Cut. One blood draw. Then 100+ biomarkers filling a dashboard. 17 health scores. A plan, not a shrug."),
        p("VO. Superpower measures 100+ biomarkers. Twice a year. A Superpower Health Action Plan. On-demand access to a care team."),
        p("Super, exact wording: 60% of members said Superpower identified something previously missed or overlooked by a doctor."),
        p("VO. Most companies stop at testing. We go further."),
        p("Lockup. YOU’RE FINE. That’s the problem. Superpower. $349/year."),
        p("CTA. Get 100+ biomarkers tested for $349"),

        h("Landing page", HeadingLevel.HEADING_2),
        p("H1. You’re fine. That’s the problem."),
        p("Subhead. Your annual physical was built to catch what’s already wrong. Superpower measures 100+ biomarkers — twice a year — and gives you a plan for what to do next. $349."),
        p("CTA. Get 100+ biomarkers tested for $349"),
        p("Section 1 — What “fine” actually checked. A standard physical answers one question: is something clinically wrong. Superpower is for people who already passed that test and still want the rest of the picture. 100+ biomarkers in one blood draw. 17 health scores on the dashboard. Results in 5–10 business days. 2,000+ lab locations in 39 states."),
        p("Section 2 — Then you do something with it. 93% of members rated their Superpower Health Action Plan as more useful or even life-changing compared to their yearly checkup. On-demand access to a care team. Personalized protocols. Two blood draws a year. HSA/FSA eligible. What could cost $15,000 elsewhere is $349."),
        p("Cuts I made on purpose: marketplace, peptides, GRAIL, AI Concierge, biological age. This campaign has one job. Those belong to the next click, not the first sentence.", { run: { italics: true } }),

        h("Performance — 5 paid social hooks", HeadingLevel.HEADING_2),
        p("1. Hook: Your physical said you were fine. How many markers did they actually look at? Body: Superpower measures 100+ biomarkers in one blood draw, twice a year. $349. CTA: Get 100+ biomarkers tested for $349"),
        p("2. Hook: Sleeping 8 hours and still feeling tired? Body: 75% of members reported improved sleep. CTA: Get 100+ biomarkers tested for $349"),
        p("3. Hook: You eat well. You train. You still don’t have the numbers. Body: 100+ biomarkers. Two blood draws a year. A Superpower Health Action Plan. CTA: Start with a blood draw"),
        p("4. Hook: Your doctor didn’t miss it. The physical just wasn’t looking that far. Body: 60% of members said Superpower identified something previously missed or overlooked by a doctor. CTA: Get 100+ biomarkers tested for $349"),
        p("5. Hook: $349 a year. 100+ biomarkers. Two blood draws. A plan. Body: 77% of members found something new or interesting in their results or action plan. HSA/FSA eligible. CTA: Get 100+ biomarkers tested for $349"),

        h("Short-form video — 22 seconds", HeadingLevel.HEADING_2),
        p("[Kitchen, morning, to camera] I left my physical proud. She said I was fine. Then I was still tired. Still guessing. Still calling a handful of markers a plan. Superpower is 100+ biomarkers. Twice a year. $349. 60% of members said Superpower identified something previously missed or overlooked by a doctor. Most companies stop at testing. We go further. [End card] Get 100+ biomarkers tested for $349"),

        h("Part 4 — Challenge the brief"),
        p("I’d keep the territory. I’d change the enemy. “Your annual physical isn’t enough” can read as “your doctor isn’t enough,” which makes this audience defend the one relationship they already trust. The sharper fight is with the question the physical asks: pass/fail versus a picture. Punch “fine,” not the physician. I’d also lock $349 and two blood draws in every performance unit — mixed pricing will leak into comments and kill the offer. Don’t name competitors. Specificity is the ad."),

        h("Guardrail pass"),
        p("No disease-prevention, curing, treating, diagnosing, or health-fixing claims. Biomarkers, never the banned testing phrasing. Care team, never the clinical/medical variants. On-demand, never round-the-clock clinician access. Stats copied verbatim from the approved bank. No paraphrased testimonials. No member census. Comparative without naming anyone in the category. Puffery used only as the approved tagline."),
      ],
    },
  ],
});

mkdirSync(dirname(out), { recursive: true });
const buf = await Packer.toBuffer(doc);
writeFileSync(out, buf);
console.log("wrote", out);
