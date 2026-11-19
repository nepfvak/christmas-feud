/**
 * Builds data/questions.json from data/question-bank.ts using real, public APIs:
 *
 *  1. MediaWiki Action API  - resolves each Wikipedia title (following redirects)
 *                             and finds its Wikidata item id.
 *  2. Wikimedia Pageviews   - how many humans (agent=user, bots excluded) viewed each
 *                             article during December of each sample year.
 *  3. Wikidata              - English labels + aliases, used as extra accepted
 *                             spellings by the answer matcher.
 *
 * Turning pageviews into "survey points":
 *   For each candidate we measure December views and the "holiday bump": December
 *   views minus that article's typical month (median Feb-Oct), averaged over the
 *   sample years. The ranking signal is the geometric mean of the two, so an answer
 *   has to be both well known and seasonal to rank high.
 *   A real survey asks 100 people for ONE answer each, which flattens extremes
 *   compared to raw web traffic, so we apply a documented damping exponent
 *   (SURVEY_ALPHA) and then share 100 "people" out: the top 8 answers split 92,
 *   the long tail splits the remaining 8. Raw view counts are kept in the output.
 *
 * Run:  npm run questions            (uses .cache for API responses)
 *       npm run questions -- --fresh (ignores the cache)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { QUESTION_BANK } from "../data/question-bank";

const YEARS = [2023, 2024, 2025];
// Calibrated so boards feel like the show: 7-answer boards sum to ~88 and two players
// who both name top-2 answers in the Snowball Sprint land just over 200.
const SURVEY_ALPHA = Number(process.env.SURVEY_ALPHA ?? 0.8);
/** 0 = rank purely by everyday commonness, 1 = purely by the holiday bump; 0.5 = needs both */
const HOLIDAY_WEIGHT = Number(process.env.HOLIDAY_WEIGHT ?? 0.55);
/** the top TOP_K answers share TOP_SHARE of the 100 "people"; the tail shares the rest */
const TOP_K = 8;
const TOP_SHARE = 92;
const UA = "SleighSaysQuestionBuilder/1.0 (educational holiday game; non-commercial)";
const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE_DIR = path.join(ROOT, ".cache");
const FRESH = process.argv.includes("--fresh");

await mkdir(CACHE_DIR, { recursive: true });

