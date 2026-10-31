# Website documentation

Edit public guides in `content/`, including the matching Chinese and English pages, images, and each language's `SUMMARY.md`. Keep relative paths and existing article anchors stable. Desktop feature PRs can include these changes alongside their code. Contributors can also edit the same content in `CherryHQ/cherry-studio-website`.

The website owns the Fumadocs application and deployment. This directory contains its editable content, not another rendering application. Repository `docs/dev/` describes development and architecture.

```sh
pnpm website-docs:dev    # http://localhost:3001/docs/zh-cn/
pnpm website-docs:check # generation, source issues, links and navigation
pnpm website-docs:build # also export the documentation pages
```

These commands use the website revision recorded in `scripts/websiteDocs/config.json`, with its own package manager and lockfile, inside the disposable `.context/website-docs-renderer/` checkout. Local uncommitted and untracked content is included. Do not edit that checkout or its generated output. Save content here instead. Update the renderer revision explicitly when introducing syntax that needs a newer website renderer.

Shared paths map to the website's `docs-site/`: `content/`, `locales.json`, `page-aliases.json`, and the optional legacy `shadowed-baseline.json`. This README and `AGENTS.md` are local instructions. Website source code, generated search data and deployment configuration do not synchronize.

Synchronization creates reviewable PRs after main-branch edits. It does not auto-merge or publish desktop changes. Read [the synchronization runbook](../../scripts/websiteDocs/README.md) for setup, conflicts, pauses and recovery. Until its App and baseline are configured, both copies remain local to their repositories and no automatic propagation occurs.
