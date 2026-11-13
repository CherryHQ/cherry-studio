# Agent Note: Tool calls state their purpose

Status: proposed

English | [中文](2026-11-12-tool-call-intent.zh.md)

## Problem

While a Pi or Pi Durable agent works, the user sees a stream of tool rows whose titles the renderer guesses from
the arguments. `ToolHeader.getCommandActivity` matches a Bash command against regular expressions, so
`cd ~/repo && grep -rn …` becomes "Switch folder" and `ls` becomes "View file list". The rows say what ran, not why
it ran. Most models fill that gap themselves with a short sentence before each call ("Now check the CI status"), but
DeepSeek models call tool after tool without one and keep their reasoning in a separate thinking block. With them the
user cannot tell what the agent is trying to achieve and loses trust in a long run.

## Proposal

When a Pi or Pi Durable agent runs a DeepSeek model, every tool call carries an optional `intent` argument: one short
sentence, in the user's language, saying why the call is being made. The renderer shows it the way other models'
narration reads: a line of text above the tool row.

1. **Shared rule.** `@cherrystudio/agent-behavior` exports the argument name, the system-prompt guide,
   `offersToolIntent(modelId)` (true for DeepSeek model ids) and a factory for a tool transform taking the tool and
   whether to offer `intent`. When offered, the transform adds `intent: { type: "string" }` to an object schema that
   does not already declare it, without adding it to `required`. Either way it wraps `prepareArguments` so the argument
   is removed before the tool's own repair, schema validation, approval gates, hooks and execution, so a call that
   still carries `intent` after a model switch runs normally. Pi validates arguments against a copy, so the model's
   original call, with `intent`, stays in the native transcript and in the product message.
2. **Pi.** The existing `pi-coding-agent` patch gives `AgentSession` a tool transform applied in
   `_applyToolLoadout`, the single point where built-in, custom, extension, MCP and activated deferred tools become
   the declared and executable set. `createAgentRuntimeSession` installs the shared transform for roots and children,
   offering `intent` and appending the guide to the system prompt only for a DeepSeek model.
3. **Pi Durable.** The existing `pi-durable` patch lets an extension declare `wrapTools(tool, model)`, applied in
   `resolveAgent` to every composed tool with the agent's model, so the offered tools, the callable tools, the tool
   declarations recorded in the transcript and the tools that execute are all transformed. Cherry installs one
   extension carrying the transform and a prompt section that renders the guide only for a DeepSeek agent.
4. **Renderer.** A tool group shows a non-empty `intent` as a line of body text above the call's row, and as the group
   title while it runs. The row itself keeps today's guessed title. Calls without an intent render exactly as today.
5. **Agent sessions show every step.** The agent message list opens nested tool groups and the finished process
   group by default, while the turn runs and after it ends, so each step reads without a click. A group the user
   closes stays closed. Ordinary chat keeps today's collapsed defaults.
6. **Fold repetition, drop thinking noise.** Within one run of calls, adjacent calls that carry intents and do the
   same kind of thing (the same guessed title, such as several reads of one diff) fold under that title, collapsed by
   default; expanding it shows each intent and row. A tool group whose calls carry intents does not render the
   thinking blocks between them; its header still says it is thinking while the model reasons.

The contract is soft: a model that ignores the guide, a schema that is not an object, and calls in sessions created
before this change all render exactly as today.

## Alternatives considered

- **Offer `intent` to every model.** Models that already narrate between calls would say the same thing twice.
  Rejected; only DeepSeek models are offered it.
- **Wrap only the tools Cherry registers.** Needs a replacement for each Pi built-in tool and still misses tools
  that Pi extensions register themselves (tool search, codemode). Rejected for incomplete coverage.
- **Add `intent` to the provider request in the gateway.** The gateway sees several wire formats, and Pi validates
  tool arguments against the registered schema, whose built-in tools reject unknown properties. Rejected.
- **Strip `intent` in the `tool_call` / `beforeTool` hook.** Runs after schema validation, which fails for
  `additionalProperties: false` schemas. Rejected.
- **Ask DeepSeek to narrate in assistant text.** The text has no stable link to the call it explains, and parallel
  calls share one paragraph. Rejected.
- **Hard-code `intent` inside the vendor patches.** Leaves the rule untested in vendor `dist` code and duplicated
  across two engines. The patches expose a generic transform; the rule stays in Cherry code with tests.

## Acceptance criteria

- AC1 — The shared transform adds an optional `intent` string to an object schema only when offered, leaves non-object schemas, existing `intent` properties and `required` untouched, and removes `intent` from arguments before the original `prepareArguments` runs whether or not it was offered; `offersToolIntent` is true for DeepSeek model ids only (verification: unit)
- AC2 — In a Pi session with a DeepSeek model, the declared tools include `intent`, a call that supplies it executes with arguments that no longer contain it, and the transcript tool call still contains it; with another model, neither the tools nor the system prompt mention it (verification: unit)
- AC3 — In a Pi Durable agent with a DeepSeek model, the offered and callable tools include `intent` and a call that supplies it executes and validates without it; with another model, neither the tools nor the system prompt mention it and such a call still runs (verification: unit)
- AC4 — A tool call whose arguments include `intent` shows it as a line of text above its row and as the running group title, while the row keeps its guessed title; other calls render as today (verification: renderer)
- AC5 — In an agent session, tool groups and the finished process group are open by default during and after the turn, and a group the user closes stays closed (verification: renderer)
- AC6 — Adjacent same-kind calls with intents fold under their shared title, collapsed by default, while other calls stay listed; a group whose calls carry intents shows no thinking blocks, and a group without intents keeps them (verification: renderer)

## Risks

- Existing DeepSeek sessions see a one-time tool declaration change, which invalidates their prompt cache once.
- Each request carries the guide and one short property per tool; history carries each call's sentence.
- Upgrading `pi-coding-agent` or `pi-durable` requires carrying the two patch hunks forward.
