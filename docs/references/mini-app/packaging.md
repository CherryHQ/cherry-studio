---
description: Building a .miniapp archive, what the installer rejects, the install consent flow, distribution manifests, updates, rollback and uninstall
sources:
  - src/main/features/miniApp/install/archive.ts
  - src/main/features/miniApp/install/installer.ts
  - src/main/features/miniApp/install/installFlow.ts
  - src/main/features/miniApp/grants.ts
---

# Packaging

## The archive

A `.miniapp` is a plain zip. The extension exists so file pickers can filter; there is no custom container and no signature in this release.

```
mygame.miniapp
├── manifest.json     required, at the archive root
├── index.html        manifest.entry
├── icon.png          manifest.icon.path (optional)
└── assets/…          anything else your app loads
```

```sh
cd mygame
shasum -a 256 icon.png          # paste into manifest.icon.sha256
zip -r ../mygame.miniapp . -x '.*' -x '__MACOSX/*'
```

"Compress the folder" archives (`mygame/manifest.json` under one top-level directory) are accepted: when the root has no `manifest.json` and exactly one top-level directory, the installer descends once. More than one top-level directory is refused rather than guessed.

### What the installer rejects

| Condition | Limit |
|---|---|
| Archive size | > 50 MB |
| Extracted size | > 100 MB |
| Entry count | > 2000 |
| `manifest.json` | > 256 KB, missing, or failing [validation](./manifest.md) |
| Icon | > 5 MB, missing, or bytes not matching `icon.sha256` |
| `entry` / `icon.path` | Missing, or not a regular file (a directory named `index.html` is refused) |
| Symbolic links, devices, FIFOs, sockets | Any |
| A top-level `__cherry` directory | Reserved for host assets |
| Paths that resolve outside the package | Any |

Every check above runs before extraction, against the zip's entry table. Three of them run again on the extracted tree — containment, the reserved `__cherry` directory, and `entry` / `icon.path` being regular files — and the byte budget is enforced during extraction, on real bytes rather than declared ones. A refused package leaves nothing behind.

## Installing from a file

1. The user picks the `.miniapp` in Cherry's Mini Apps page.
2. The host reads the manifest and icon without extracting, hashes the file, and shows a consent card: name, description, one permission list (required leaves ticked and fixed, optional leaves ticked and yours to untick), and the network hosts.
3. Required permissions are all-or-nothing. Decline, and nothing is installed. Optional permissions start **granted**: the card shows them ticked, the user may untick any before installing, and may switch any off (or back on) later from the detail panel.
4. On accept, the host re-hashes the file, extracts, re-validates, and commits the app, its installation record and its grants in one transaction.

`update` in a file-installed package is ignored: the host has no trusted origin to pin, so it will not check the URL the package names for itself.

## Installing over an installed app

Every install entry — a file, a web address, a builtin tile, or the detail panel's "replace package" — looks the id up first. What happens is decided by **version**, never by the entry used:

| Package version vs installed | Flow | Data | Grants | Rollback snapshot |
|---|---|---|---|---|
| Higher | **Upgrade** — the update flow below, with its token and review card | Kept | Diffed: new required leaves and hosts need consent, new optional leaves are offered, revoked leaves stay revoked | Taken |
| Same or lower | **Reinstall** — the consent card says so and asks whether to delete the app's existing data (saves, files, cookies); a downgrade starts with the wipe **on** and warns when it is turned off | User's choice | Fresh consent: the full list, optional leaves ticked | None |

A reinstall keeps the launcher position, the pinned/enabled status and the model slots. The **source is re-pinned** to whatever the user just used: a file over a web install turns the app into a local one (no more online checks), a web address over a local install pins its origins (online checks start working), and a different address over a web install is how mirrors change. The card names the source change. An id that belongs to a website entry is refused.

## Distribution manifest

To ship updates, serve a **distribution manifest** at the `update.url` (and `update.urlCn`, if you provide a China accelerator) declared in the package. It is the package manifest, byte-for-byte on every overlapping field, plus a `package` block. The file may be called anything: a user installing from a web address may type the manifest's own URL or its directory — the host tries the address as typed, then `<address>/manifest.json`.

