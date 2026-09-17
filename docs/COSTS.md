# Costs

Filled from real usage. The engine logs `usage.input_tokens` and
`usage.output_tokens` for every Jev call with lane and step (PLAN section 5,
PRD F19). `npm run eval:samples` writes `test/eval/out/<run>/costs.md` with the
per-step table from the 20-sample set. Paste the table here after step 3 and
again after a week of tester use.

## Known prices (2026-09-17)

| API | Price | Source |
|---|---|---|
| TypeSafe (Jev) | Unpublished; beta access may be free and may end | docs.typesafe.ai, PLAN section 5 |
| DeepSeek `deepseek-flash` | Input cache miss $0.15/1M off-peak, $0.30 peak. Cache hit $0.003 / $0.006. Output $0.60 / $1.20. Peak is 01:00 to 04:00 and 06:00 to 10:00 UTC weekdays | api-docs.deepseek.com/quick_start/pricing |
| Tavily | Per-request credits on the user's plan | tavily.com pricing |

## Estimated shape of one check (before real numbers)

Fast lane: one Jev call with 3 + 6 + 34 questions over the text, plus one small
example-pick call when techniques show. Input tokens scale with text length
and the fixed question block (about 6 to 8 thousand tokens of questions).

Deep lane, five claims: one helper extraction call, one Jev gate call, up to
two helper query calls per claim, up to two Tavily searches per claim, up to
four page fetches per claim, one Jev rerank call and one Jev support call per
claim, one or two helper explanation calls, and one or two Jev explanation
checks. The helper and fetching dominate; Jev calls are short.

## Real numbers

_Pending: run `npm run eval:samples` with real keys and paste the table._

| API | Lane | Step | Calls | Input tokens | Output tokens | Avg ms |
|---|---|---|---|---|---|---|
| | | | | | | |

Cost per fast check: _pending_. Cost per deep check: _pending_. Unsure share:
_pending_.
