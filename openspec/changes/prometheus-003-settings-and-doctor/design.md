# Design — `/settings/prometheus`

Task §1 of `tasks.md`. Written **within** `DESIGN.md`'s stated direction, not beside it: neutral-first,
semantic colour, content before decoration, `@cherrystudio/ui` primitives only. A second component
vocabulary here would be a defect, so this document decides *composition and copy*, never new
appearance.

## 1.1 Information architecture

### What the page is for

One question, asked in three layers of increasing detail:

> **Is the Prometheus skill system working, and if not, what do I do about it?**

Everything on the page answers that. Anything that does not is out of scope — this is not a
dashboard, and per `DESIGN.md` §2 a feature page owns its composition but earns no ornament.

### Why this order

The sections are ordered by **how likely a visitor is to be here for them**, which is the inverse
of how interesting they are to build:

| # | Section | Anchor | Why it sits here |
|---|---|---|---|
| 1 | Status summary | `status` | The whole reason for the visit. One line, readable without scrolling, no interaction required. |
| 2 | Skill availability | `skill-push` | The thing the operator controls and the only destructive-ish surface (it writes into `$HOME`). Above the fold because the full-pack refusal must be findable. |
| 3 | Diagnostics | `doctor-run` | The detail layer. Collapsed to a summary until run. |
| 4 | Services | `services` | Read-only context; `prometheus-004` grows this. Last because nothing here is actionable yet. |

A conventional layout would lead with the 11-row diagnostic table because it is the most *visible*
work. That would be wrong: the common case is a healthy system, where every row is noise and the
answer is one line. Detail is earned by failure, not shown by default — this is the page's one real
structural decision.

### The hierarchy rule this page follows

`SettingGroup` (card) per section, `SettingRow` per control, exactly as `AboutSettings` composes them.
Scale contrast comes from `SettingSubtitle` vs `SettingDescription`, not from custom type sizes.

## 1.2 The states

The page is a state machine over two independent axes — **push eligibility** and **doctor lifecycle** —
plus per-check outcomes. They are enumerated here because they are what the page is *for*; a page
that only renders the happy path is the failure mode this section exists to prevent.

### A · Every service down

`mini-service-surreal-memory` and `mini-service-liter-llm` both fail.

- **Not an error state for the page.** The pack works without them; only the review gate degrades.
- Services section shows two rows with a `warning`-family indicator, each naming what is lost —
  never a bare "Down".
- The status summary stays `warning`, not `error`. Overstating this trains operators to ignore it.

### B · Docker absent

`mini-docker` returns `skip`.

- Rendered as **informational, not failed**. Docker is optional; the mini's own check skips rather
  than fails, and the UI must not be more alarmed than the source of truth.
- Copy states the consequence ("services cannot be started here"), not the diagnosis.
- No install button. `prometheus-004` owns Docker lifecycle; offering an action this change cannot
  fulfil would be a dead control.

### C · Push in progress

- The push runs on every startup, unattended, so its feedback must be **non-modal** — it must never
  interrupt someone who opened Settings for another reason.
- An inline `role="status"` message on the skill-availability row. Per the live-badge guideline, it
  announces a meaningful atomic string ("Updating skills in your home directory"), never a bare count.
- The run button is disabled while in flight, with its label carrying the reason.

### D · Full pack detected → push disabled

**The most important state on the page, and the one a generic design would get wrong.**

This machine is a live example: 42 mini skill copies sit beside a full-pack install.

- The control is **disabled and stays visible** — hiding it would leave an operator hunting for a
  feature the docs promise.
- Disabled-with-reason: per `DESIGN.md`, disabled must be perceivable without colour, so the row
  carries reduced opacity **and** an explanatory line naming the markers found (the prometheus CLI on
  `PATH`, `~/.prometheus/setup-state.json`, installed orchestrator skills).
- Tone is *deliberate refusal*, not failure: "The full Prometheus pack is installed here, so the app
  will not copy its own skills over it." The mini refuses for a reason; the UI must not imply
  something is broken, and **must not offer a path around the refusal** (proposal §Impact, A-3).

### E · Doctor running

- Results stream in via the existing shared-cache mechanism — no second progress mechanism
  (proposal §Non-goals).
- Rows appear as they complete, so the list grows rather than swapping a spinner for a table. The
  active check is named; a bare spinner wastes the information the contract already provides.
- `role="status"` announces progress atomically. The run button becomes Cancel — a diagnostic that
  cannot be stopped is one people avoid starting.

### F · A check failed, with a repair

Only `mini-skill-copies` offers one today (`copy-skills`).

- Row shows an `error`-family icon **plus** text — never colour alone.
- A `Repair` button sits **in the row**, next to the failure it fixes, not in a page-level toolbar.
- On success the row re-runs and reports its new state. On `refused`, the refusal is surfaced
  verbatim rather than swallowed — a silent no-op is the worst outcome for a repair button.

### G · A check failed, with no repair

- Identical row treatment, **no button**. A disabled Repair button would imply a repair exists.
- The row carries the check's `detail` text, which is where the mini already explains what to do.
  Per the error-recovery guideline, an error without a recovery path is incomplete — here the
  recovery is instructions, so they must be shown, not hidden behind a disclosure.