async function cachedJson(key: string, url: string): Promise<any> {
  const file = path.join(CACHE_DIR, key.slice(0, 4) + "_" + createHash("sha1").update(key).digest("hex") + ".json");
  if (!FRESH && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 404) {
      await writeFile(file, "null");
      return null;
    }
    if (res.ok) {
      const json = await res.json();
      await writeFile(file, JSON.stringify(json));
      return json;
    }
    console.warn(`  retry ${res.status} ${url.slice(0, 90)}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) ** 2));
  }
  throw new Error(`Failed: ${url}`);
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------- 1. Resolve titles ----------
const allTitles = [...new Set(QUESTION_BANK.flatMap((q) => q.candidates.flatMap((c) => c.articles)))];
const resolved = new Map<string, { title: string; qid?: string } | null>();

for (const group of chunk(allTitles, 50)) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=" +
    encodeURIComponent(group.join("|"));
  const data = await cachedJson("resolve_" + group.join("|"), url);
  const norm = new Map<string, string>();
  for (const n of data.query.normalized ?? []) norm.set(n.from, n.to);
  const redir = new Map<string, string>();
  for (const r of data.query.redirects ?? []) redir.set(r.from, r.to);
  const pages = new Map<string, any>();
  for (const p of data.query.pages) pages.set(p.title, p);
  for (const t of group) {
    let cur = norm.get(t) ?? t;
    cur = redir.get(cur) ?? cur;
    const page = pages.get(cur);
    if (!page || page.missing || page.invalid) resolved.set(t, null);
    else resolved.set(t, { title: page.title, qid: page.pageprops?.wikibase_item });
  }
}

const missing = allTitles.filter((t) => !resolved.get(t));
if (missing.length) console.warn(`\n⚠  ${missing.length} Wikipedia titles not found (they'll score 0):\n   - ${missing.join("\n   - ")}\n`);

// ---------- 2. Pageviews (every month of the sample years) ----------
const canonical = [...new Set([...resolved.values()].filter(Boolean).map((r) => r!.title))];
/** title -> "YYYYMM" -> views */
const monthly = new Map<string, Record<string, number>>();
await pool(canonical, 3, async (title) => {
  const art = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${art}/monthly/${YEARS[0]}010100/${YEARS.at(-1)}123100`;
  const data = await cachedJson("pvm_" + title + YEARS.join("-"), url);
  const m: Record<string, number> = {};
  for (const item of data?.items ?? []) m[String(item.timestamp).slice(0, 6)] = item.views;
  monthly.set(title, m);
});

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * Holiday attention for one article, averaged over the sample years:
 *   excess = December views - typical month (median of Feb..Oct, robust to one-off spikes)
 * Floored at 5% of December views so evergreen answers (coffee, pine...) still count a little.
 */
function holidayAttention(title: string): { dec: number; excess: number } {
  const r = resolved.get(title);
  if (!r) return { dec: 0, excess: 0 };
  const m = monthly.get(r.title) ?? {};
  const decs: number[] = [];
  const excesses: number[] = [];
  for (const y of YEARS) {
    const dec = m[`${y}12`];
    if (dec === undefined) continue;
    const typical = ["02", "03", "04", "05", "06", "07", "08", "09", "10"].map((mm) => m[`${y}${mm}`]).filter((v): v is number => v !== undefined);
    const base = typical.length >= 3 ? median(typical) : 0;
    decs.push(dec);
    excesses.push(Math.max(dec - base, dec * 0.05));
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return { dec: avg(decs), excess: avg(excesses) };
}

// ---------- 3. Wikidata aliases ----------
const qids = [...new Set([...resolved.values()].filter((r) => r?.qid).map((r) => r!.qid!))];
const aliasesByQid = new Map<string, string[]>();
for (const group of chunk(qids, 50)) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases&languages=en&ids=${group.join("|")}`;
  const data = await cachedJson("wd_" + group.join("|"), url);
  for (const [id, ent] of Object.entries<any>(data.entities ?? {})) {
    const list = [ent.labels?.en?.value, ...(ent.aliases?.en ?? []).map((a: any) => a.value)].filter(Boolean);
    aliasesByQid.set(id, list);
  }
}

// Wikidata aliases can be noisy (abbreviations, other-language titles); keep sensible ones.
function cleanAliases(list: string[]): string[] {
  return list
    .map((a) => a.replace(/\s*\([^)]*\)\s*/g, " ").trim())
    .filter((a) => a.length >= 3 && a.length <= 60 && /[a-z]/i.test(a) && !/^[A-Z0-9.\-]{2,5}$/.test(a) && !/[Ѐ-￿]/.test(a));
}

// ---------- 4. Everyday-English commonness (Datamuse / Google Books Ngram) ----------
// Wikipedia lookups measure curiosity (people look up eggnog because they're unsure
// what it is). A survey measures what people SAY, which tracks how common a word is
// in everyday English. Datamuse returns frequency per million words from Google Books.
const termsFor = (c: { label: string; term?: string }) =>
  (c.term ? [c.term] : c.label.split(" / ")).map((t) => t.toLowerCase().replace(/^(the|a|an) /, "").replace(/[!?.]/g, "").trim());
const allTerms = [...new Set(QUESTION_BANK.flatMap((q) => q.candidates.flatMap(termsFor)))];
const freq = new Map<string, number>();
await pool(allTerms, 4, async (term) => {
  const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(term)}&md=f&max=1`;
  const data = await cachedJson("dm_" + term, url);
  // Datamuse may answer with the singular ("snow angel" for "snow angels"): accept close forms only
  const close = (w: string) => w === term || ((term.startsWith(w) || w.startsWith(term)) && Math.abs(w.length - term.length) <= 2);
  const hit = Array.isArray(data) && data[0] && close(data[0].word) ? data[0] : null;
  const tag = hit?.tags?.find((t: string) => t.startsWith("f:"));
  freq.set(term, tag ? Number(tag.slice(2)) : 0);
});
const unknownTerms = allTerms.filter((t) => !freq.get(t));
if (unknownTerms.length) console.warn(`⚠  ${unknownTerms.length} terms unknown to Datamuse (give them a "term"): ${unknownTerms.join(", ")}`);
/** floor so a phrase Datamuse doesn't know isn't zeroed out entirely */
const commonness = (c: { label: string; term?: string }) => Math.max(0.02, ...termsFor(c).map((t) => freq.get(t) ?? 0));

// Redirect sanity check: "Ho ho ho" silently redirects to "Santa Claus" and would
// inherit all of Santa's traffic. Warn when an article lands somewhere unrelated.
for (const q of QUESTION_BANK) {
  for (const c of q.candidates) {
    for (const t of c.articles) {
      const r = resolved.get(t);
      if (!r || r.title === t) continue;
      const words = (x: string) => x.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
      const overlap = words(r.title).some((w) => words(c.label + " " + t).some((v) => v.startsWith(w.slice(0, 5)) || w.startsWith(v.slice(0, 5))));
      if (!overlap) console.warn(`⚠  [${q.id}] "${c.label}": "${t}" redirects to "${r.title}" - check this is right`);
    }
  }
}

// ---------- 5. Score ----------
interface OutAnswer {
  label: string;
  points: number;
  /** average December pageviews */
  views: number;
  /** average extra December pageviews vs. a typical month (holiday signal) */
  excess: number;
  /** Datamuse frequency per million words (commonness signal) */
  frequency: number;
  aliases: string[];
  articles: string[];
}

const questions = QUESTION_BANK.map((q) => {
  const scored = q.candidates.map((c) => {
    const att = c.articles.map(holidayAttention);
    const v = Math.round(att.reduce((s, a) => s + a.dec, 0));
    const ex = Math.round(att.reduce((s, a) => s + a.excess, 0));
    const wd = c.articles.flatMap((t) => {
      const qid = resolved.get(t)?.qid;
      return qid ? cleanAliases(aliasesByQid.get(qid) ?? []) : [];
    });
    const aliases = [...new Set([c.label, ...c.label.split(" / "), ...(c.aliases ?? []), ...wd].map((s) => s.trim()).filter(Boolean))];
    return { label: c.label, views: v, excess: ex, common: commonness(c), aliases, articles: c.articles.map((t) => resolved.get(t)?.title ?? t) };
  });
  // A good survey answer is BOTH a word people commonly use (Datamuse) AND tied to the
  // holidays (Wikipedia December bump). The weighted geometric mean needs both:
  // "Krampus" (seasonal but rare) and "Rain" (common but not seasonal) both sink.
  // Titles (movies, songs, toys) use Wikipedia popularity instead: word frequency is
  // meaningless for a name like "Frozen" or "Monopoly".
  const isTitle = q.kind === "title";
  const blend = (x: { views: number; excess: number; common: number }) =>
    isTitle
      ? Math.pow(Math.max(x.views, 1), 0.5) * Math.pow(Math.max(x.excess, 1), 0.5)
      : Math.pow(x.common, 1 - HOLIDAY_WEIGHT) * Math.pow(Math.max(x.excess, 1), HOLIDAY_WEIGHT);
  scored.sort((a, b) => blend(b) - blend(a));
  const weights = scored.map((s) => Math.pow(blend(s), SURVEY_ALPHA));
  // Like a real 100-person survey: the top answers take most of the responses and a
  // long tail of "other" answers shares the rest.
  const headW = weights.slice(0, TOP_K).reduce((a, b) => a + b, 0) || 1;
  const tailW = weights.slice(TOP_K).reduce((a, b) => a + b, 0) || 1;
  const answers: OutAnswer[] = scored.map(({ common, ...s }, i) => ({
    ...s,
    frequency: common,
    points: Math.max(1, Math.round(i < TOP_K ? (weights[i] / headW) * TOP_SHARE : (weights[i] / tailW) * (100 - TOP_SHARE))),
  }));
  // Keep points strictly non-increasing after rounding (ties are fine, inversions are not).
  for (let i = 1; i < answers.length; i++) answers[i].points = Math.min(answers[i].points, answers[i - 1].points);
  return { id: q.id, prompt: q.prompt, short: q.short, answers: answers.filter((a) => a.views > 0) };
});

const out = {
  generatedAt: new Date().toISOString(),
  method: {
    source: "Wikimedia Pageviews (holiday spike) + Datamuse word frequency (commonness) + Wikidata aliases",
    window: `December ${YEARS[0]}-${YEARS.at(-1)} vs. each year's typical month (median Feb-Oct)`,
    surveyAlpha: SURVEY_ALPHA,
    topShare: `top ${TOP_K} answers share ${TOP_SHARE} of 100 responses`,
    holidayWeight: HOLIDAY_WEIGHT,
    note: "Points = share of a 100-person 'survey' from commonness in everyday English x the December spike in Wikipedia lookups (common AND seasonal).",
  },
  questions,
};

await writeFile(path.join(ROOT, "data", "questions.json"), JSON.stringify(out, null, 2));

for (const q of questions) {
  const top = q.answers.slice(0, 7).map((a) => `${a.label} ${a.points}`).join(" | ");
  console.log(`${q.id.padEnd(16)} ${top}`);
}
console.log(`\n✓ Wrote ${questions.length} questions to data/questions.json`);
