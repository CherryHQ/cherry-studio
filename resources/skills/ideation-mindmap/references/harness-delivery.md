# Harness delivery — what this port actually does, and what it does not

The full pack's `ideation-mindmap` never renders its own prompts: it emits a `UiIntent` and
lets a separate skill, `ui-surface`, resolve the harness's UI tier and perform a structured
round trip (a file-pair handshake, verified against `codex`, `zed`, `opencode`, `kimi`, and
`cursor`). That verified, multi-tier behaviour does **not** carry over to this port — say so
plainly rather than restating the source's claims as if they applied here.

## What is different in this repo, and why

`ui-surface` is not ported into `prometheus-skills-mini`. `README.md`'s port-analysis table
names this skill's dependency as `surreal-memory` only, and Phase C of the port plan scopes
this task to the three `ideation-mindmap` scripts — not to porting a second skill as a side
effect. Porting `ui-surface` here would have been scope creep.

Consequently `scripts/emit-ui-intent.mjs` (backed by `lib/ideation/ui-intent.mjs`) always
renders **Tier 0 text**: it prints the title, body, and options to stdout and exits `0`. It
never performs a round trip, never polls for a harness response, and therefore never reaches
the source's Tier-1 file-pair handshake or its exit-3 "no response" timeout path — there is
nothing to time out waiting on.

`scripts/emit-ui-intent.mjs --title ... [--body ...] [--option ...]...` or
`--intent-json '<json>'` still builds and validates the same `UiIntent` shape the source's
`jq` pipeline produced (`lib/ideation/ui-intent.mjs`'s `buildIntent`), and still prints a
`tier=<resolved> harness=<...>` line to stderr for observability — including a warning if a
caller sets `SURFACE_TIER` to anything other than `tier0_text`, since no renderer exists here
to act on that tier.

## To go further than Tier 0

Port `ui-surface` (`prometheus-skill-pack/skills/learn/ui-surface/`) to this repo's Node/ESM
conventions first, then wire its resolved tier and its Tier-1 renderer into
`scripts/emit-ui-intent.mjs` in place of the hardcoded Tier 0 path. Until that lands, every
question this skill asks is plain text, and that is a stated limit of this port — not a bug
to work around by reintroducing a shell-out to a script that does not exist here.

## Calling it

```bash
boss-mini emit-ui-intent.mjs \
  --title "Which idea to build?" \
  --body  "Three survived scoring." \
  --option "Standup generator" \
  --option "PR summariser"
```

Exit codes: `0` the question was printed · `1` usage error (neither `--title` nor
`--intent-json` given, or `--intent-json` is not valid JSON).
