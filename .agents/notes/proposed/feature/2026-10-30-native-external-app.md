# Agent Note: Native file association discovery

Status: proposed

English | [中文](2026-10-30-native-external-app.zh.md)

## Problem

File open menus enumerate a fixed editor list, so installed applications associated with a file are missing. Protocol registration does not establish file compatibility.

## Proposal

Compile a Node-API addon per platform under `native/external-app/`, without a workspace package. Keep TypeScript loading and policy in `src/main/services/externalApp/`. The user approved this ownership and implementation direction in the development conversation.

Use NSWorkspace on macOS, Shell association handlers on Windows, and GIO on Linux for both discovery and launching. Call asynchronous Node-API functions from Main; discovery and launching execute off the JavaScript thread. Return opaque application IDs to the renderer; re-enumerate before launching. Preserve per-file default metadata, distinct installations, and the existing directory targets. Dangerous extensions retain only controlled editors and the file manager. Discovery failures retain default-open and reveal actions without inventing compatibility.

Return application icons as PNG data URLs using NSWorkspace, Windows Shell resources/AppsFolder with WIC, and Linux GTK theme lookup with GdkPixbuf. Linux icon resolution runs on the host's main thread and reuses its loaded GTK 3 or GTK 4 library; linking a different GTK major version can crash Electron. Icon failures preserve the application and its launch action.

## Alternatives considered

- A larger hardcoded application catalog still misses associations and advertises unsupported files.
- A workspace package adds an independent JavaScript build and exports without another consumer.
- Parsing registry commands or desktop Exec fields duplicates platform launch semantics.

## Acceptance criteria

- AC1 — Ordinary files list system-associated applications, deduplicated by identity with a single default presentation; same-named installations remain distinct (verification: unit and native smoke)
- AC2 — Selected applications open through platform APIs; stale or forged identities cannot launch arbitrary executables (verification: unit and native smoke)
- AC3 — Dangerous files preserve controlled-editor restrictions and directory targets retain their current behavior (verification: unit)
- AC4 — Host development and target packaging build and locate the correct addon, including resource unpacking (verification: scripts and packaged artifact)
- AC5 — macOS, Windows and Linux enumerate real associations and successfully open a fixture using a selected handler (verification: platform native smoke and Electron)
- AC6 — Application artwork survives the native and IPC boundaries; Windows resource indices and Linux theme/absolute icons resolve correctly, while missing icons preserve handlers (verification: platform icon smoke and Electron menu)

## Risks

System registrations describe declared support, not parsing correctness. Linux enumeration follows the current desktop's XDG registrations and visibility rules. Build hosts need platform SDKs; Linux release artifacts build in Ubuntu 22.04 containers with QEMU for foreign architectures. Native crashes affect the hosting process. Native launch success does not prove that the destination application rendered the document. Keep the note proposed until platform and packaged acceptance are complete.
