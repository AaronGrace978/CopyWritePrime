import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, "..", "assessment", "Aaron-Grace-Superpower-Copywriter-Assessment-SUBMIT.docx");

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
        p("Aaron Grace · Superpower Copywriter Assessment · Territory: “Your annual physical isn’t enough.”", { run: { italics: true, size: 20 } }),

        h("Part 1 — The Rationale"),
        p("The annual physical is a pass/fail exam for people who already passed. This audience isn’t sick. They’re 35 and up. They eat well, they train, they take the supplements, they show up for the checkup. Then they get the same sentence: you’re fine. Fine feels like a win. Fine is also where the useful conversation stops. The physical only asks if something is clinically wrong. It never answers the question they actually walked in with: what’s going on in my body, and what do I do next? That’s the tension. Not fear. Not biohacking. The gap between feeling healthy and having a picture. Superpower isn’t fighting the doctor. It finishes the sentence the physical starts."),

        h("Part 2 — The Narrative"),
        p("You already do the work. You eat like you mean it, you train, you show up for the physical, and they tell you you’re fine. You leave feeling responsible — and still without a picture of what’s happening under that all-clear. Superpower tests 100+ biomarkers in one blood draw, twice a year, then gives you a Superpower Health Action Plan and on-demand access to a care team. 60% of members said Superpower identified something previously missed or overlooked by a doctor — not because someone failed, but because 10–15 markers was never a picture. Most companies stop at testing. We go further."),

        h("Part 3 — Bring it to life"),

        h("Campaign headlines", HeadingLevel.HEADING_2),
        p("1. You’re fine. That’s the problem."),
        p("2. Your physical asked if something was wrong. You still don’t know what’s going on."),
        p("3. Your physical checked 10–15 markers. Superpower checks 100+."),
        p("Most companies stop at testing. We go further."),

        h("Brand film — 45 seconds", HeadingLevel.HEADING_2),
        p("Open. Fluorescent exam room. Paper gown. The cuff inflates. A doctor, warm and automatic: “You’re fine.” Handshake. Parking lot. She folds a short printout like a receipt."),
        p("Life. Gym at 6. Real groceries. The cabinet of supplements. None of it looks like a person in trouble. It looks like a person who already did the work."),
        p("VO. “You’re fine” is what they say when they only came to see if something was clinically wrong."),
        p("Turn. One blood draw. Then a dashboard filling in: 100+ biomarkers. 17 health scores. Heart. Hormones. Thyroid. Inflammation. A plan, not a shrug."),
        p("VO. Superpower tests 100+ biomarkers. Twice a year. A Superpower Health Action Plan. On-demand access to a care team."),
        p("Super. 60% of members said Superpower identified something previously missed or overlooked by a doctor."),
        p("Close. Same kitchen. She’s reading the plan, not the all-clear. VO: I didn’t need another all-clear. I needed to know what was going on. VO: Most companies stop at testing. We go further."),
        p("Lockup. YOU’RE FINE. That’s the problem. Superpower. $349/year. HSA/FSA eligible. Get 100+ biomarkers tested for $349"),

        h("Landing page", HeadingLevel.HEADING_2),
        p("H1. You’re fine. That’s the problem."),
        p("Subhead. Your annual physical was built to find what’s already wrong. Superpower tests 100+ biomarkers, twice a year, and gives you a plan for what to do next. $349/year. HSA/FSA eligible."),
        p("CTA. Get 100+ biomarkers tested for $349"),
        p("Section 1 — What “fine” actually checked"),
        p("A standard physical looks at 10–15 markers and asks one question: is something clinically wrong."),
        p("If you already eat well, train, and got the all-clear, that question is answered. The useful one isn’t: what’s happening under the all-clear."),
        p("Superpower tests 100+ biomarkers in one blood draw — heart, hormones, thyroid, metabolic health, nutrients, inflammation — then puts it on a dashboard with 17 health scores. Book at 2,000+ lab locations in 39 states. Results in 5–10 business days."),
        p("This isn’t a replacement for your physical. It’s the rest of the picture."),
        p("Section 2 — Then you do something with it"),
        p("Your yearly checkup told you you were fine. Then what?"),
        p("93% of members rated their Superpower Health Action Plan as more useful or even life-changing compared to their yearly checkup."),
        p("You get personalized protocols, on-demand access to a care team, and a second draw so you’re not making a year of decisions off one snapshot. What could cost $15,000 elsewhere is $349. HSA/FSA eligible."),
        p("Most companies stop at testing. We go further."),
        p("Cuts: marketplace, biological age, 1,000+ conditions, energy/sleep/focus, AI Concierge. This page has one job.", { run: { italics: true } }),

        h("Paid social", HeadingLevel.HEADING_2),
        p("1. Your physical said you were fine. How many markers did they actually look at? Superpower tests 100+ biomarkers in one blood draw, twice a year. $349. Get 100+ biomarkers tested for $349"),
        p("2. If your last physical checked 100+ biomarkers, keep scrolling. It didn’t. Superpower does. Twice a year. $349. HSA/FSA eligible. Get 100+ biomarkers tested for $349"),
        p("3. You eat well. You train. You still don’t have the numbers. 100+ biomarkers. Two blood draws a year. A Superpower Health Action Plan. Get 100+ biomarkers tested for $349"),
        p("4. Your doctor didn’t miss it. The physical just wasn’t looking that far. 60% of members said Superpower identified something previously missed or overlooked by a doctor. Get 100+ biomarkers tested for $349"),
        p("5. Your yearly checkup told you you were fine. Then what? 93% of members rated their Superpower Health Action Plan as more useful or even life-changing compared to their yearly checkup. Get 100+ biomarkers tested for $349"),

        h("Short-form video — 18 seconds", HeadingLevel.HEADING_2),
        p("[To camera. Car, after the appointment. Printout on the passenger seat.]"),
        p("She said I was fine."),
        p("[Beat. Holds up the short printout.]"),
        p("That was maybe 15 markers."),
        p("I wanted the rest of the picture."),
        p("Superpower. 100+ biomarkers. Twice a year. $349."),
        p("Most companies stop at testing. We go further."),
        p("[End card] Get 100+ biomarkers tested for $349"),

        h("Part 4 — Challenge the brief"),
        p("I’d keep the territory. I’d change the enemy. “Your annual physical isn’t enough” can read as “your doctor isn’t enough,” which makes this audience defend the one relationship they already trust. The sharper fight is the question the physical asks: pass/fail versus a picture. Punch “fine,” not the physician. Lead proof with the 93% Action Plan vs. checkup stat — it is the territory, in a number. Lock $349 and two blood draws in every performance unit."),
      ],
    },
  ],
});

mkdirSync(dirname(out), { recursive: true });
const buf = await Packer.toBuffer(doc);
writeFileSync(out, buf);
console.log("wrote", out);
