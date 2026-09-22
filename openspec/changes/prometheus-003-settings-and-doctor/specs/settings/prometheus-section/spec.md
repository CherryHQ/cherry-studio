## ADDED Requirements

### Requirement: The mini's doctor runs from the app and streams its results
A check source SHALL spawn `node scripts/doctor.mjs` from the app-data copy of the pack, parse its
JSON lines, and map them onto doctor check results per `lib/doctor/contract.md`. Partial results
SHALL be published as they arrive using the existing shared-cache mechanism, never a new IPC
progress channel. A run that throws SHALL still publish a terminal state.

#### Scenario: Results appear progressively
- **WHEN** the doctor runs and emits its JSON lines one at a time
- **THEN** the settings view updates as each check completes, before the run finishes

#### Scenario: A crashed run does not hang the view
- **WHEN** the spawned process exits non-zero or emits unparseable output
- **THEN** a terminal state is published and the view leaves its running state

#### Scenario: A refusal is not reported as success
- **WHEN** a mini fix returns `refused`
- **THEN** it maps to `failed` with the refusal message, never to `fixed`

### Requirement: One-click repair is offered only where the check offers it
A repair action SHALL appear only for a check whose outcome declares it, and SHALL invoke
`node scripts/doctor.mjs --fix <fixId>`. Exactly one check offers one today
(`mini-skill-copies` → `copy-skills`).

#### Scenario: A check with no fix offers no button
- **WHEN** a check fails without an `actions` entry
- **THEN** no repair control is rendered for it

#### Scenario: Repair beside a full pack refuses and says so
- **WHEN** repair is invoked on a machine with the full Prometheus pack installed
- **THEN** the fix returns refused, nothing is written, and the reason is shown

### Requirement: Skills are pushed to the OS skill directories on every startup
A lifecycle service chained after `reconcileSkills()` — never from `main.ts` — SHALL ENSURE each
bundled skill is present at `<home>/.agents/skills/<name>` and `<home>/.claude/skills/<name>` when
absent or differing, and SHALL show a non-modal notice while it runs.

**It SHALL perform that copy by invoking the mini’s `copy-skills` fix
(`node scripts/doctor.mjs --fix copy-skills`), not by implementing its own copy.** That
implementation already refuses path escapes, never deletes, never symlinks, and refuses beside a
full pack, and it is mutation-tested; a second copier here would be a second set of those
guarantees to keep correct. This service owns the SCHEDULE (every startup) and the NOTICE; the mini
owns the file operation.

#### Scenario: A missing copy is created at startup
- **WHEN** the app starts and a skill is absent from a home skills root
- **THEN** it is copied there and the notice is shown while the work runs

#### Scenario: The push is skipped entirely beside a full pack
- **WHEN** the full Prometheus pack is detected on the machine
- **THEN** no file is written to either home skills root, and a persistent notice explains why

#### Scenario: A push is a copy, not a link
- **WHEN** a skill file is written to a home skills root
- **THEN** it is a regular file; no symlink is created

### Requirement: The section is registered, searchable and localized
A `/settings/prometheus` section SHALL be registered in its route file, in `settingsMenu.ts`, and
in a `*.search.ts` leaf so its rows are searchable and scroll-focusable. Every user-visible string
SHALL resolve through i18n in all 13 locales; no literal English in a component.

#### Scenario: The section is reachable and searchable
- **WHEN** a user opens Settings and searches for a Prometheus row title
- **THEN** the row is found and selecting it scrolls to that row

#### Scenario: A missing translation fails the build
- **WHEN** a key exists in `en-us` but not in another locale
- **THEN** `pnpm i18n:check` fails

### Requirement: Preferences are declared in the classification source, and cover the settings goal
Prometheus preference keys SHALL be added to `scripts/data-classify/data/classification.json` and
generated with `pnpm data:generate`. The generated `preferenceSchemas.ts` SHALL NOT be edited by
hand. No Drizzle migration SHALL be added, because the `preference` table stores key/value JSON.

The key set SHALL cover every control goal D-9 names:

| Concern | Behaviour |
|---|---|
| Services enabled | whether the three services may be started at all |
| Gateway URL | **fixed at `http://localhost:4000/v1`** — surfaced read-only; the project has exactly one gateway, so this is displayed, not edited |
| Docker consent | **declared and owned by `prometheus-004`, NOT by this change** — listed here only so a reader sees the whole set. This change SHALL NOT add that key. |
| Home-directory push | on/off for the every-startup push, and inert on a full-pack machine, where the push is skipped regardless |
| Doctor auto-run | whether the doctor runs on startup or only on demand |

Keys SHALL follow the `namespace.sub.key_name` convention the ESLint rule enforces — lowercase and
underscores — which is deliberately NOT the i18n convention and SHALL NOT be unified with it.

#### Scenario: The gateway is not user-editable
- **WHEN** the gateway row is rendered
- **THEN** it displays `http://localhost:4000/v1` and offers no control that changes it

#### Scenario: Disabling the push does not enable it beside a full pack
- **WHEN** the push preference is on and the full pack is detected
- **THEN** the push is still skipped — the preference cannot override the install-scope rule

#### Scenario: Regeneration preserves the keys
- **WHEN** `pnpm data:generate` runs again
- **THEN** the Prometheus keys are still present and unchanged
