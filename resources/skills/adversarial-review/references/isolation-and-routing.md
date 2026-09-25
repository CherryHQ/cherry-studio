# Isolation and Model Routing

## Why fresh context, why cross-model

Two independent failure modes are being defended against:

1. **Context contamination.** A reviewer that shares the implementing
   session's context has already absorbed the author's framing, rationale,
   and confidence. Information asymmetry is what makes review work.
2. **Self-grading bias.** A model reviewing its own output systematically
   under-reports its own errors. `adversarial-review` strengthens the rule
   from "separate context" to "separate model" via the liter-llm gateway.

Isolation is **structural**, not honor-system: the judge is an API call whose
entire input is the review packet (`build-review-packet.mjs` output). There
is no channel through which session history could reach it —
`dispatch-judge.mjs` reads only the packet file and the mandate file, never
the calling process's conversation state.

## Model resolution

```
[MODEL_ROUTING] phase=adv-review-judge class=frontier model=<resolved> producer=<producer>
```

1. Read `producer_model` from the packet (progress.json → `KBD_PRODUCER_MODEL` →
   `ANTHROPIC_MODEL` → harness vars → `unknown`, resolved by
   `lib/review/packet-builder/producer-model.mjs`'s `resolveProducerModel`).
   `unknown` makes the comparison below pass **trivially**, so
   `build-review-packet.mjs` warns `PRODUCER_UNKNOWN` and the findings record
   `cross_model_check: unverified-producer-unknown`.
2. Resolve `critic`, `judge`, and `backup` aliases and canonical
   provider-connection/provider/model identities through
   `lib/review/model-resolution.mjs`. Precedence, highest first:

   ```
   explicit arg > PROMETHEUS_KBD_<ROLE>_MODEL > ~/.prometheus/kbd/models.toml
     > built-in default (kbd-judge)
   ```

   There is **no `frontier` → `medium` → `small` tier walk**, and no alias table. Roles
   resolve to `[[models]]` **names** declared in `~/.config/liter-llm/liter-llm-proxy.toml`.

   JUDGMENT CALL: the source lists a fourth precedence layer
   (`.kbd-orchestrator/project.json` `model_policy`) between models.toml and
   the built-in default. The mini has no adversarial-review-specific field in
   that file and no observed caller needing it, so this layer is not ported —
   `resolveRole` goes straight from `models.toml` to the built-in default.
3. Compare canonical identities. Served aliases are transport names and never
   evidence that two roles are distinct. If the judge collides with the critic
   or current producer, is unavailable, or lacks a canonical identity, use the
   configured backup only when its canonical identity is distinct and available.
4. If no distinct backup exists, exit 4 and leave review pending. The dispatcher
   never proceeds with a known same-model self-grade.

Phase classes (declared in SKILL.md frontmatter `model_routing`):

| Phase | Class | Rationale |
|---|---|---|
| `adv-review-preflight` | small | env scan + file reads, deterministic |
| `adv-review-packet` | small | pure assembly, no LLM call |
| `adv-review-judge` | frontier | open-ended defect hunting requires full reasoning |

## Fallback chain

Warn loudly and degrade honestly. Missing infrastructure does not block
agent tools, but final certification still requires review or a signed
waiver:

| Tier | Trigger | Guarantee | Marker |
|---|---|---|---|
| REST gateway | an OpenAI-compatible endpoint answers `GET /v1/models` | fresh context AND cross-model | `isolation_mode: "rest-gateway:<url>"`, exit 0 |
| harness-native subagent | `dispatch-judge.mjs` exit 3 | fresh context only (same model family) | `isolation_mode: "harness-native"` |
| pending | exit 4 / no subagent capability | none | cumulative `pending_review` receipt; final certification fails |

The trigger is **gateway reachability** (`lib/review/model-resolution.mjs`'s
`resolveGateway`, probed with a plain `fetch` call), not the presence of any
particular binary — the judge speaks OpenAI REST over Node's built-in
`fetch` and shells out to nothing.

The harness-native fallback prompt is **exactly** the mandate file plus the
packet JSON — adding anything else (task summaries, prior conversation)
breaks the isolation contract.

## Preflight contract

`preflight-models.mjs` output (cached at `.kbd-orchestrator/model-preflight.json`):

```json
{
  "status": "ok | degraded | needs_configure | config_broken | no_gateway | no_providers | unavailable",
  "gateway": "http://localhost:4000/v1",
  "roles": {
    "judge":     { "alias": "kbd-judge",  "identity": { "providerConnectionId": "local-proxy", "providerId": "openai", "modelId": "gpt-5.6-sol" }, "source": "models.toml" },
    "critic":    { "alias": "kbd-critic", "identity": { "providerConnectionId": "local-proxy", "providerId": "openai", "modelId": "gpt-5.5" }, "source": "models.toml" },
    "backup":    { "alias": "kbd-backup", "identity": { "providerConnectionId": "local-proxy", "providerId": "openai", "modelId": "gpt-5.4" }, "source": "models.toml" }
  },
  "providers_detected": ["openai", "groq"],
  "classes_available": ["small", "medium", "frontier"],
  "distinct_models": 2,
  "config_path": "/Users/you/.config/liter-llm/liter-llm-proxy.toml",
  "config_exists": true,
  "config_defects": [],
  "checked_at": "2026-07-30T00:00:00Z"
}
```

Status handling by the calling skill:

- `unavailable` → the port has no liter-llm binary concept (Node speaks REST
  directly); this status is currently unreachable in the mini and kept only
  for schema parity with the full pack. `no_gateway` is the real
  unavailability signal here.
- `no_gateway` → nothing answered `GET /v1/models`. Start the local
  `openai-proxy` (`:8181`) or `liter-llm api --config <abs path>`, or set
  `LITER_LLM_BASE_URL`.
- `config_broken` → the config exists but **cannot serve a request**. Read
  `config_defects`: a missing `[general] master_key` means every `/v1/*` call
  answers 401, and a `localhost` `base_url` without `[security] outbound_policy`
  is refused by the default `deny_private`.
- `needs_configure` → no judge role resolves. Seed
  `~/.prometheus/kbd/models.toml` `[roles]` and the matching `[[models]]`
  entries in `liter-llm-proxy.toml` by hand.
- `degraded` → warn: only one distinct dispatchable model; collisions expected
  until a second provider is configured.
- `ok` → proceed.

Cache invalidation: `--force`, `liter-llm-proxy.toml` or `models.toml` newer
than the cache, or age > 24 h (`lib/review/preflight.mjs`'s `isCacheFresh`).
