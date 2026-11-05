# Agent Note: Ollama thinking follows natively reported model controls

Status: implemented

English | [中文](2026-11-01-ollama-thinking-controls.zh.md)

## Problem

Ollama rejects named `think` levels that a model does not support. A model's generic thinking
capability does not establish which `think` values it accepts, and a locally inferred tier —
whether persisted on an existing row or produced by catalog or ID-pattern inference — can still
send a value Ollama answers with HTTP 400.

## Decision

Following the approach in #22550, the controls Ollama reports through `/api/show`
(`thinking.values` / `thinking.default`) are the authoritative source:

- Discovery converts reported values into intrinsic reasoning controls: `false` becomes the off
  switch, `true` the boolean switch, known effort names their tiers, and unrecognised names are
  dropped. A model whose values are all `false` declares explicitly empty controls so "no
  thinking" is a recorded fact, not an absence of data.
- Creation persists the native controls and the reasoning capability flag; the model-fetch flow
  diffs them onto existing rows, changing only reasoning metadata so a stale, locally inferred
  tier cannot override the model's reported controls. Reads and request-time resolution prefer
  stored controls over catalog or inferred reasoning for the Ollama format.
- The gateway mapper sends a named level only when the model advertises levels (the serializer
  projects the request onto the declared tiers), a boolean when the model advertises the boolean
  switch, the reported default level for `auto` on levels-only models, and omits `think` when the
  accepted values are unknown so Ollama applies its own default.
- Without native metadata, Ollama's generic capability fallback still declares only a toggle, so
  inferred non-effort controls are sent through the boolean switch, never as named wire levels.

## Alternatives considered

- Keep the `high` fallback and generic inferred levels: rejected because either can send a value
  Ollama rejects.
- Omit reasoning for every Ollama model: rejected because it disables the supported boolean
  switch and natively reported levels.
- Depend on #22550 merging first: rejected because this bug stands alone; the subset ported here
  (discovery, persistence, read preference) is compatible with that PR's wider endpoint work.

## Consequences

- Boolean-only Ollama models receive `think: true`/`false`, never a named level.
- Models with natively reported levels receive only an advertised level.
- Models whose controls were never discovered degrade to no `think` field.
- Fetching a provider's models refreshes existing rows' thinking choices in place; user settings
  such as names, notes, and context windows are untouched.

## Verification

- Regression — `listModels.test.ts`: `/api/show` thinking values become exact controls;
  boolean-only, levels-only, disabled, and unknown-value declarations are covered.
- Regression — `ModelService.test.ts`: native controls persist on creation, survive rereads for
  custom, recognized, and preset rows, refresh existing rows without touching user settings, and
  explicit empty controls retire inferred tiers.
- Regression — `modelSync.test.ts` and `useProviderModelPullReconcile.test.ts`: enrichment keeps
  native controls over the catalog, the creation DTO carries them, and saved rows are refreshed
  only when the reported controls differ.
- Regression — `providerOptionsMapper.test.ts`: boolean-only, levels-only, clamped, default-level,
  disabled, and unknown-capability Ollama requests.
