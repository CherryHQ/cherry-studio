# Publishing a Mini App

Publishing runs ONLY when the user explicitly asks for it. Silent or implied publishing is out of scope.

## Before anything is uploaded

Confirm with the user, in one message: the repository owner, the license, the application id (must equal `manifest.id` and is preserved across versions), and the hosting address. The default is the user's public GitHub repository with GitHub Pages.

## Package identity

Each version publishes at a new immutable package path (for example `apps/<id>/<version>/<id>-<version>.miniapp`) — never overwrite a released path. The packaged `manifest.json` contains no `package` block. The hosted distribution manifest is the packaged manifest plus a `package` block:

```json
"package": { "url": "https://…/<id>-<version>.miniapp", "iconUrl": "https://…/apps/<id>/<version>/icon.png", "sha256": "…", "size": 12345 }
```

`update.url` is the one mutable path in the layout — it always serves the LATEST distribution manifest, and the host refuses any served manifest without it. The installer compares the update endpoint INSIDE the archive against the hosted one, so the endpoint is established BEFORE final packaging: decide the hosting address first and write the block into the source `manifest.json`, then package:

```json
"update": { "url": "https://…/apps/<id>/manifest.json" }
```

A package built without `update.url`, or with one pointing off the publishing origin, cannot produce an installable publish — generation refuses it and says what to set. A China-mirror publish declares `update.urlCn` in the same block and `package.urlCn` in the hosted manifest: both or neither. `iconUrl` is served next to the package at its immutable versioned path so the consent card can show the icon before downloading (present only when the package declares an icon). `sha256` is the lowercase hex digest of the exact `.miniapp` bytes; `size` is the byte count. Both come from `scripts/package.mjs` output for the final tested package — not a re-package after the fact. Identity (id, version, icon) is read from the manifest INSIDE the tested archive; if the source `manifest.json` has drifted from it, rebuild the package — generation and verification both refuse the divergence.

Build the hosted manifest with `node scripts/publish.mjs manifest <appDir> <out.miniapp> <baseUrl> [--out manifest.json]`. It preserves the archived `update` block verbatim, refuses a packaged manifest that already carries a `package` block, and emits the immutable path `apps/<id>/<version>/<id>-<version>.miniapp` under `<baseUrl>`. The script never uploads anything: publishing still happens only on the user's explicit request, through the confirmed repository and hosting address.

## Read-back verification

After publishing, read the hosted manifest, package and icon back over HTTPS from the same origin, following no redirects. Digest, size and version must match the final tested package. Then install the app from its public URL and verify it launches. A mismatch means the publish is broken: say so and stop.

`node scripts/publish.mjs verify <hostedManifestUrl> <appDir> <out.miniapp>` runs this gate: it fetches with redirects disabled, requires one origin for manifest, update endpoint, package and icon, requires the hosted `update.url` the installer contract mandates, rejects any divergence between the hosted update endpoints (`url` and `urlCn`) and the archived ones, checks the hosted icon block against the archived one, fetches the DECLARED hosted icon URL, and fails on any digest, size or version mismatch.

## Official directory submission

A submission to the official directory changes only the app entries in `README.md` and `README.zh-CN.md` of the directory repository — no packages, no build output. Check existing entries and open PRs first to avoid duplicates. Report "published", "submitted" and "merged" as three separate states; a submitted PR is not a merged listing.

`node scripts/check-directory-submission.mjs --files <changed-file>...` (or `--base <git-ref>`) is the docs gate: it rejects anything beyond the two root README entries, a single-language submission, and — with `--app-id <id> --readmes README.md README.zh-CN.md` — an id an existing entry already lists.
