# Agent rules cache

Source of truth for `/kbd-inject-agent-rules`. The injector reads from
here when building the fenced region in `CLAUDE.md` / `AGENTS.md`.
`--refresh` validates the source URLs by anchor-keyword presence and
updates the fetch dates — it does **not** auto-rewrite rule wording.

## Karpathy — Think-first principles

Last fetched: 2026-05-27

1. **Think Before Coding** — State assumptions explicitly, surface
   ambiguity, present tradeoffs, ask for clarification rather than
   guessing silently.

2. **Simplicity First** — Write the minimum code that solves the
   problem; no speculative features, abstractions, or over-engineering.

3. **Surgical Changes** — Touch only what the request requires; do not
   "improve" adjacent code, comments, or formatting.

4. **Goal-Driven Execution** — Operate against concrete success
   criteria, not step-by-step micro-instructions. LLMs loop well toward
   goals.

5. **Implementation-First, Test-at-Checkpoints** — For a multi-change
   epoch/plan, implement the ENTIRE plan first — every logical connection
   made, no gaps, no unimplemented important pieces — before verifying it.
   Plan items have no meaning in isolation: small unit tests passing while
   the whole system doesn't fit together proves nothing. Wait for
   test/build results a MAXIMUM of 3 times during an entire epoch — use
   those checkpoints deliberately (e.g. early, mid, and end), not after
   every change. When a checkpoint does happen, prefer full end-to-end /
   integration tests over the connections between sections of the system,
   constructed AFTER the implementation is done and proven to compile —
   shape tests around code that exists, not the other way around, since the
   final shape isn't known until the end. This changes the PACING of
   verification; it does not relax principles 1-4 above (still think first,
   still state assumptions, still architecture-before-code).

Sources (URL + anchor keyword for `--refresh` validation):

- https://github.com/forrestchang/andrej-karpathy-skills — anchor: `Think Before Coding`
- https://www.aibuilderclub.com/blog/karpathy-claude-md-rules — anchor: `Karpathy`
- https://lucaberton.com/blog/karpathy-claude-md-llm-coding-principles-2026/ — anchor: `CLAUDE.md`

Principle 5 is an operator directive (Travis, 2026-07-02/03,
universal-agent-runtime), not from the external Karpathy sources above —
kept in this section because it's philosophically continuous with 1-4
(goal-driven, trust-the-process execution). `--refresh` should not expect
an anchor keyword for it in the URLs above.

## Boris Cherny — Claude Code workflow principles

Last fetched: 2026-05-27

1. **Plan Mode First** — Iterate the plan in Plan Mode until it's right;
   only then switch to auto-accept edits. The agent works best when it
   can commit to a structured plan: what to do, in what order, why.

2. **CLAUDE.md as accumulated knowledge** — Use CLAUDE.md as a
   long-lived project-level instruction file. Accumulate rules,
   constraints, and lessons over time. This is the primary mechanism for
   making the agent smarter on your project without changing the model.

3. **Verification + feedback loops** — Give the agent a way to verify
   its work. With a real feedback loop, the final result improves by
   2-3×.

4. **Code quality matters for AI too** — Partially-migrated codebases
   confuse models the same way they confuse humans. When you start a
   migration, finish it.

Sources (URL + anchor keyword):

- https://howborisusesclaudecode.com/ — anchor: `Plan Mode`
- https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny — anchor: `Claude Code`
- https://www.lennysnewsletter.com/p/head-of-claude-code-what-happens — anchor: `Boris`
