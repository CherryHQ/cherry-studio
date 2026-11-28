---
name: cherry-miniapp
description: Author, validate, package and publish a Cherry Studio Mini App (.miniapp). Use when the user wants to create a Mini App from a natural-language request, test it under the real MiniApp runtime, install it, or publish it to a public repository.
---

# Cherry MiniApp authoring

Take a Mini App from a requirement to a validated, packaged `.miniapp`, then (with host support) preview, install and publish it.

## Workflow

1. **Draft the contract.** Read `references/contract.md` before writing any file. Copy `assets/template/` as the starting point, keep the `id` reverse-DNS unique, and declare the smallest permission set that does the job. `assets/cherry.d.ts` is the guest API surface — every `cherry.*` call the app makes must exist there.
2. **Validate.** Run `node scripts/validate.mjs <appDir>` from this skill's directory. It checks the manifest against the packaged contract and rejects assets that reference a development server. Fix every finding in the app, never in the validator.
3. **Package.** Run `node scripts/package.mjs <appDir> <out.miniapp>`. It validates first, then builds a deterministic ZIP and prints its SHA-256 and size as JSON. See `references/testing.md` for what "tested" means at each host capability level and for the three-round repair limit.
4. **Preview, install, publish.** Only when the host exposes the authoring tools (`mini_app`, `miniapp-browser`, `mini_app.authoring.*`). Without them, deliver the package and say plainly that no real-runtime testing or installation happened. Publishing follows `references/publishing.md` and runs only on explicit user request.

## Rules that are not negotiable

- Preview consent, installation and Launchpad pinning are three separate user decisions; never bundle them and never approve them through automation.
- A repackaged artifact invalidates earlier validation: tokens and reports are bound to the package SHA-256.
- At most three consecutive automated repair rounds; after the third failure stop, and return the evidence plus recovery steps.
- The packaged manifest never contains `package`; the distribution manifest adds `package.url`, `package.sha256` and `package.size` outside the archive.
