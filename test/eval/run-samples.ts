/**
 * Step 3 acceptance runner. Runs the fast lane and deep lane over the 20
 * fixed samples with real keys and writes a review sheet for a human.
 *
 *   TYPESAFE_API_KEY=... TAVILY_API_KEY=... DEEPSEEK_API_KEY=... npm run eval:samples
 *
 * Output: test/eval/out/<timestamp>/review.md (verdicts and links for a human
 * to mark right or wrong), results.json (raw), and costs.md (usage by lane and
 * step, the source for docs/COSTS.md).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { parseQuestionContent } from "../../engine/content";
import { JevClient } from "../../engine/jev/client";
import { UsageLog } from "../../engine/usage";
import { runFastLane } from "../../engine/fastlane";
import { runDeepLane } from "../../engine/deeplane";
import { TavilyClient } from "../../engine/deeplane/search";
import { PageFetcher } from "../../engine/fetch/readable";
import { LlmClient, PRESETS } from "../../engine/helper/llm";
import { parseHelperPrompts } from "../../engine/helper/tasks";

interface Sample {
  id: string;
  kind: string;
  text: string;
  planted: string[];
  expect: Record<string, unknown>;
}

const samples = JSON.parse(readFileSync("test/samples/samples.json", "utf8")) as Sample[];
const content = parseQuestionContent(readFileSync("content/questions.yaml", "utf8"));
const prompts = parseHelperPrompts(readFileSync("content/helper-prompts.yaml", "utf8"));

const typesafeKey = process.env.TYPESAFE_API_KEY;
const tavilyKey = process.env.TAVILY_API_KEY;
const llmKey = process.env.DEEPSEEK_API_KEY ?? process.env.LLM_API_KEY;
if (!typesafeKey) {
  console.error("TYPESAFE_API_KEY is required. Fast lane cannot run without Jev.");
  process.exit(2);
}

const usage = new UsageLog();
const jev = new JevClient({ apiKey: typesafeKey, usage, model: content.model });
const llm = llmKey ? new LlmClient({ ...PRESETS.deepseek!, apiKey: llmKey }, fetch, usage) : undefined;
const search = tavilyKey ? new TavilyClient(tavilyKey, fetch, usage) : undefined;
const fetcher = new PageFetcher({ fetch, parseHtml: (html) => parseHTML(html).document as unknown as Document });

const outDir = `test/eval/out/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(outDir, { recursive: true });

const results: unknown[] = [];
const review: string[] = ["# Callout sample review", "", `Run: ${new Date().toISOString()}`, "", "Mark each green or red row as RIGHT or WRONG after opening the link. PRD F14g needs 90 percent right.", ""];
const fastMs: number[] = [];

for (const s of samples) {
  process.stdout.write(`${s.id} ... `);
  const capture = { text: s.text, source: { kind: "paste" as const, helperOutput: false }, capturedAt: Date.now() };
  const fast = await runFastLane(jev, content, capture);
  fastMs.push(fast.timing.totalMs);
  const deep = fast.autoDeepCheck || (fast.worthDeepCheck.probabilities.yes ?? 0) > 0.3
    ? await runDeepLane({ jev, content, llm, prompts, fetcher, search, online: true }, { text: s.text }, () => {})
    : undefined;
  results.push({ id: s.id, fast, deep });
  console.log(`kind=${fast.contentKind} signals=${fast.signals.map((x) => x.id).join(",")} techniques=${fast.techniques.map((x) => x.id).join(",")} deep=${deep ? Object.entries(deep.counts).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(" ") : "skipped"} fast=${fast.timing.totalMs}ms`);

  review.push(`## ${s.id}`, "", `> ${s.text}`, "", `Kind: ${fast.contentKindLabel}. Level: ${fast.manipulationLevel.label}. Signals: ${fast.signals.map((x) => x.label).join("; ") || "none"}. Techniques: ${fast.techniques.map((x) => x.label).join("; ") || "none"}.`, "");
  if (s.planted.length) review.push(`Planted: ${s.planted.join(" | ")}`, "");
  if (deep) {
    review.push("| Claim | Verdict | Why | Source | Right? |", "|---|---|---|---|---|");
    for (const c of deep.claims) review.push(`| ${c.claim.text} | ${c.verdictLabel} (${c.bandLabel}) | ${c.why} | ${c.best ? `[link](${c.best.passage.url})` : ""} | |`);
    if (deep.explanation) review.push("", `Summary: ${deep.explanation.sentences.map((x) => x.text).join(" ")}${deep.explanation.warning ? ` (${deep.explanation.warning})` : ""}`);
    review.push("");
  } else {
    review.push("Deep lane: not started (fast lane said nothing checkable).", "");
  }
}

const sorted = [...fastMs].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

const costs = ["# Usage by lane and step", "", `Samples: ${samples.length}. Fast lane p50 ${p50} ms, p95 ${p95} ms (Node, not the app; PRD N1 targets 300 ms and 800 ms).`, "", "| API | Lane | Step | Calls | Input tokens | Output tokens | Avg ms |", "|---|---|---|---|---|---|---|"];
for (const r of usage.byLaneAndStep()) costs.push(`| ${r.api} | ${r.lane} | ${r.step} | ${r.calls} | ${r.inputTokens} | ${r.outputTokens} | ${r.avgMs} |`);
const t = usage.totals();
costs.push("", `Totals: ${t.calls} calls, ${t.inputTokens} input tokens, ${t.outputTokens} output tokens.`, "", "Per check: divide each row by the sample count. Fill in prices in docs/COSTS.md once known.");

writeFileSync(`${outDir}/results.json`, JSON.stringify({ results, usage: usage.all() }, null, 2));
writeFileSync(`${outDir}/review.md`, review.join("\n"));
writeFileSync(`${outDir}/costs.md`, costs.join("\n"));
console.log(`\nWrote ${outDir}/review.md, results.json, costs.md`);
