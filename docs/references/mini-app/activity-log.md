---
description: What the host records about a mini app's behaviour — every refusal, every call that leaves the sandbox, every permission decision — and what it never records
sources:
  - src/main/features/miniApp/activityLog.ts
  - src/main/features/miniApp/runtime/MiniAppRuntimeService.ts
  - src/shared/types/miniAppActivity.ts
---

# Activity log

Cherry keeps a per-app **activity log** and shows it on the app's detail panel. It is the user's record of what your app did with the capabilities they granted. Nothing in it is yours to read or write; this page tells you what a user sees.

## What is recorded

| Kind | When | What the line holds |
|---|---|---|
| Refusal | Any `cherry.*` call that rejects — `PermissionDenied`, `RateLimited`, `QuotaExceeded`, `InvalidArgument`, `Unavailable`, `Cancelled`, `Internal` | method, outcome, duration, and — where the public name alone cannot say which failure it was — a `reason` naming the underlying error class |
| Outward call | `network.fetch`, `clipboard.read` / `write`, `file.export`, `notification.show`, `ai.chat` | method, outcome, duration, and a metadata facet: the host, status and response size of a fetch; the character count of a clipboard read or write; whether an export was saved; the model slot, message count and prompt size of a chat |
| Permission decision | Install, reinstall, update, rollback, a grant or revoke in the detail panel, newly requested permissions granted or snoozed, data cleared | the decision, the version, the leaves involved |
| Count | Every other call — `storage.*`, `file.save` / `load` / `list` / `delete`, `usage`, `app.*` — added up per method | calls, bytes moved, flushed once a minute |

## What is never recorded

No payload of any kind: no storage key or value, no file name, no message text, no notification title, no clipboard text, no request or response body. A user can share the log with support without sharing what they did in your app.

## Retention

- One file per **activity day** under Cherry's logs directory; the newest seven days with activity are kept, however old they are — an app opened once a month still shows its last session.
- 5 MB per day, after which the day's file gets one `truncated` marker and nothing more.
- "Clear data" leaves the log alone. "Clear log" on the detail panel and **uninstall** remove it.
- The panel shows the newest 100 lines and what the whole log weighs; "Open log folder" opens the files themselves, which hold everything within retention.

## For authors

A user who wonders why your app keeps hitting `PermissionDenied` will look here, so a refused call is never silent — check `cherry.app.getPermissions()` before calling, and handle the refusal in your UI instead of retrying it.