```json
{
  "...": "every field of the packaged manifest.json, identical",
  "package": {
    "url": "https://example.com/mygame/1.1.0.miniapp",
    "urlCn": "https://cdn.example.cn/mygame/1.1.0.miniapp",
    "iconUrl": "https://example.com/mygame/icon.png",
    "sha256": "<lowercase hex sha-256 of the .miniapp>",
    "size": 1048576
  }
}
```

| Rule | Why |
|---|---|
| `package` lives only here, never inside the archive | Its `sha256` is the hash of the archive that would contain it |
| `urlCn` is optional, but `update.urlCn` and `package.urlCn` go together, and a mirror must serve identical bytes | Users in China get a reachable source when you offer one; one hash covers both |
| `package.url` must be on the origin of `update.url`; `package.urlCn` on the origin of `update.urlCn` | Every declared origin is pinned at install |
| Every URL must answer directly — **redirects are refused** | `github.com` release links redirect and therefore do not work; a per-organization GitHub Pages origin does |
| `sha256` and `size` are mandatory; `size` ≤ 50 MB | The user sees what will be installed before bytes land |
| `iconUrl` is optional: the icon bytes, on a declared origin, matching `icon.sha256`, ≤ 5 MB | The consent card shows the icon **before** the package downloads; an icon that fails to fetch or verify only hides itself |

## Updates

| Trigger | Behaviour |
|---|---|
| The user opens the app | Silent check (the global "check for updates when opening" preference, on by default; local packages are never checked); an available update is offered, never applied |
| "Check for updates" in the detail panel | Same, on demand |

An available update lights a dot on the app's tile; hovering the icon says which version, the tile's context menu offers "Update to …", and the detail panel shows a "new version" chip next to the version. All three open the same review dialog. There is no background polling and no silent install.

| Rule | Detail |
|---|---|
| Version | Only a strictly greater semver is an update. Same version with different content is "already up to date" — bump the version. **Builtin apps are the exception**: their tree ships inside the signed Cherry release rather than arriving from a server, so the tree hash is the signal and changed bytes are applied whatever the version says. Bump it anyway — the host logs an error when you do not |
| Origins | An update cannot add, remove or change the **origin of** `update.url` / `update.urlCn`; a different path on the same origin is followed. Changing hosts, or adding a mirror later, means installing over the app from the new address (see above) |
| Manifest consistency | The distribution manifest and the manifest inside the downloaded archive must agree on every shared field, including both `update` URLs |
| Permission growth | Newly required leaves — including an optional leaf promoted to required — and newly declared hosts are shown and need consent. Newly optional leaves are shown ticked, may be unticked, and never block |
| `releaseNotes` | Plain text, rendered below the permission diff |
| During the update | The download runs with the app still usable — the tile dims its icon behind a progress wedge, the menu and the detail panel read "Updating…", and a second update of the same app is refused until this one finishes. The swap itself quiesces the app: instances are closed and calls reject `Unavailable` ([Lifecycle](./lifecycle.md#quiesce)); the review dialog says so before you confirm |
| Data | `cherry.storage` and `cherry.file` are untouched by an update |

## Rollback

After an update the host keeps one snapshot of the previous version. The user can roll back from the detail panel; the files, manifest, name, icon and grants return together to the previous version. A decision the user made after the update (revoking a permission both versions declare) is preserved — rollback restores code and declarations, not the user's choices or where the app came from: an upgrade that re-pinned the source leaves it pinned. Rollback consumes the snapshot; a second rollback is not possible until the next update.

## Uninstall and clear data

| Action | Removes |
|---|---|
| Clear data | `cherry.storage`, `cherry.file`, cookies and caches of the app's session; the package and the grants stay |
| Uninstall | All of the above plus the package, grants and installation record |

Both quiesce the app first.

## Official apps

`com.cherrystudio.*` is reserved. Packages using it are only accepted from Cherry's own origins or as builtins bundled with the host, and official apps live under `com.cherrystudio.miniapp.*`. Builtins update with the host, through the same update flow.
