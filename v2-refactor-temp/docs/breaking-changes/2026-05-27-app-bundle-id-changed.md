---
title: App identity changed on macOS — re-grant permissions and re-link external services
category: platform
severity: breaking
introduced_in_pr: 4439d3b28
date: 2026-05-27
---

## What changed

The application's macOS bundle identifier was renamed from `com.kangfenmao.CherryStudio` to `com.cherryai.CherryStudio` as part of the v2 identity rebrand. The user-visible `productName` (`Cherry Studio`) is unchanged on every platform, and so is the `cherrystudio://` URL scheme name itself.

User data is preserved automatically. Electron's `userData` directory is keyed by `productName` (`~/Library/Application Support/Cherry Studio`), not by bundle id, so v1's SQLite database, preferences, and cache files are picked up by v2 on first launch without any migration step.

However, **macOS identifies applications by bundle id, not by name**. The new bundle id means the operating system treats v2 as a different application from v1 — every per-app state the OS keeps in the TCC privacy database, Keychain, LaunchServices, and the notification center is scoped to the old bundle id and does not carry over to v2.

This is a macOS-only impact. Linux uses package-manager identity and is unaffected. Windows uses NSIS install paths and AppUserModelID, both addressed separately in `2026-04-29-windows-executable-renamed.md`; the only Windows-side effect of this change is a one-time taskbar grouping reset under the new AppUserModelID.

## Why this matters to the user

After the first launch of v2 on macOS — whether arrived at via in-place auto-update or a fresh install — every capability listed below resets to its unconfigured state. **None of this is recoverable in code**: Keychain encryption, TCC authorizations, and protocol-handler registration are all bundle-id-scoped at the OS level, and there is no API for one app to read another app's Keychain or transfer another app's TCC grants.

| What stops working | Why | Where the user notices |
|--------------------|-----|------------------------|
| `cherrystudio://` URL scheme | LaunchServices registers protocol handlers by bundle id; v2 needs to claim the scheme fresh | OAuth callbacks (provider sign-in, Anthropic OAuth, CherryIn OAuth) fail to return to the app; deep links like `cherrystudio://navigate/...` and `cherrystudio://mcp/install?...` either open the browser's "no handler" page or land in v1 until macOS picks v2 as the default handler |
| Accessibility (Trusted Process) | TCC keys authorizations by bundle id; the new app is unrecognized | The selection-popup toolbar (`selection-hook`) silently does nothing; System Settings → Privacy & Security → Accessibility shows no Cherry Studio entry until the user re-grants it |
| GitHub Copilot token | Persisted via `safeStorage.encryptString` into the macOS Keychain, which is access-controlled by bundle id | The Copilot integration cannot decrypt the saved token under the new identity; the user is prompted to re-run the device-flow login |
| Notification permission | macOS notification center scopes per bundle id | The first notification triggers the "allow notifications from Cherry Studio" prompt again, even if the user previously allowed it for v1 |
| Login Items (launch at login) | `app.setLoginItemSettings` registers the binary by bundle id | If the user had launch-at-login enabled, the entry under System Settings → General → Login Items is now missing |
| Documents / Downloads access | TCC folder permissions are bundle-id-scoped | First read from `~/Documents` or `~/Downloads` triggers the macOS authorization dialog again |

The camera and microphone usage descriptions are declared in `Info.plist`, but the current codebase does not actually call those APIs, so users will typically not see those prompts.

## What the user should do

User data (chat history, assistants, knowledge bases, preferences) is preserved automatically — no manual migration step is required for the database side.

On macOS, you will need to redo the following the first time you launch v2:

1. **Re-enable Accessibility for the selection toolbar.** System Settings → Privacy & Security → Accessibility → toggle Cherry Studio back on. Without this, the selection-popup toolbar will appear inert.
2. **Allow notifications when prompted.** Or proactively enable them under System Settings → Notifications → Cherry Studio.
3. **Re-add Cherry Studio to Login Items**, if you were using launch-at-login. System Settings → General → Login Items.
4. **Sign back into GitHub Copilot.** Settings → Code Tools → Copilot → run the device-flow login again. The previously cached token cannot be decrypted under the new bundle id.
5. **Re-do any external OAuth flows.** Provider OAuth, Anthropic OAuth, and similar integrations will ask you to sign in again on first use, because the redirect endpoint now belongs to a different macOS application identity.
6. **Allow folder access on the first prompt.** When the app first reads from `~/Documents` or `~/Downloads`, accept the macOS authorization dialog.

If a `cherrystudio://` link opens v1 (the old install) instead of v2 after upgrading, right-click the link → Open With → choose v2 once, or open System Settings → Default Apps and reassign the `cherrystudio` scheme to v2; LaunchServices then remembers the choice.

## Notes for release manager

- **Auto-update has a real risk of being rejected on macOS** and must be smoke-tested before v2 is promoted to the general release channel. `electron-updater` on macOS delegates to Squirrel.Mac, which validates the incoming `.app` against the running app's designated requirement (DR). Apple's default DR typically embeds the bundle id (`identifier "com.kangfenmao.CherryStudio" and anchor ...`), so the v1 → v2 replacement can fail with `code signing verification failed` even when both builds use the same Apple Developer Team ID. The `verifyUpdateCodeSignature: false` option in `electron-builder.yml:90` is under the `win:` block and **does not affect macOS**. To smoke-test: take a published v1 `.app`, point its update feed at a staging URL serving a freshly built and notarised v2 zip, trigger the update, and watch `Console.app` for `com.apple.SquirrelMac` errors. Run `codesign -dvvv` on both `.app`s and diff the `designated =>` line to confirm whether bundle-id mismatch is the rejection cause.
- If the smoke test shows Squirrel rejects the update, a **transition release** is required: a final v1.x build (keeping the old bundle id) whose only behavioural change is to prompt users to download v2 manually from the website, abandoning the auto-update channel for this hop. An alternative is signing v2 with a custom designated requirement that anchors only on Team ID and certificate (not on bundle id) — feasible but more involved, requiring re-notarisation and careful entitlements handling.
- When aggregating notes for the Chinese release post, the six-row "What stops working" table is the user-facing checklist — translate it as a numbered step list, because users will hit each item in sequence after upgrading. Emphasise up front that **chat history and assistants are preserved**: "the app forgot all my permissions" reads as data loss to non-technical users and they will worry about losing their data otherwise.
- Related commit: `4439d3b28` (`chore(app-identity): rebrand bundle id to com.cherryai.CherryStudio`).
