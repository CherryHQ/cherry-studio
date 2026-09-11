---
title: iFlow CLI replaced by Qoder CLI in Code Tools
category: removed
severity: notice
introduced_in_pr: #16119
date: 2026-06-17
---

## What changed

The **iFlow CLI** option was removed from Code Tools, and a new **Qoder CLI** option was added in its place. iFlow CLI was officially discontinued upstream (service shut down on 2026-04-17), with Qoder as the vendor's recommended migration target.

## Why this matters to the user

Users who previously selected iFlow CLI will no longer find it in the Code Tools CLI list, and its per-tool settings (model, environment variables, directories) are no longer shown. Qoder CLI appears as a new choice. Like GitHub Copilot CLI, Qoder CLI authenticates with its own Qoder account (via `/login`) instead of a Cherry Studio provider/model, so it does not require selecting a provider or model.

## What the user should do

Switch to Qoder CLI or another supported Code CLI. iFlow CLI is discontinued upstream and can no longer be used regardless of this change — nothing else to do.

## Notes for release manager

- iFlow CLI npm package `@iflow-ai/iflow-cli` reached EOL 2026-04-17; the vendor's official migration path is Qoder.
- Qoder CLI integration installs npm `@qodercn-ai/qoderclicn` (CN edition) and runs `qoderclicn`.
- Qoder ships an ESM bundle that Bun cannot execute, so Cherry Studio launches it directly via its `#!/usr/bin/env node` shebang. **Qoder CLI therefore requires Node.js (>=20) on the user's PATH**, unlike the other CLIs that run on Cherry Studio's bundled Bun.
