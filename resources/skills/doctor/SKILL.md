---
name: doctor
description: Use when checking whether this pack's environment is healthy — Node version, version authority, submodules, Docker, the two services, pk, sycophancy-correction, home-directory skill copies, KBD position, and the install-scope rule. Also use before reporting that something "is not installed" or "is not running", so the claim is a verdict rather than a guess.
---

# Doctor

Run the checks, read the JSON lines, and apply a fix **only when the check offered one**.

## Running it

```bash
boss-mini doctor.mjs
```

One JSON object per line, one per check, then a summary line. Exit `0` when nothing failed,
`1` when any check failed, `2` when the doctor itself could not run (bad argument, unknown fix).

```json
{"id":"mini-node-version","title":"Node.js version","status":"pass","summary":"Node 24.16.0"}
{"summary":true,"pass":4,"warn":3,"fail":1,"skip":3}
```

For a human reader, `boss-mini doctor.mjs --human` renders a table instead.

## Reading the result

| Status | Means | What to do |
|---|---|---|
| `pass` | Verified working | Nothing |
| `warn` | An optional component is absent or unreachable | The `detail` names the next step. **Not** a failure: the pack works with both services down. |
| `fail` | Something is present and broken, or a rule is violated | Act on it. This is what sets exit 1. |
| `skip` | The check could not run | Read the reason. A dependency that has not landed yet is a `skip`, never a `pass`. |

`skip` never means healthy. A check that could not look has not established anything — do not
report a `skip` as "fine".

## Applying a fix

Only `mini-skill-copies` offers one:

```bash
boss-mini doctor.mjs --fix copy-skills
```

It copies each missing or differing skill into `<home>/.agents/skills/` and
`<home>/.claude/skills/`. It is idempotent, it never deletes, and it never follows a name
that is not a plain directory component.

**Never invent a fix id.** Apply a fix only when the check's own `actions` array named it:

```json
"actions":[{"kind":"fix","fixId":"copy-skills"}]
```

A check reporting `fail` with no `actions` has no automatic repair, by design. `mini-install-scope`
is the example: it names the directories to remove and stops, because deleting files under a
user's home is not an idempotent copy and which copy is authoritative is not mechanically
decidable. Surface it and let the operator decide.

## The install-scope rule

`mini-install-scope` enforces a binding project rule (`openspec/config.yaml`): **the mini pack is
never installed natively on a machine that already has the full skill pack.** Inside the-boss's own
data directory is fine. On such a machine `copy-skills` returns `refused` and writes nothing, and
`mini-skill-copies` reports `skip` — the copies are forbidden there, so their absence is correct.

## For the-boss

The-boss spawns this script and maps these lines onto its own check results; it cannot register
these checks directly, because its `DoctorCheckRegistry` is closed over a fixed id union. The
mapping — including `refused` → `failed` and where our `summary` goes — is written in
`lib/doctor/contract.md`. That makes this output a cross-process interface: the ids, the four
statuses and the line shape are stable.
