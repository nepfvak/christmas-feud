/**
 * Answer matcher: decides which survey answer (if any) a typed guess refers to.
 *
 * Strategy, cheapest first:
 *  1. exact match against any alias after normalisation
 *  2. whole-string fuzzy similarity (handles typos: "pointsettia", "rudolf")
 *  3. token logic: every meaningful word you typed appears in the alias
 *     ("vacation" -> "National Lampoon's Christmas Vacation"), accepted only when it
 *     covers enough of the alias or is unique among all answers to the question.
 *
 * Guesses are matched against the WHOLE survey pool, not just the board, so a guess
 * like "Jingle Bell Rock" can't fuzzily steal "Jingle Bells" if both exist.
 */

export interface MatchCandidate {
  aliases: string[];
}

export interface MatchResult {
  index: number;
  score: number;
}

const NUMBERS: Record<string, string> = {
  "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
  "7": "seven", "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve",
  "34th": "thirtyfourth",
};
const REWRITE: Record<string, string> = {
  xmas: "christmas", st: "saint", mr: "mister", mrs: "missus", ms: "miss", dr: "doctor",
  ol: "old", n: "and", w: "with", choc: "chocolate",
};
const ARTICLES = new Set(["the", "a", "an"]);
const GENERIC = new Set([
  "the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "is", "it", "my", "i", "you", "your", "our",
  "at", "by", "from", "or", "christmas", "holiday", "holidays", "movie", "film", "song", "day", "merry", "some",
  "that", "this", "be", "are", "make", "do", "go", "get", "build", "eat", "play", "xmas",
]);

const NO_STEM = new Set([
  "christmas", "xmas", "always", "texas", "cactus", "bus", "gas", "yes", "this", "his", "its", "was", "does",
  "citrus", "hummus", "crocus", "narcissus", "octopus", "glass", "lens", "chess", "kiss", "dress", "boots",
]);

function stem(t: string): string {
  if (t.length <= 3 || NO_STEM.has(t)) return t;
  // cookie/cookies/cooky and cherry/cherries all collapse to one stem ending in "i"
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -2);
  if (t.endsWith("ie")) return t.slice(0, -1);
  if (/[^aeiou]y$/.test(t)) return t.slice(0, -1) + "i";
  if (/(ches|shes|xes|sses|zzes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) return t.slice(0, -1);
  return t;
}

export function tokenize(raw: string): string[] {
  const s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return [];
  const toks = s
    .split(" ")
    .map((t) => NUMBERS[t] ?? REWRITE[t] ?? t)
    .map(stem);
  while (toks.length > 1 && ARTICLES.has(toks[0])) toks.shift();
  return toks;
}

export function normalize(raw: string): string {
  return tokenize(raw).join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** crude phonetic key so "rudolf" ~ "rudolph", "snickerdoodel" ~ "snickerdoodle" */
const phon = (s: string) => s.replace(/ph/g, "f").replace(/ck/g, "k").replace(/z/g, "s").replace(/(.)\1+/g, "$1");

function rawSim(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}
function similarity(a: string, b: string): number {
  return Math.max(rawSim(a, b), rawSim(phon(a), phon(b)));
}

function tokenEq(a: string, b: string): boolean {
  if (a === b || phon(a) === phon(b)) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  const d = Math.min(levenshtein(a, b), levenshtein(phon(a), phon(b)));
  return len >= 8 ? d <= 2 : d <= 1;
}

const distinctive = (toks: string[]) => toks.filter((t) => !GENERIC.has(t));

/** Score how well `input` refers to one alias, plus whether it was a weak "partial" match. */
function scoreAlias(inToks: string[], alias: string): { score: number; partial: boolean } {
  const alToks = tokenize(alias);
  if (!alToks.length) return { score: 0, partial: false };
  const a = inToks.join(" ");
  const b = alToks.join(" ");
  if (a === b) return { score: 1, partial: false };
  // squash spaces so "egg nog" == "eggnog", "snow man" == "snowman"
  if (a.replace(/ /g, "") === b.replace(/ /g, "")) return { score: 0.98, partial: false };

  let best = 0;
  const sim = Math.max(similarity(a, b), similarity(a.replace(/ /g, ""), b.replace(/ /g, "")));
  if (sim >= 0.8 && Math.min(a.length, b.length) >= 4) best = 0.6 + sim * 0.35;

  const dIn = distinctive(inToks);
  const dAl = distinctive(alToks);
  if (dIn.length && dAl.length) {
    // "make a snow man" vs "build a snowman": same meaningful letters once spaces go
    if (dIn.join("") === dAl.join("")) best = Math.max(best, 0.9);
    const inAllFound = dIn.every((t) => dAl.some((u) => tokenEq(t, u)));
    if (inAllFound) {
      const covered = dAl.filter((u) => dIn.some((t) => tokenEq(t, u))).length / dAl.length;
      if (covered >= 0.5) best = Math.max(best, 0.7 + 0.2 * covered);
      else if (dIn.join("").length >= 4) return { score: Math.max(best, 0.6), partial: best < 0.6 };
    }
    // the alias is fully contained in a longer guess ("build a big snowman")
    const alAllFound = dAl.every((u) => dIn.some((t) => tokenEq(t, u)));
    if (alAllFound && dIn.length <= dAl.length + 2) best = Math.max(best, 0.74);
  }
  return { score: best, partial: false };
}

export function matchAnswer(input: string, candidates: MatchCandidate[]): MatchResult | null {
  const inToks = tokenize(input);
  if (!inToks.length || inToks.join("").length < 2) return null;

  const strong: MatchResult[] = [];
  const partial: MatchResult[] = [];
  candidates.forEach((cand, index) => {
    let bestStrong = 0;
    let bestPartial = 0;
    for (const alias of cand.aliases) {
      const r = scoreAlias(inToks, alias);
      if (r.partial) bestPartial = Math.max(bestPartial, r.score);
      else bestStrong = Math.max(bestStrong, r.score);
    }
    if (bestStrong > 0) strong.push({ index, score: bestStrong });
    else if (bestPartial > 0) partial.push({ index, score: bestPartial });
  });

  if (strong.length) {
    // highest score wins; ties go to the higher-ranked (lower index) answer
    strong.sort((x, y) => y.score - x.score || x.index - y.index);
    return strong[0];
  }
  // A single loose keyword ("vacation") only counts if it points at exactly one answer.
  if (partial.length === 1) return partial[0];
  return null;
}
