---
title: Restore auto-restarts after completion (no manual restart button)
category: changed
severity: notice
introduced_in_pr: f58336c55c
date: 2026-07-31
---

## What changed

When a v2 restore finishes sealing, the app now **re-launches itself automatically** (main-process `application.relaunch()`) after a brief native notification, instead of showing a renderer "Restart" button the user must click. Restore progress is shown as **native OS notifications** (snapshot → merge → seal phases), replacing the in-app `RestoreV2Popup`.

## Why this matters to the user

During restore, all mutation-capable windows (Main, SubWindow, QuickAssistant, SelectionAction) are destroyed to guarantee no renderer can write to the DB mid-restore — so the in-app popup that used to host the "Restart" click can no longer be shown. The app restarts on its own once the restore is sealed. Users no longer need to click anything; the only visible cue is a native notification ("Restore complete, restarting…") followed by the app restarting.

## What the user should do

Nothing — the restart is automatic. In dev mode the app does not auto-restart; a native notification prompts the developer to restart manually.

## Notes for release manager

This completes the v2 restore write-quiesce (a1 WindowManager hold). The previous "user-confirmed relaunch" path is superseded; `BackupService.relaunchStagedRestore` is now invoked by the main process post-seal. The legacy `backup.restore_relaunch` IPC is retained as a fallback but is no longer the primary path. Related: §9 restore orchestration (`docs/references/backup/backup-architecture.md`).