### H · Doctor could not run

Exit code 2, or the pack is missing.

- Distinguished from "checks failed": nothing was learned, so reporting "all clear" would be a lie.
- States plainly that diagnostics are unavailable and why.

## 1.3 Copy, and the i18n keys derived from it

Written first as English sentences, then keyed — the order `tasks.md` §1.3 asks for, because keys
derived from finished copy stay stable while copy derived from keys drifts.

Key prefix `settings.prometheus.*`, camelCase tail per the i18n convention (which deliberately
differs from the dotted snake_case of preference keys).

| Key | English |
|---|---|
| `settings.prometheus.title` | Prometheus Skills |
| `settings.prometheus.description` | The Prometheus skill pack, its diagnostics, and where its skills are installed. |
| **Status** | |
| `settings.prometheus.status.title` | Status |
| `settings.prometheus.status.healthy` | Everything is working |
| `settings.prometheus.status.warnings` | Working, with {{count}} warnings |
| `settings.prometheus.status.failures` | {{count}} checks failed |
| `settings.prometheus.status.unknown` | Not checked yet |
| `settings.prometheus.status.unavailable` | Diagnostics are unavailable |
| `settings.prometheus.status.packVersion` | Pack version {{version}} |
| **Skill availability** | |
| `settings.prometheus.push.title` | Skills in your home directory |
| `settings.prometheus.push.description` | Copies the pack's skills to ~/.agents and ~/.claude so command-line tools can use them too. Runs at every startup. |
| `settings.prometheus.push.action` | Update now |
| `settings.prometheus.push.running` | Updating skills in your home directory |
| `settings.prometheus.push.upToDate` | Up to date — {{count}} skills installed |
| `settings.prometheus.push.never` | Not yet installed |
| `settings.prometheus.push.failed` | Could not update the skills in your home directory |
| `settings.prometheus.push.fullPackTitle` | Managed by the full Prometheus pack |
| `settings.prometheus.push.fullPackDescription` | The full Prometheus pack is installed on this computer, so the app will not copy its own skills over it. |
| `settings.prometheus.push.fullPackMarkers` | Found: {{markers}} |
| **Diagnostics** | |
| `settings.prometheus.doctor.title` | Diagnostics |
| `settings.prometheus.doctor.description` | Checks the pack, its tools, and its services. |
| `settings.prometheus.doctor.run` | Run diagnostics |
| `settings.prometheus.doctor.cancel` | Cancel |
| `settings.prometheus.doctor.running` | Running {{title}} |
| `settings.prometheus.doctor.lastRun` | Last run {{time}} |
| `settings.prometheus.doctor.repair` | Repair |
| `settings.prometheus.doctor.repairing` | Repairing |
| `settings.prometheus.doctor.repairFailed` | The repair could not be applied: {{reason}} |
| `settings.prometheus.doctor.repairDone` | Repaired |
| `settings.prometheus.doctor.relaunchNeeded` | Restart the app to finish |
| `settings.prometheus.doctor.unavailable` | The diagnostics could not run, so nothing was checked. |
| **Per-check status** | |
| `settings.prometheus.check.pass` | Passed |
| `settings.prometheus.check.warn` | Warning |
| `settings.prometheus.check.fail` | Failed |
| `settings.prometheus.check.skip` | Skipped |
| **Services** | |
| `settings.prometheus.services.title` | Services |
| `settings.prometheus.services.description` | Optional. The pack works without them; the review gate is reduced when they are unavailable. |
| `settings.prometheus.services.up` | Running |
| `settings.prometheus.services.down` | Not running |
| `settings.prometheus.services.dockerMissing` | Docker was not found, so these services cannot be started here. |

### Copy rules applied

- **Consequence, not diagnosis.** "so these services cannot be started here", not "docker binary not
  found on PATH". The `detail` field still carries the technical text for those who want it.
- **No exclamation, no apology, no "Oops".** `DESIGN.md` asks for calm and utilitarian.
- **Refusals are stated as decisions**, in the active voice: "the app will not copy its own skills
  over it."
- **Counts are interpolated, never concatenated** — several target locales order clauses differently.

## Accessibility commitments

1. Every status is **icon + text**, never colour alone (`DESIGN.md`, accessible interaction).
2. Streaming updates use one `role="status"` region with `aria-atomic`, not one per row.
3. A repair failure uses `role="alert"`; a routine result does not.
4. Rows carry `id={getSettingDomId('/settings/prometheus', anchorId)}` + `scroll-mt-6` so settings
   search can jump to them.
5. Every control is reachable by keyboard in visual order, with the focus ring left intact.

## Explicitly not designed here

- **Docker lifecycle controls** — `prometheus-004`.
- **Per-check enable/disable.** No requirement, and it would invite silencing a failing check.
- **A second progress mechanism** — proposal §Non-goals.
- **Which of the 11 checks the-boss surfaces natively.** Still the open product call carried from
  analyze; this page renders all of them from the spawned doctor instead.
