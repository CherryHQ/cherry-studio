# AI SDK v7 Research Report — STABLE

> Date: 2026-06-25 | Status: **`ai@7.0.0` STABLE** (npm `latest`) | Supersedes the 2026-04-04 beta report below the fold.
> Branch synced to `origin/main` (ec9e9bd324). Cherry currently pins **`ai@6.0.143`** (v6 stable).

## 0. TL;DR

- v7 shipped stable. It is **not** the friction-free bump v6 was: every `@ai-sdk/*` provider jumped a **major** (V4 provider spec), and there's a wide layer of top-level **renames** in `streamText`/`generateText` result + callback surface.
- The two scariest rumored breaks from the beta tracking **did NOT land**: `providerOptions` is **not** renamed (61 call-site files safe), and `experimental_prepareStep/activeTools/output` were already off our codebase.
- Real cost is concentrated in **6 provider patches** (all pinned to v3.x, won't apply to v4) + a batch of mechanical renames (mostly codemod-able).
- New strategic item: **HarnessAgent** — wraps Claude Code / Codex / Pi / OpenCode as swappable agent harnesses. This is the *black-box-wrapper* approach we explicitly rejected in the runtime design; it does **not** change our "build our own (C,G) runtime on ToolLoopAgent" thesis.
- **Escape hatch**: npm `ai-v6` dist-tag exists on `ai` and every provider — we can stay on v6 indefinitely and upgrade deliberately.

## 1. Version matrix (v6 → v7)

| Package | Cherry now (v6) | v7 `latest` | v6 escape tag |
|---|---|---|---|
| `ai` | 6.0.143 | **7.0.0** | `ai-v6` → 6.0.210 |
| `@ai-sdk/provider` | 3.0.8 | **4.0.0** | `ai-v6` → 3.0.11 |
| `@ai-sdk/provider-utils` | 4.0.19 | **5.0.0** | `ai-v6` → 4.0.31 |
| `@ai-sdk/anthropic` | 3.0.71 | **4.0.0** | `ai-v6` → 3.0.87 |
| `@ai-sdk/openai` | 3.0.x | **4.0.0** | `ai-v6` → 3.0.75 |
| `@ai-sdk/google` | 3.0.x | **4.0.0** | `ai-v6` → 3.0.84 |
| `@ai-sdk/openai-compatible` | 2.0.37 | **3.0.0** | `ai-v6` → 2.0.52 |

All `@ai-sdk/*` deps move in lockstep. The `ai-v6` dist-tag is the supported "don't upgrade yet" pin.

## 2. Breaking changes that actually hit Cherry (grounded by grep)

| Area | v6 | v7 | Cherry call sites | Codemod? |
|---|---|---|---|---|
| **Tool context** | `experimental_context` | **`runtimeContext`** (ambient request state) + new **`toolsContext`** (per-tool, isolated) | **17 files** | yes |
| **Tool approval** | `needsApproval` (on tool def) | **`toolApproval`** (on call/agent, keyed by tool name) | **17 files** | partial |
| **Step callback** | `onStepFinish` | `onStepEnd` (and `onFinish`→`onEnd`) | **9 files** | yes |
| **Stream prop** | `result.fullStream` | `result.stream` | **5 files** | yes |
| **Telemetry** | `experimental_telemetry` + built-in OTel | `telemetry` + **separate `@ai-sdk/otel` package**; opt-out only once globally registered (Cherry stays opt-in via per-call `integrations`) | **3 files** | partial |
| **Stop condition** | `stepCountIs()` | `isStepCount()` | **3 files** | yes |
| **Usage semantics** | `result.usage`=final step, `result.totalUsage`=all | **swapped**: `result.usage`=all steps, `result.finalStep.usage`=final | **3 files** | ⚠️ silent |
| **UI stream** | `result.toUIMessageStream()` | stateless `toUIMessageStream({stream})` | **2 files** | yes |
| **system prompt** | `system:` | **`instructions:`** (system in `messages` now needs `allowSystemInMessages:true`) | audit needed | yes |

⚠️ **Usage swap is the dangerous one** — same property name, inverted meaning, no type error. Manually audit the 3 files.

### Confirmed NON-breaks (rumors from beta tracking that didn't ship)
- `providerOptions` → ~~`options`~~: **NOT renamed**. 61 files safe. (`providerMetadata` top-level is deprecated → read from `result.finalStep` instead.)
- `experimental_prepareStep / activeTools / output`: **0 call sites** — we're already clean.

### Other v7 facts
- Image/media tool-result parts unified: `{type:'image-*'|'media'}` → `{type:'file', mediaType, data}`. Audit attachment/file rendering.
- `CallSettings` type split → `LanguageModelCallOptions & Omit<RequestOptions,'timeout'>`. Affects `packages/aiCore/src/core/runtime/types.ts`.
- CJS exports removed (ESM-only). Cherry is ESM — verify main-process build only.
- Node ≥22 required. Cherry already requires ≥22. ✅
- Codemods: `npx @ai-sdk/codemod v7` covers ~25 of the mechanical renames above.

## 3. The real migration cost: patches

Old report said "2 patches". Current reality — **6 `@ai-sdk/*` patches + 1 openrouter**, all pinned to **v3.x/v2.x** versions that will not apply on v4:

```
@ai-sdk__anthropic.patch
@ai-sdk__deepseek@2.0.30.patch
@ai-sdk__google@3.0.64.patch
@ai-sdk__openai@3.0.53.patch
@ai-sdk__openai-compatible@2.0.37.patch
@ai-sdk__xai@3.0.83.patch
@openrouter__ai-sdk-provider.patch
```

Each must be re-derived against the v4 provider source, or upstreamed, or dropped if v7 already fixes the reason it exists. **This is the gating work item** — more than the renames.

## 4. HarnessAgent — new, and it intersects our agent-runtime design

v7 shipped (experimental) **HarnessAgent**: one API to run Claude Code / Codex / Pi / OpenCode as swappable "harnesses", each in a **sandboxed workspace**, returning AI-SDK-compatible `generate()`/`stream()` results. Harnesses own skills, sessions, permission flows, compaction, sub-agents.

```ts
const agent = new HarnessAgent({ harness: claudeCode, sandbox: createVercelSandbox(...), tools, skills })
```

**How this lands against our design** (see [`architecture.md`](./architecture.md)):
- This is precisely the **black-box-wrapper** path we rejected — it wraps Claude Code as an opaque harness, requires a sandbox, is experimental, and is Anthropic/CLI-centric. It does **not** give model-agnostic control and doesn't unify chat+agent on one data model. Our reasons for *not* taking it still hold.
- Our thesis is unchanged and sits on **stable** primitives: `ToolLoopAgent` + `prepareStep`/`runtimeContext` (= our `C`) are stable in v7 and present in v6; approval (= our `G`) is `needsApproval` + the message-based flow in v6, the centralized `toolApproval` setting in v7. We build `Runtime(C, G)` on those, we don't adopt HarnessAgent.
- Watch only if we ever want a "run real Claude Code in a sandbox" power-user feature — then HarnessAgent is the off-the-shelf path, but track until it leaves experimental.

## 5. Recommendation

1. **Do not upgrade now.** Stay on `ai@6` (pin `ai-v6` tag). v6 has every primitive our runtime design needs.
2. **Pre-work, low risk, do anytime:** re-derive the 6 provider patches against v4 source (or eliminate them). This is the long pole — start it decoupled from the version bump.
3. **When we do bump:** run `npx @ai-sdk/codemod v7`, then hand-fix the ⚠️ usage-semantics swap (3 files) + telemetry `@ai-sdk/otel` split (`buildTelemetry.ts` + `aiSdkSpanAdapter.ts` under `src/main/ai/observability/`) + `system→instructions`. (Full telemetry plan: [`migration-plan.md`](./migration-plan.md) → "Deferred to v7".)
4. **External tracking issue** [#14022](https://github.com/CherryHQ/cherry-studio/issues/14022) should reflect: status STABLE, `providerOptions` rename cancelled, patch count 6, HarnessAgent assessment.

## Sources
- npm dist-tags: `ai@7.0.0` = latest, `ai-v6` = 6.0.210 (verified via `npm view`)
- [v6→v7 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)
- [Program agent harnesses with AI SDK (HarnessAgent)](https://vercel.com/changelog/program-agent-harnesses-with-ai-sdk)
- [v7 Epic #14011](https://github.com/vercel/ai/issues/14011) · Cherry tracking [#14022](https://github.com/CherryHQ/cherry-studio/issues/14022)

---

<details><summary>Archived: 2026-04-04 beta report (status now outdated — kept for history)</summary>

The original beta-era report (v7 7.0.0-beta.53, milestone 28%) lived here. Its feature list is still roughly correct, but these specifics are now superseded by §1–§4 above:
- "2 patches" → actually 6+1
- "providerOptions → options rename" → cancelled, never shipped
- beta-era mid-flight names (`context`→`runtimeContext` churn, `CallSettings` naming) → see final names in §2
- v7 status beta/canary → now STABLE

</details>
