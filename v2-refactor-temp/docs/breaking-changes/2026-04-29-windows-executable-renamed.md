---
title: Windows executable renamed to CherryStudio.exe (no space)
category: changed
severity: breaking
introduced_in_pr: 82b841776
date: 2026-04-29
---

## What changed

On Windows, the installed application's binary is now `CherryStudio.exe` instead of `Cherry Studio.exe`. The product display name remains `Cherry Studio` everywhere users see it — desktop shortcut, Start menu entry, install directory, window title, the Apps & Features list, and the uninstaller — those are unchanged. Linux already used the no-space convention; this change brings Windows into the same shape. macOS is unaffected.

## Why this matters to the user

After upgrading from v1.x to v2.x on Windows, the on-disk file at `C:\Program Files\Cherry Studio\Cherry Studio.exe` is replaced by `C:\Program Files\Cherry Studio\CherryStudio.exe`. The NSIS installer rebuilds the desktop shortcut, the Start menu entry, and the `cherrystudio://` protocol registration to point at the new file, so most users notice nothing.

Users who pinned the old path manually in places the installer cannot reach will see stale references that no longer launch the app. Typical places: Windows Task Scheduler entries, third-party startup managers, firewall / antivirus allow-lists pinned by file path, AutoHotkey or other input-remapper scripts, and any custom `.bat` / `.lnk` they made themselves. The in-app **selection-tool application filter list** also matches by `.exe` name — users who added their own Cherry Studio entry there must update it.

## What the user should do

Most users: nothing — automatic.

If you manually pinned the old `Cherry Studio.exe` path outside the installer's reach, update each reference to `CherryStudio.exe`. Common spots to audit:

- Windows Task Scheduler / startup folder shortcuts you created yourself
- Firewall, antivirus, or endpoint-protection allow-lists keyed by absolute path
- AutoHotkey, PowerToys, or other input-remapping scripts targeting Cherry Studio
- Custom `.bat` files or shell aliases launching Cherry Studio
- The selection-tool **application filter list** inside Cherry Studio settings, if you previously added a `Cherry Studio.exe` entry by hand

## Notes for release manager

- Frame this as "Windows aligned with Linux on the no-space convention." The `productName` is unchanged on every platform, so it is purely a file-on-disk rename, not a rebrand.
- The in-app filter-list **example placeholder text** was updated in the same commit, so any user newly writing a filter sees the correct name. Only existing user-saved filters need updating.
- The `cherrystudio://` URL scheme is unchanged — protocol-handler users are not affected.
- macOS `.app` bundle (`Cherry Studio.app`) and its internal Mach-O are unchanged.
- Worth a short call-out in the upgrade-checklist section of the v2 release note for power users who run Windows.
