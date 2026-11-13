# Agent Note: Tool calls state their purpose

Status: implemented

English | [中文](2026-11-12-tool-call-intent.zh.md)

## Problem

While a Pi or Pi Durable agent works, the user sees a stream of tool rows whose titles the renderer guesses from
the arguments. `ToolHeader.getCommandActivity` matches a Bash command against regular expressions, so
`cd ~/repo && grep -rn …` becomes "Switch folder" and `ls` becomes "View file list". The rows say what ran, not why
it ran. Most models fill that gap themselves with a short sentence before each call ("Now check the CI status"), but
DeepSeek models call tool after tool without one and keep their reasoning in a separate thinking block. With them the
user cannot tell what the agent is trying to achieve and loses trust in a long run.

## Decision

When a Pi or Pi Durable agent runs a DeepSeek model, every tool call carries an optional `intent` argument: one short
sentence, in the user's language, saying why the call is being made. The renderer shows it the way other models'
narration reads: a line of text above the tool row.

1. **Shared rule.** `@cherrystudio/agent-behavior` exports the argument name, the system-prompt guide,
   `offersToolIntent(modelId)` (true for DeepSeek model ids) and `createToolIntent()`, a factory for a transform taking
   a tool and whether to offer `intent`. When offered, the transform adds `intent: { type: "string" }` to an object
   schema that does not already declare it, without adding it to `required`. Either way it wraps `prepareArguments`
   so the argument is removed before the tool's own repair, schema validation, approval gates, hooks and execution, so
   a call that still carries `intent` after a model switch runs normally. Pi validates a copy, so the model's original
   call, with `intent`, stays in the native transcript and in the product message.
2. **Pi.** The `pi-coding-agent` patch gives `AgentSession.setToolTransform`, applied in `_applyToolLoadout`, the single
   point where built-in, custom, extension, MCP and activated deferred tools become the declared and executable set.
   `createAgentRuntimeSession` installs the shared transform for roots and children, offering `intent` and appending the
   guide to the system prompt only for a DeepSeek model.
3. **Pi Durable.** The `pi-durable` patch lets an extension declare `wrapTools(tool, model)`, applied in `resolveAgent`
   to every composed tool with the agent's model. Cherry's `cherry.behavior` extension carries the transform and a
   `tool_intent` prompt section that renders the guide only for a DeepSeek agent.
4. **Renderer.** `ToolBlockGroupContent` shows a non-empty `intent` as a line of body text above the call's row, and
   `getToolGroupSemanticTitle` uses it as the group title while the group runs. The row keeps its guessed title. Calls
   without an intent render as before.
5. **Agent sessions show every step.** The agent message list sets `expandToolSteps`, which opens nested tool groups and
   the finished process group by default, while the turn runs and after it ends. A group the user closes stays closed.
   Ordinary chat keeps its collapsed defaults.
6. **Fold repetition, drop thinking noise.** Within one run of calls, adjacent calls that carry intents and share a
   guessed title fold under that title, collapsed by default. A tool group whose calls carry intents does not render the
   thinking blocks between them; its header still says it is thinking while the model reasons.

The contract is soft: a model that ignores the guide, a schema that is not an object, and calls in sessions created
before this change all render as before.

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

## Consequences

DeepSeek agents in Pi and Pi Durable explain each step in the user's language. In live sessions with DeepSeek V4.1
Flash every call carried an intent (18 of 18 and 36 of 36 in two PR-review runs). Other models see no schema or prompt
change. Existing DeepSeek sessions see a one-time tool declaration change, which invalidates their prompt cache once.
Each request carries the guide and one short property per tool, and history carries each call's sentence. Upgrading
`pi-coding-agent` or `pi-durable` requires carrying the two patch hunks forward.

## Verification

- AC1 — `pnpm exec vitest run packages/agent-behavior/tests/orchestration/toolIntent.test.ts`: 11 tests pass, covering the offered schema, untouched non-object and self-declared schemas, intent removed before the tool's own repair whether or not offered, and `offersToolIntent` for DeepSeek and other model ids.
- AC2 — `pnpm exec vitest run packages/agent-runtime-pi/tests/session.test.ts`: a DeepSeek session declares `intent` on every tool and in the system prompt, gates and executes the call without it and keeps it in the transcript; another model's session declares neither and still runs a call carrying it.
- AC3 — `pnpm exec vitest run packages/agent-runtime-pi-durable/tests/toolIntent.test.ts`: a DeepSeek agent declares `intent`, gates, validates and executes without it and keeps it in the transcript; another agent declares neither and still runs such a call without errors.
- AC4 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx`: an intent renders as a line directly above its own row and as the group title, and a call without one gets no line.
- AC5 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx`: with `expandToolSteps`, a running turn lists every step and a finished turn stays open until the user closes it; a group opened by default stays closed after the user closes it.
- AC6 — `pnpm test:renderer src/renderer/components/chat/messages/blocks/__tests__/ToolBlockGroup.test.tsx src/renderer/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx`: adjacent same-kind intent calls fold collapsed under their shared title while other calls stay listed, and thinking blocks disappear from groups whose calls carry intents but stay in groups without them.
