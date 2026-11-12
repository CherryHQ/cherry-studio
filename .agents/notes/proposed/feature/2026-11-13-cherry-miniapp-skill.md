# Agent Note: cherry-miniapp Skill and MiniApp authoring workflow

Status: proposed

English | [中文](2026-11-13-cherry-miniapp-skill.zh.md)

## Problem

Users can install `.miniapp` packages and use `window.cherry`, but cannot go from a natural-language request to a generated, tested, installed and optionally published MiniApp inside Cherry Studio. Generated HTML or a package alone does not prove that the app runs under the real MiniApp protocol, CSP, bridge, permissions and quotas.

Current state (checked at `4cd7953b26`): no `.agents/skills/cherry-miniapp/`; `public-skills.txt` has no entry; `NewMiniAppPanel.tsx` offers only the `site` and `app` tabs; no `mini_app` agent tool, `miniapp-browser` or `mini_app.authoring.*` IPC exists. Existing foundations are reusable: Skill import (`SkillInstaller`, `skillArchive`, `skillRemoteSource`), MiniApp install (`features/miniApp/install/`), runtime (`MiniAppRuntimeService`, `bridge`, `protocol`, `partition`), capabilities (`features/miniApp/capabilities/`), grants and activity logs.

This note covers the complete request in #21646. It relates to, and does not replace, #19781, which owns the local create → preview → install flow for Agent-created Mini Apps. Overlap with #19781 is resolved by the open decision below.

## Proposal

The work ships in four stages. Each stage merges independently and carries its own tests.

### Stage 1: Skill and packaging

Add a public Skill at `.agents/skills/cherry-miniapp/` with `SKILL.md`, references for the contract, testing and publishing, a static template, `window.cherry` type declarations, and validate and package scripts. Scripts check the manifest, reject assets that reference a development server, build a deterministic ZIP and compute SHA-256 and size. The Skill is listed in `public-skills.txt` only after the template validates and packages.

ZIP and GitHub imports reuse the existing Skill installer. A repeated import reuses the installed Skill and never creates a duplicate.

### Stage 2: Isolated preview and control

A preview uses the real MiniApp protocol, CSP, capability bridge, permission checks and quotas. It has its own runtime identifier, temporary directory, Electron partition and grants, and keeps the manifest identity. Preview storage and file backends are temporary. Closing, replacing or exiting a preview cancels requests, revokes control targets and releases resources. Abandoned previews are swept at startup.

Each chat session owns its preview targets. Sessions cannot control each other's targets. Closing, replacing or switching artifacts invalidates old targets immediately.

Host tools:

| Interface | Responsibility |
|---|---|
| `mini_app` | `validate`, `preview`, `status`, `install`, `pin`, `close` |
| `miniapp-browser` | Snapshot, click, type, wait, logs and screenshots, limited to the bound preview page |
| `mini_app.authoring.*` IPC | Preview and install requests, consent state, result notifications |

`validate` accepts only artifact paths authorized for the current session and returns an `artifactToken` bound to the package SHA-256. Preview and install require that token. Automation never interacts with host permission or installation confirmation dialogs. Preview AI calls use the existing default and quick model slots and record usage; a missing model configuration shows a configuration prompt.

### Stage 3: Creation and install entry points

The Add Mini App dialog gains a "Create using Agent" tab. It binds an installed Skill directly, or guides its import, then opens a session with a requirement draft. `.miniapp` artifact cards gain "Preview and test" and "Install to Mini Apps" actions that pass the session's artifact directly.

Preview consent, installation and Launchpad addition are separate user decisions. Preview data, files and permissions do not migrate into the installed app. `enabled` controls list state and `pinned` controls Launchpad. Installation rejects corrupt or replaced packages by re-checking the digest bound to the token.

The repair loop allows at most three consecutive automated repair rounds. After the third failure, installation and publishing stop and the session returns the evidence and recovery steps.

### Stage 4: Publishing workflow

