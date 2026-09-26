# Model configuration for adversarial review

How the judge finds a model that is **not** the producer, and how to point it at any
provider you have — a local `openai-proxy`, or a vendor coding plan.

## The rule this exists to enforce

The critic must not share the producer's blind spots. A same-family judge is a
**failure**, not a fallback.

## Two files, one gateway

```
~/.prometheus/kbd/models.toml              KBD owns:       role -> model NAME
~/.config/liter-llm/liter-llm-proxy.toml   liter-llm owns: NAME -> provider + base_url + ${KEY}
```

Adding a provider edits liter-llm's file. Repointing a role edits `models.toml`.
Neither ever requires editing a script.

```toml
# ~/.prometheus/kbd/models.toml
[gateway]
candidates = ["http://localhost:4000/v1", "http://localhost:8181/v1"]

[roles]
generator = "kbd-frontier"   # the producer; not dispatched, only compared against
critic    = "kbd-critic"     # MUST differ from generator
judge     = "kbd-judge"
backup    = "kbd-backup"

[role_identities]
critic_gateway_connection_id = "local-gateway"
critic_provider_connection_id = "local-proxy"
critic_provider_id = "openai"
critic_model_id = "gpt-5.5"
judge_gateway_connection_id = "local-gateway"
judge_provider_connection_id = "local-proxy"
judge_provider_id = "openai"
judge_model_id = "gpt-5.6-sol"
backup_gateway_connection_id = "local-gateway"
backup_provider_connection_id = "local-proxy"
backup_provider_id = "openai"
backup_model_id = "gpt-5.4"
```

This shape is parsed defensively by `lib/review/model-resolution.mjs`'s
`parseModelsToml` — a minimal, hand-rolled parser for exactly these three
tables (`[gateway]` with a `candidates` array, `[roles]` and `[role_identities]` with flat string
keys), not a general TOML library. Any unreadable or malformed file returns
the empty shape rather than throwing: a missing or broken config degrades to
"not configured", never crashes the dispatch.

## Resolution order

AWS-CLI convention, highest wins. Implemented once in
`lib/review/model-resolution.mjs`'s `resolveRole`:

```
explicit argument
  > PROMETHEUS_KBD_<ROLE>_MODEL        e.g. PROMETHEUS_KBD_JUDGE_MODEL
  > ~/.prometheus/kbd/models.toml      [roles]
  > built-in default                   kbd-judge / kbd-critic / kbd-frontier
```

`preflight-models.mjs` prints which layer supplied each role, so this is never a guess.

## Four contracts that will bite you

All four apply exactly as documented for the full pack's `liter-llm` tool —
the mini's judge dispatch speaks the same OpenAI-compatible wire format over
Node's `fetch`, so the same gateway-side behaviour applies.

### 1. `/v1/*` requires a Bearer token unconditionally

A config with no `[general] master_key` and no `[[keys]]` answers **401 to
everything**, `/v1/models` included.

```toml
[general]
master_key = "${LITER_LLM_MASTER_KEY}"
```

`dispatch-judge.mjs` sends this as `Authorization: Bearer <token>`, resolved
from `LITER_LLM_MASTER_KEY`, falling back to `OPENAI_API_KEY`, falling back
to the literal `sk-local` (which `openai-proxy` ignores but still requires a
header to be present).

### 2. `deny_private` blocks loopback

`[security].outbound_policy` defaults to `deny_private`, which **refuses** any
`localhost` / `127.0.0.1` `base_url` with `OutboundForbidden`.

```toml
[security]
outbound_policy = "off"
# or, if this host also reaches untrusted networks:
#   outbound_policy = "allowlist"
#   outbound_allowlist = ["http://localhost:8181"]
```

### 3. liter-llm never searches `$HOME`

`ProxyConfig::discover()` walks the **CWD upward** for `liter-llm-proxy.toml`.
Always pass `--config <abs path>` when starting the gateway itself:

```bash
liter-llm api --config ~/.config/liter-llm/liter-llm-proxy.toml
```

### 4. A `base_url` override never speaks a non-OpenAI wire protocol, and never substitutes `provider_model` into the request

Two separate behaviors compound into one trap:

- **Protocol.** Any `[[models]]` entry that sets `base_url` gets a generic
  OpenAI-compatible client — `/chat/completions`, `Authorization: Bearer`,
  OpenAI response shape — **no matter what prefix `provider_model` uses**.
- **Model field.** The gateway's `/v1/chat/completions` handler forwards the
  **caller's literal `"model"` string** upstream unchanged.
  `dispatch-judge.mjs`'s request body (`lib/review/judge-client.mjs`'s
  `buildRequestBody`) sets `model` to the resolved judge/critic model name
  exactly, so that name must equal the real upstream model id for any
  `base_url`-overridden entry.

**`curl .../chat/completions` (or a `fetch` from this port) comes back HTTP
200 with a well-formed `choices` array regardless of whether the intended
backend was ever reached.** The only way to catch it is to ask the model to
self-identify and compare the answer against what was configured.

**Gateway ordering matters for the same reason.** `~/.prometheus/kbd/models.toml`
`[gateway] candidates` is checked in order (`lib/review/model-resolution.mjs`'s
`resolveGateway` probes each with `GET /models` until one answers). `openai-proxy`
(`:8181`) always answers 200 and always serves its own backend regardless of
the requested model. If liter-llm's own `api` server (default port `4000`)
isn't running or isn't listed first, dispatch silently falls through to
`openai-proxy` and every named model gets served by whatever `openai-proxy`
proxies to, with no error. Start liter-llm's gateway before relying on named
models, and put `http://localhost:4000/v1` **first** in `[gateway] candidates`.

## Providers

liter-llm has first-class providers for the common ones; use the real prefixes.

| Provider | `provider_model` | `base_url` | key var |
|---|---|---|---|
| openai-proxy (local) | `openai/gpt-5.6-sol` | `http://localhost:8181/v1` | none (`sk-proxy-local`) |
| Kimi / Moonshot | `moonshot/kimi-k2.5` | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |
| MiniMax (pay-as-you-go) | `minimax/MiniMax-M2.5` | `https://api.minimax.io/v1` | `MINIMAX_API_KEY` |
| Qwen / DashScope | `dashscope/qwen3-coder-plus` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` |
| Z.ai GLM | `zai/glm-4.7` | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY` |

## Secrets

Never in the TOML. Keys live in `~/.prometheus/kbd/secrets.env` (`0600`, outside any
repo) and are referenced as `${VAR}`:

```bash
set -a; . ~/.prometheus/kbd/secrets.env; set +a
```

liter-llm supports `${VAR}` **only** — no `${VAR:-default}` — and expands an
**unset** var to `""`, which surfaces much later as an unexplained 401.

## Reading the artifact

`findings.json` records what actually answered:

| Field | Meaning |
|---|---|
| `isolation_mode` | `rest-gateway:<url>` — the endpoint that served the review |
| `cross_model_check` | `verified-distinct` · `same-model-collision` · `unverified-producer-unknown` |
| `judge_model` / `producer_model` | the compared pair |
| `judge_identity` / `producer_identity` | canonical provider-connection/provider/model triples used for collision checks |

`unverified-producer-unknown` means the packet carried no `producer_model`, so
the collision check could not be certified. Export `KBD_PRODUCER_MODEL` plus
`KBD_PRODUCER_PROVIDER_CONNECTION_ID`, `KBD_PRODUCER_PROVIDER_ID`, and
`KBD_PRODUCER_MODEL_ID` to fix it.
