# Agent Note: Built-in ask_expert tool with a per-Agent expert model

Status: proposed

English | [中文](2026-10-30-ask-expert.zh.md)

## Problem

An Agent runs end-to-end on one model. A cheap, fast executor is the right default for most turns, but a few decisions — committing to an approach, escaping a repeated failure, declaring a task done — benefit from a stronger reviewer. Running the stronger model for the whole task is the expensive way to get that judgment, and it is unavailable to users whose provider has no second model tier.

Cherry Studio previously depended on Anthropic's server-side advisor tool for this. That tool is first-party and Anthropic-only, and its beta identifier has expired: requests carrying it are now rejected with HTTP 400 (issue #16135). Users on other providers have no equivalent, and there is no per-Agent place to name the stronger model.

## Proposal

Add a built-in `ask_expert` tool to the in-process `cherry-tools` MCP server, plus an Agent-level `expertModel` setting.

- `expertModel` is a nullable `UniqueModelId` column on the Agent row, edited in the Agent dialog next to the primary model. Unset means expert consultation is disabled; there is no global fallback, so a model is never spent without the Agent explicitly naming it.
- The tool takes one self-contained question: `objective`, `context`, `output_format`, `trigger`, `question_type`, `attempts`, and `boundaries`. The expert has no tools, no memory, and cannot ask follow-ups, so the contract forces the caller to supply everything the answer needs.
- The call is a single tool-less turn through `AiService.generateText` against `expertModel`. The result is returned as a candidate answer with a `VERDICT / ADVICE / RISKS` shape and an explicit "verify before adopting" footer; the tool never presents expert output as ground truth.
- A per-session budget of 8 calls and a 120,000-character context cap bound the spend and the request size. An unconfigured Agent gets an actionable configuration error instead of a silent no-op.
- The tool appears in the Agent tool catalog as "Ask Expert" and is auto-approved: it is read-only, and its only side effect is the configured model's token spend.

The tool ships in `cherry-tools`, which all three Agent runtimes (Claude Agent, Pi, DeepSeek Harness) mount, so one implementation serves every runtime. The AI-SDK chat path is not an Agent runtime and is intentionally untouched.

## Alternatives considered

- **Keep using Anthropic's server-side advisor tool.** It only works on Anthropic first-party models, the client cannot choose a model from another provider, and the beta header is already dead (#16135).
- **Reuse `planModel` or `smallModel`.** Those fields pin runtime aliases (`sonnet` / `haiku`) inside the Claude Code route. A paid, provider-agnostic consultation is a different concept, and only one runtime exposes those fields.
- **One global expert model in Settings.** Fewer clicks, but every Agent would silently share and spend that model. The per-Agent field matches the existing model-tier pattern and keeps cost opt-in.
- **Port the full Python `ask-expert` service (dedup, cache, calibration log, `audit_artifact`).** More faithful, but the state, retention, and audit contracts are a separate design. This proposal keeps the consultation contract only; the remaining pieces can land as follow-ups if the usage justifies them.
- **Run the expert as a tool-using subagent.** That doubles the tool loop and its latency. The value here is a second opinion from a model that sees only the distilled question, not another executor.
- **Require per-call approval.** The tool has no side effects; interrupting every consultation would train users to click through the prompt. The spend is bounded by the per-session budget and the explicit per-Agent opt-in.

## Acceptance criteria

- AC1 — The Agent dialog exposes an Expert model picker; setting, changing, and clearing it round-trips through the Agent API and the `agent.expert_model` column (verification: unit | renderer)
- AC2 — `ask_expert` is registered in `cherry-tools` and appears once in the Agent tool catalog as a user-facing orchestration tool (verification: unit)
- AC3 — With `expertModel` set, a call reaches exactly that model in one tool-less turn and returns the answer with the model and call-count footer (verification: unit)
- AC4 — Without `expertModel`, the tool returns an actionable configuration error and never calls the provider (verification: unit)
- AC5 — The ninth call in one session is rejected with `max_uses_exceeded`, and a context over 120,000 characters is rejected before the provider call (verification: unit)
- AC6 — The migration appends a nullable `expert_model` column with a `user_model` foreign key and passes the migration chain check (verification: unit)

## Risks

- **Spend.** A configured Agent can now consume the expert model's tokens. The per-session budget, the context cap, and the absence of a global default bound the exposure, but a high-frequency Agent can still call the expert eight times per session.
- **No automatic transcript.** Unlike Anthropic's server-side advisor, a client-side tool cannot see the conversation. The tool description therefore has to teach the caller to make the question self-contained; a lazy caller will get a shallow answer.
- **Budget scope.** The counter lives on the per-session `cherry-tools` server instance, so reconnecting a session resets it. A durable cross-reconnect ledger would need its own storage decision and is out of scope here.
- **Model quality floor.** Nothing stops an Agent from configuring a weaker model as the expert. The contract calls it "a stronger reviewer" but does not enforce a capability ordering across providers.
- **Auto-approval.** Skipping the approval prompt is a deliberate trade: no side effects, bounded spend, explicit opt-in. If maintainers prefer a prompt for cost transparency, the policy entry is a one-line change.
