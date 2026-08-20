const EM = /[\u2014\u2015\u2E3A\u2E3B]/;

export function hasEmDash(text: string): boolean {
  return EM.test(text) || /(?:^|[^\s-])\s*--\s*(?:[^\s-]|$)/.test(text) || /\S\s+\u2013\s+\S/.test(text);
}

export function killEmDashes(text: string): string {
  let out = text.replace(/[ \t]*[\u2014\u2015\u2E3A\u2E3B][ \t]*/g, (_match, offset: number) => {
    const before = text.slice(0, offset).replace(/[ \t]+$/, "");
    const after = text.slice(offset + _match.length).replace(/^[ \t]+/, "");
    const left = (before.split("\n").pop() ?? "").trim();
    if (/\b(?:part|section|chapter)\s+\d+$/i.test(left)) return ": ";
    if (/^[A-ZÀ-ÖØ-Þ]/.test(after) || /^[“"‘']/.test(after)) return ". ";
    if (!after) return "";
    return ", ";
  });
  out = out.replace(/([^\s-])[ \t]*--[ \t]*(?=[^\s-])/g, (m, a: string, offset: number) => {
    const after = out.slice(offset + m.length);
    return /^[A-ZÀ-ÖØ-Þ“"‘']/.test(after) ? `${a}. ` : `${a}, `;
  });
  out = out.replace(/(\S)[ \t]+\u2013[ \t]+(?=\S)/g, (m, a: string, offset: number) => {
    const after = out.slice(offset + m.length);
    return /^[A-ZÀ-ÖØ-Þ“"‘']/.test(after) ? `${a}. ` : `${a}, `;
  });
  return out;
}
