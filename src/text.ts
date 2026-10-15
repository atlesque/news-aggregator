// Small text helpers shared by the feed parser, the pipeline and the API formats.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", euro: "€", eacute: "é",
  egrave: "è", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", agrave: "à", ccedil: "ç", ecirc: "ê",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Strips tags and entities and collapses whitespace. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = /\s/.test(s[max - 1]) ? cut.length : cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "") + "…";
}

/** Folds text to printable ASCII for displays whose fonts have no accents (e-ink, LCD). */
export function asciiFold(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR")
    .replace(/ß/g, "ss")
    .replace(/[æÆ]/g, (c) => (c === "æ" ? "ae" : "AE"))
    .replace(/[øØ]/g, (c) => (c === "ø" ? "o" : "O"))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "");
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Removes tracking parameters and fragments so the same article always hashes the same. */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|at_|fbclid|gclid|ref$|ref_|xtor|ito$|cmpid)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/** Lowercased words of 3+ letters, accents removed: the key for cheap exact-duplicate checks. */
export function titleKey(title: string): string {
  return asciiFold(title.toLowerCase())
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .join(" ");
}

export function matchesAny(text: string, keywords: string[]): boolean {
  const hay = text.toLowerCase();
  return keywords.some((k) => k.trim() && hay.includes(k.trim().toLowerCase()));
}

const LANG_WORDS: Record<string, Set<string>> = {
  nl: new Set("de het een van en in op is voor met na bij naar niet zijn wordt worden door dat die er ook nog over uit tegen".split(" ")),
  en: new Set("the a an of and to in on is for with after at by from are be was were has have that this over into against".split(" ")),
  fr: new Set("le la les des et du est pour avec dans sur une un au aux par pas qui que se".split(" ")),
  de: new Set("der die das und ist mit von für auf nicht ein eine im den dem zu bei nach".split(" ")),
};

/** Guesses the language of a headline + summary from common function words. Null when unsure. */
export function detectLang(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const scores = Object.entries(LANG_WORDS)
    .map(([lang, set]) => [lang, words.filter((w) => set.has(w)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 2 && best[1] >= second[1] * 2 ? best[0] : null;
}
