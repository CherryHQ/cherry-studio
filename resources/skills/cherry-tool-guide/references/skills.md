# Skills

Covers `mcp__skills__search_skills` and `mcp__skills__install_skill` — discovering and
installing new capability skills.

Get exact argument shapes from the live tool schema — this reference gives routing,
sequencing, and safety only.

## Availability

Ordinarily present. If absent from your live tool list, skill discovery/install is
unavailable this session.

## Approval

`mcp__skills__install_skill` mutates durable state and is **approval-gated**. Install
only once the user has signaled intent; if approval is declined, stop and report — don't
install through the shell.

## Workflow

1. **`mcp__skills__search_skills`** — searches skill marketplaces and returns candidates
   with quality/source metadata and an **opaque `install_source` string**. Present the
   relevant matches to the user *with their source and quality* and let them choose.
2. **`mcp__skills__install_skill`** — after the user signals intent, call it with the
   exact `install_source` from the chosen search result, **passed verbatim**.

## Handle `install_source` verbatim

`install_source` is opaque — **never construct or edit it yourself**. Pass back exactly
what a search result gave you. Cherry clones, installs the single skill, and registers it
in one call, so **never** run `npx skills add`, `git clone`, or any shell command to
install — that skips Cherry's registration.

## Recovery

- **Tool error result** (bad `install_source`, etc.) → read the message; re-run
  `search_skills` to get a fresh valid `install_source` rather than hand-editing one.
- **Approval declined** → stop and report; don't install via the shell.

## Example

> "Is there a skill for reviewing React performance?"

`mcp__skills__search_skills` "react performance" → present the best matches with their
source and quality → if the user says install one, `mcp__skills__install_skill` with that
result's exact `install_source`. No `git clone`, no manual copying.
