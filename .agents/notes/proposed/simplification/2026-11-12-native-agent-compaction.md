# Agent Note: Delegate agent compaction to native runtimes

Status: proposed

English | [中文](2026-11-12-native-agent-compaction.zh.md)

## Problem

Pi and Pi Durable own compaction boundaries, but shared behavior requires the Cherry host to generate every summary. The host serializes raw native messages to JSON and can send an oversized summary request. Pi's native summarizer instead bounds tool-result excerpts and omits thinking content. Both runtimes already supply a native summarizer and route model calls through Cherry's gateway.

If approved, this partially supersedes the summary-generation and mandatory acceptance decisions in the [harness-neutral behavior note](../architecture/2026-10-18-agent-behavior-package.md). The product still needs request limits, goal and child ownership, durable accounting, and compaction lifecycle facts.

## Proposal

Let each runtime use its native compaction and summary generation. Shared behavior owns the product decision to admit a compaction and observes its outcome, but does not construct summary prompts or select the compaction range. Adapters capture the goal and child-run owner before native work and associate actual model requests and reported usage with that owner. Count each actual request, including retries and multi-part summaries, through the existing request limit. Native usage and gateway billing are distinct; do not create duplicate billing records or invent missing usage.

Pi and Durable expose different native facts. Use their own events, storage, and model interfaces to implement one shared behavior contract. If the pinned SDK cannot provide an essential request or atomic accounting fact, change the upstream integration or dependency before claiming the contract; do not synthesize an owner, replay a side effect, or silently bypass a budget.

Preserve session identity, native history, cancellation, manual and automatic compaction, user-visible result and failure, goal ownership, child-run attribution, and reopen/fork recovery. Delete the replaced host summarizer and obsolete acceptance path after all callers migrate. Keep Claude Code's native compaction independent.

Token-estimation changes, global tool-batch budgeting, and a new compression plugin are outside this change. Research external extensions separately and report their compatibility and evidence without enabling one in production.

## Alternatives considered

- Keep the shared JSON summarizer and imitate upstream serialization: this retains duplicate compaction logic and can drift again.
- Disable the shared hooks without replacement: this can bypass request limits and lose durable goal or child usage attribution.
- Replace native history with a separate proxy-owned transcript: this introduces a second source of conversation and recovery state.

## Acceptance criteria

- AC1 — Pi and Pi Durable use their own native summarization for automatic and manual compaction; Cherry does not construct a replacement summary prompt or replay serialized native messages to create the summary. (verification: native runtime contract — implementation owner)
- AC2 — Each native summary model request, including split summaries and retries, is subject to the correct root or child request limit and is associated with the owner captured at compaction start. (verification: native runtime contract — implementation owner)
- AC3 — Reported summary usage contributes once to the correct goal and child run across completion, interruption, restart, and fork; absent native usage remains unknown and gateway billing is not duplicated. (verification: native runtime and real SQLite — implementation owner)
- AC4 — Automatic and manual compaction preserve cancellation, failure and no-op outcomes, post-compaction model context, retained product history, and native session identity across reopen. (verification: native runtime and Main consumers — implementation owner)
- AC5 — A DeepSeek official comparison exercises the same long-context tool burst against current and native Pi paths, records requests and retention separately, and reports any remaining overflow without claiming a 24-hour guarantee. (verification: real provider — implementation owner)
- AC6 — Cherry's behavior contract and reference documentation describe native summary ownership, current accounting obligations, and removal of the obsolete host summarizer. (verification: docs gate — implementation owner)

## Risks

Native compaction can issue several model requests and may return no per-request usage at the point an adapter needs it. Durable background compaction can complete after its originating run; recovery must preserve its original ownership. Native summary truncation can remove details, so context recall and product history must remain independently available. Native threshold estimation can still miss a burst, and this proposal does not claim that it prevents every context overflow.
