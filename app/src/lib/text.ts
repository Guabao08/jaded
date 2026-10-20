/** Removes control characters (keeps tab and newlines), trims and caps length. */
export function cleanText(value: unknown, limit: number): string {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 || code === 9 || code === 10 || code === 13) out += ch;
  }
  return out.trim().slice(0, limit);
}