Publishing runs only when the user explicitly requests it. Before publishing, the workflow confirms the repository owner, license, application ID and hosting address; the default is the user's public GitHub repository with GitHub Pages. The distribution manifest adds the download URL, SHA-256 and size. The packaged manifest does not contain `package`. Each version uses a new immutable package path, and the application ID is preserved.

After publishing, the hosted manifest, package and icon are read back over HTTPS from the same origin without redirects. Digest, size and version must match the final tested package. The app is then installed from its public URL and verified.

The official directory PR changes only the corresponding entries in `README.md` and `README.zh-CN.md`. It does not upload packages or build output. The workflow checks existing entries and PRs first. "Published", "submitted" and "merged" are reported as separate states.

## Alternatives considered

- Use a community Builder only to generate files: rejected as the complete solution because it does not provide host-integrated testing, direct installation or publishing. It may still serve as a reference.
- Implement only #19781: rejected because it leaves the independent Skill, bound test evidence, Launchpad choice and publishing unaddressed.
- Preview in a regular browser or HTML iframe: rejected because it cannot verify `window.cherry`, permissions, storage isolation or installation.
- Bundle the Skill into the app or upload packages to the official directory repository: rejected because it conflicts with independent import and the directory's hosting boundaries.

## Acceptance criteria

- AC1 — The Skill imports from ZIP and GitHub, and a repeated import reuses the installed Skill without creating a duplicate. (verification: unit; owner: Backend)
- AC2 — Packaging rejects an invalid manifest or an asset that references a development server, and produces a deterministic ZIP with matching SHA-256 and size. (verification: unit; owner: Backend)
- AC3 — A preview runs through the real protocol, CSP, bridge and permission checks, with its own runtime, temporary directory, partition and grants, and cannot read or write an installed app with the same ID. (verification: unit and Electron; owner: Backend)
- AC4 — Preview targets are bound per session; closing, replacing or exiting invalidates them and cancels in-flight requests; abandoned previews are cleaned up at startup. (verification: unit; owner: Backend)
- AC5 — `validate` returns an `artifactToken` bound to the package SHA-256; preview and install reject a token whose package bytes have changed. (verification: unit; owner: Backend)
- AC6 — Automation operates only the bound preview page and cannot approve preview, installation or Launchpad consent. (verification: unit and Electron; owner: Backend and QA)
- AC7 — "Create using Agent" and artifact card actions bind the correct Skill and artifact without browsing internal data directories or installing a duplicate Skill. (verification: renderer and Electron; owner: Frontend)
- AC8 — Preview consent, installation and Launchpad pinning are separate decisions; "Add to Launchpad" and "Not now" persist and read back. (verification: unit and renderer; owner: Frontend and Backend)
- AC9 — After three consecutive failed repair rounds, installation and publishing stop and the returned evidence includes recovery steps. (verification: unit; owner: Backend)
- AC10 — Publishing runs only on explicit user request; the hosted manifest, package and icon read back over HTTPS from the same origin without redirects, with matching digest, size and version. (verification: packaged artifact; owner: Backend)
- AC11 — A directory submission changes only the bilingual README entries and reports published, submitted and merged as separate states. (verification: docs gate; owner: Maintainer)
- AC12 — Hosts without the authoring tools get generation and packaging only, with an upgrade prompt and no claim of real testing or installation. (verification: renderer; owner: Frontend)

## Risks

- Preview isolation could leak into the installed app through a shared partition or storage root. Tests must assert distinct roots and partitions.
- Automation could reach host confirmation dialogs. Targets must expose only the bound preview page.
- A repackaged artifact could reuse an old report. Tokens are bound to SHA-256, and any repackage invalidates them.
- The scope spans four stages and touches the MiniApp runtime, install and IPC layers. Each stage must merge with its own evidence before the next starts.

Open decisions before Stage 2 starts: whether to build on #19781 or in parallel with it; whether the preview registry persists for the startup sweep or stays in memory; whether publishing runs through scripts only or through Agent-driven `gh` calls.
