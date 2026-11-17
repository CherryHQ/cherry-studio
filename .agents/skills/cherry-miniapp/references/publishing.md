# Publishing a Mini App

Publishing runs ONLY when the user explicitly asks for it. Silent or implied publishing is out of scope.

## Before anything is uploaded

Confirm with the user, in one message: the repository owner, the license, the application id (must equal `manifest.id` and is preserved across versions), and the hosting address. The default is the user's public GitHub repository with GitHub Pages.

## Package identity

Each version publishes at a new immutable package path (for example `apps/<id>/<version>/<id>-<version>.miniapp`) — never overwrite a released path. The packaged `manifest.json` contains no `package` block. The hosted distribution manifest is the packaged manifest plus:

```json
"package": { "url": "https://…/<id>-<version>.miniapp", "sha256": "…", "size": 12345 }
```

`sha256` is the lowercase hex digest of the exact `.miniapp` bytes; `size` is the byte count. Both come from `scripts/package.mjs` output for the final tested package — not a re-package after the fact.

## Read-back verification

After publishing, read the hosted manifest, package and icon back over HTTPS from the same origin, following no redirects. Digest, size and version must match the final tested package. Then install the app from its public URL and verify it launches. A mismatch means the publish is broken: say so and stop.

## Official directory submission

A submission to the official directory changes only the app entries in `README.md` and `README.zh-CN.md` of the directory repository — no packages, no build output. Check existing entries and open PRs first to avoid duplicates. Report "published", "submitted" and "merged" as three separate states; a submitted PR is not a merged listing.
