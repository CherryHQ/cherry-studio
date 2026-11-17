# Agent Note: Skill prerequisite preflight and approved isolated setup

Status: proposed

English | [中文](2026-11-16-skill-dependency-preflight.zh.md)

## Problem

An installed Skill is only a registered folder. Its executables, runtime versions, packages, and platform assumptions are discovered only when the Agent runs it, and the Agent may then install dependencies into the user's task working directory and stall (#20162). Installed state therefore says nothing about whether the Skill can run.

No parser reads a dependency declaration: `parseSkillMetadata` (`src/main/utils/markdownParser.ts:315-410`) reads only name, slug, description, version, author, tags, tools, allowed tools, context, and agent. `SkillService` copies and registers the folder without any readiness check (`src/main/ai/skills/SkillService.ts:852`).

## Proposal

### Declaration

A Skill declares prerequisites in its SKILL.md frontmatter under a single `requires` key. Skills without the key keep their current behavior unchanged.

```yaml
requires:
  bins: [pandoc]            # executables that must resolve on PATH
  python: ">=3.10"          # optional runtime constraint
  packages:
    pip: [pypdf==5.1.0]     # packages installed into the app-owned environment only
  platforms: [darwin, win32] # optional; omitted means all platforms
```

Only these four fields are recognized. Unknown fields produce a warning in the install result and are ignored. Credentials are not declared; a Skill that needs one is reported as `Setup required` with the credential name, and the value is entered through the existing secret storage.

### Readiness states

Each installed Skill has one readiness state, stored with the installed row and computed by the main process:

- `ready`: every declared prerequisite was verified against the current environment fingerprint.
- `setup_required`: at least one prerequisite is missing or incompatible; the missing item is recorded.
- `setting_up`: an approved setup run is active.
- `failed`: the last setup run ended with an error, cancellation, or timeout; the error and log path are recorded.

A Skill with no `requires` key is `ready` by definition. The fingerprint covers the platform, the Cherry Studio version, the Skill content hash, and the resolved identity of each declared prerequisite: every binary's resolved path and version, and every runtime's name, resolved path, and version. Upgrades, Skill updates, and moving an Agent to another runtime change the fingerprint and force a recheck.

Readiness is also revalidated against the environment, not only against the stored fingerprint: before every Agent run that would load the Skill, the cheap preflight checks (binary resolution and version reads) rerun. Removing a declared binary such as `pandoc`, upgrading it in place, or replacing or switching a runtime therefore flips the Skill back to `setup_required` even when nothing in the stored fingerprint changed. A run never starts a Skill whose last revalidation did not pass.

### Preflight

Preflight runs when a Skill is installed or updated, when the fingerprint changes, and before every Agent run that would load the Skill (the revalidation rule above). It only checks: it resolves binaries, reads runtime versions, and inspects the app-owned environment. It never installs anything.

If a Skill used by an Agent run is not `ready`, the run does not start the Skill. The user sees the missing prerequisite and a single action to set it up.

### Approved setup

Setup runs only after the user approves a specific run in the Skill's settings. Each approval shows the exact commands and package list and applies to that run only; a later setup needs a new approval.

Setup executes in an app-owned directory resolved through `application.getPath` with a new key under the skills namespace, defined in the implementation layer following `src/main/core/paths/README.md`. The Agent's task working directory is never a setup target, and setup environment variables do not leak into task processes.

Setup is bounded: a fixed timeout, cancellation through the existing process-tree termination helper, and a retry action that starts a new approved run. Logs for each run are kept in the Skill's app-owned directory, and the failing prerequisite is named in the failure state. A cancelled or failed setup never leaves the Skill `ready`.

### UI

The installed-Skill row and detail show the readiness state, the missing prerequisite, and the Retry or Set up action. Setup progress and the log path are shown while `setting_up`. This reuses the existing Skill management surface; no new page is added.

## Alternatives considered

- Use a separate `skill.requirements.json` sidecar: rejected for this milestone because one frontmatter key keeps the declaration next to the instructions and needs no second file format.
- Let the Agent install missing packages during a run: rejected because it reproduces the reported failure and mutates the task working directory.
- Run setup automatically on install: rejected because it executes author-declared commands without per-run user consent.
- Bundle common runtimes with the app (#14893): out of scope here; this proposal only defines readiness and the isolated setup path for declared prerequisites.

## Acceptance criteria

- AC1 — An installed Skill whose declared binary is missing is shown as `setup_required` before any Agent run and does not start. (verification: unit and renderer)
- AC2 — A Skill with an incompatible `python` constraint or unavailable platform is reported with the failing constraint and never marked `ready`. (verification: unit)
- AC3 — Starting a Skill never installs packages into the task working directory; setup writes only under the app-owned directory. (verification: main-process integration)
- AC4 — Each setup run requires an explicit approval that displays the exact commands and packages, and applies only to that run. (verification: renderer and unit)
- AC5 — A cancelled or timed-out setup leaves the Skill `failed`, keeps its log, and does not re-run until the user retries. (verification: unit with controlled process termination)
- AC6 — Package-install failure records the failing prerequisite and log path; retry starts a new approved run. (verification: unit and renderer)
- AC7 — A Skill without a `requires` key keeps its current install and run behavior. (verification: unit regression)
- AC8 — Upgrading the app or updating the Skill changes the fingerprint and forces a recheck before the next run. (verification: unit)

## Risks

Declared commands and packages are untrusted author input; the approval dialog is the only consent gate, so its display must be exact. Package managers and interpreters differ across platforms; a Skill that works on one platform may be marked `setup_required` on another. Setup disk use is unbounded by default, so the app-owned directory needs a size warning. These risks are accepted for the first milestone; a sandboxed setup runtime is out of scope.

Rollback disables the `requires` parser and treats every Skill as `ready`, which restores the current behavior. Installed Skills and their app-owned directories are preserved.
