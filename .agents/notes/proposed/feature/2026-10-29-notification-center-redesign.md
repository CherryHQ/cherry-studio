# Agent Note: Notification center drawer and task result presentation

Status: proposed

English | [中文](2026-10-29-notification-center-redesign.zh.md)

## Problem

The notification entry should follow the account area introduced by [#23043](https://github.com/CherryHQ/cherry-studio/pull/23043). The closed [#21772](https://github.com/CherryHQ/cherry-studio/pull/21772) and [#21884](https://github.com/CherryHQ/cherry-studio/pull/21884) contain reusable notification storage, announcement polling and task-result behavior. Their toolbar popover, numeric badge, category tabs and detailed task rows do not match the intended presentation. Those PRs stay closed; new implementation PRs reuse their relevant changes.

Users need one quiet inbox, a reachable unread indicator and a short answer to who finished or failed. They should open the original conversation or task for details. Returning to the app should also refresh official announcements without creating concurrent requests.

## Proposal

### Delivery and ownership

The dependency chain is `#23043 → Spec → notification center → task results → list refinement`. This Spec changes documentation only. Every implementation layer requires approval of the current Spec head. Keep the note proposed in the intermediate layer; the final layer records actual evidence for every AC before moving the bilingual triplet to implemented.

| Layer | Responsibility | Acceptance criteria |
|---|---|---|
| Notification center | Entry, unread dots, drawer, unified list, existing notification storage and official announcements | AC1–AC10 |
| Task results | Compact task presentation, runtime outcomes, delivery policies and result navigation | AC11–AC14 |
| List refinement | Drawer inset, title-line row layout, clamped previews, immediate dismissal, clear read and scroll-edge fade | AC15–AC20 |

The account-menu behavior remains owned by [Account menu cache and interaction](../../implemented/bug-fix/2026-10-29-account-menu-cache.md). This proposal adds the notification entry beside that experience; it does not redesign account actions.

The approved implementation separates business producers from delivery. `ConversationNotificationService` owns AI completion, unsuccessful-outcome and approval subscriptions; `UsageBudgetNotificationService` owns usage subscriptions, daily thresholds and budget cycles. Both depend on `NotificationService`. That service owns notification preferences, foreground policy, persistence calls and delivery, and depends only on `ConversationNavigationService` among WhenReady services. `notificationActivation.ts` owns target validation and navigation. `NotificationRecordService` remains the durable record and consumption owner.

Scheduled outcomes come from the existing awaited `agentTaskJobHandler.onSettled` hook through `agentTaskNotification.ts`. The adapter reads the committed terminal job and schedule, then supplies a complete result to `NotificationService.publishTaskResult`. An explicit `AgentTaskOutput.kind` distinguishes `executed` from `skipped`; completed skipped runs do not produce success notifications. Stream completion and unsuccessful events both respect the result owner captured at registration, even after its listener is removed. Ordinary conversation success retains its turn/batch identity, and unsuccessful outcomes retain their attempt identity.

`AgentJobsService`, `AutoBackupService` and `AppUpdaterService` declare their notification dependency. JobManager remains generic and retains its existing shutdown settlement wait; no notification-specific dependency or new event bus is added. Result persistence remains callable after notification subscriptions stop, while BeforeReady data services remain available through stop. Shutdown deadlines and native delivery failures still apply; this does not introduce crash replay, an outbox or exactly-once OS delivery.

### Entry and unread indicator

- Remove standalone settings and notification buttons from the sidebar. Keep Settings in the existing account menu. The notification entry is the account-menu row labeled “Notifications” (“通知” in Chinese), with a bell on the left and a chevron on the right. Do not keep a standalone notification fallback in the tab bar.
- Show a small red unread dot on both the account trigger and the notification row, before its chevron, whenever the shared unread count is positive. Show no numeric badge. Opening the account menu or drawer does not mark notifications read; reading, mark-all-read and dismissal refresh both indicators through the existing unread-count owner.
- Full, icon-only and temporarily revealed hidden sidebars use the same account-menu entry and the same drawer. A temporarily revealed sidebar must not mount another drawer or duplicate notification subscriptions.
- Keep accessible labels for the notification entry and unread state. Unread rows use a semibold foreground title and an accessible unread description, with no visible Unread label. Read rows use a normal-weight muted title while body text remains readable. Reuse the unread-count API and provider state; do not introduce another counter or request owner.

### Left drawer

Use the existing [Drawer primitive](../../../../packages/ui/src/components/primitives/drawer.tsx). Add an optional overlay control with the existing behavior as its default. The notification drawer uses non-modal behavior without a dark overlay; other consumers keep their current behavior.

The drawer slides in from the left and overlays content without changing the chat layout width. It floats inside the adjacent content panel: its top edge and its docked side start 6px inside the panel's, and its bottom edge ends 6px above the panel's, on every platform. With a visible sidebar the panel starts at the sidebar's right edge; with a hidden sidebar it starts at the window's left edge. Keep the window's top controls accessible. Default width is 384px, capped by the available content width. Clip the slide animation at the sidebar boundary so it never covers the sidebar. Use an 8px corner radius, concentric with the content panel’s 12px radius across the 6px inset. The header stays visible while the list scrolls independently to the bottom of the drawer.

The header contains the notification title, mark-all-read and clear-read icon actions, and a collapse-panel icon distinct from the per-row X delete icon. Both bulk actions carry a tooltip and an accessible label. Row deletion uses the fixed tooltip and accessible label “Delete this notification”. Do not render a footer or history-retention notice; the existing 30-day data-retention policy remains unchanged. Selecting Notifications closes the account menu and opens the drawer. When handing focus to the drawer, suppress the menu’s automatic return to the avatar so it cannot immediately dismiss the new drawer. Outside interaction or Esc closes the drawer. An outside click can continue to its underlying control; there is no invisible modal barrier. Opening moves focus to the drawer itself rather than its first header action, so no tooltip opens unprompted. Keyboard dismissal returns focus to the currently visible account trigger, including after a sidebar layout change. Honor reduced-motion preferences.

Each main window owns one drawer and one open/requested-notification state. The account-menu entry and account-trigger unread indicator share that state. A `notification.open` event opens the same drawer and reveals its requested record without duplicating it or breaking time order. Layout changes while open reposition the drawer instead of resetting its list. Opening the account menu dismisses the drawer through the normal outside interaction.

### One notification list

Remove the All, System, Usage and Official tabs and their filter state. Fetch the existing paginated list without a category parameter and retain descending creation-time order. Do not add replacement grouping headings or category chips. Internal categories and category preference switches remain available for delivery policy.

Retain pagination, load more, mark all read, per-row dismissal, loading, empty state, failed-load retry and unavailable-target feedback, and add clear read. Opening the drawer alone does not mark rows read. Keep the current activation rules: content rows mark read when opened; task rows mark read through activation and navigate to their target. Dismissing a row must not also activate or expand it. Place dismissal beside the row's information, without reserving a separate full-height column. Each row is a title line above its body, with no separate time-and-icon line. The title line starts with the system, usage, official or scheduled-task type icon at tertiary emphasis, continues with the primary name, and ends with the right-aligned time; keep Agent and Assistant avatars immediately after their source names. The body aligns to the row’s left edge. Hovering a row or focusing its dismissal control shows that control in place of the time. Title and body share the 14px body size; weight and foreground role carry the hierarchy. Rows have no separators; spacing and the hover surface distinguish them. Expanded release details and announcement links use the same content alignment. Unread dots must not shift the content.

Per-row dismissal collapses the row within 150ms and does not wait for the write. A failed write restores the row and reports the error. Clear read dismisses every read notification in one write and keeps unread ones; because it never removes an unread notification it needs no confirmation. It uses the same soft dismissal and 30-day retention as per-row dismissal.

While rows are hidden above or below the visible list, fade the list at that edge over at most 40px, in proportion to the hidden distance. Use a mask on the list, not a blur or an overlay, and keep scroll position out of component state so scrolling does not re-render rows.

Official announcements remain literal plain text with line breaks. A collapsed preview is clamped to two lines with an ellipsis and expands inside the same row; do not insert a second copy. Existing optional HTTPS source links appear only when expanded. API announcements do not fabricate a URL. Release notes keep Markdown and the existing update action. Backup and usage notices retain their meaningful content.

### Compact task rows

Apply the same compact layout to Agent, Assistant and scheduled-task rows, including successful batches and failed, cancelled or interrupted outcomes. This change applies only inside the drawer. Application toasts, operating-system notifications and their delivery settings retain their current presentation.

| Row | Icon | Primary name | Result |
|---|---|---|---|
| Agent | Agent avatar | Agent name | Brief reply preview on success; otherwise Completed, Failed, Cancelled or Interrupted |
| Assistant | Assistant avatar | Assistant name | Brief reply preview on success; otherwise Completed, Failed, Cancelled or Interrupted |
| Scheduled task | Task icon | Scheduled-task name | Completed, Failed, Cancelled or Interrupted |

Show the icon, primary name, result and time. Use one identity icon rather than adding a second generic category icon. Resolve identity through the existing entity APIs; if unavailable, use an existing saved identity/name where valid, then the default source name and icon. A deleted source must not make the row disappear. Do not parse display text to recover identity.

Successful Agent and Assistant rows show the existing brief reply preview, excluding the conversation-name prefix. Keep the existing preview length, clamped to two lines with an ellipsis; fall back to Completed when no reply is available. Scheduled-task rows retain status text. Hide conversation titles, detailed errors, elapsed duration and successful-batch counts. Keep those stored values unchanged for target pages and other delivery surfaces. Long names and titles truncate; while truncated, their full value is available on hover or focus, and an untruncated one shows no tooltip. Show local time for today's records and a short local date plus time for older records; do not show a timestamp tooltip. Keep a full timestamp accessible to assistive technology. Failed, cancelled and interrupted outcomes retain status text so color is not the only signal. Failure/interruption can use the existing error color, without coloring the entire card.

Clicking a task row keeps the existing navigation contract: a message anchor locates that message, an explicit end target opens the end, and a missing anchor falls back to the end after history loads. Scheduled results open task details with the saved error summary. A missing or deleted target reports that it is unavailable instead of creating a replacement conversation.

### Official announcement refresh

Keep the startup delay of five seconds after all services are ready. After each completed poll, including failures, choose a fresh random delay of 27–33 minutes (30 minutes ±10%). Polling continues in the background. A background-to-foreground transition checks immediately only when at least five minutes have elapsed since the last poll started, including failed polls. Changing the application language still cancels the old session and checks immediately. The initial startup focus is not an extra transition; switching Cherry Studio windows, tabs, account menus or the notification drawer is not an app foreground transition.

Observe application focus in the main process and aggregate it at app level. Only a transition from no focused Cherry Studio application window to a focused one requests a poll. Coalesce transient blur/focus events during an internal window handoff. Do not create one polling timer or one network request owner per renderer.

Timer and foreground triggers use one request entry point. If a poll is already running, that poll satisfies the new trigger; do not overlap or queue another copy. Starting a foreground poll replaces a pending timed check. When the poll finishes, schedule the next check with a new random delay. Foreground transitions inside the five-minute cooldown do not request or queue a poll and do not postpone the existing timer. The cooldown survives preference reconfiguration; explicit language changes bypass it.

Disabling announcements or stopping the service removes the focus subscription, cancels the request and timer, and invalidates the old session. Old results cannot write notifications or schedule a replacement timer. Re-enabling uses the existing startup scheduling and recent-history rules.

Keep the public endpoint `https://api.cherry-ai.com/api/announcements` and Electron `net.fetch`. Community clients, including both global and China editions, request `product=community`; map Windows/macOS/Linux to `windows`/`macos`/`linux`. Resolve the current `app.language` preference (or application locale): Chinese locales request `language=zh`, all other locales request `language=en`. The API returns only the selected translation as `title/content`, never a bilingual payload, and excludes announcements without that translation. Language changes cancel stale requests and immediately refresh the new language without a second polling owner. Validate product, platform, language and offset-aware RFC3339 timestamps before persistence. Enterprise and mobile clients are outside this integration.

Send no login, signature or management credentials. Each round starts at offset zero with pages of 100, a 15-second timeout per request and the last 30 days of publications; records exactly at the retention boundary are expired. Existing records are not a pagination stopping condition. Stop at an expired record, the total or an empty page. Keep the original `published_at` string, including fractional seconds, in `announcement:api:${JSON.stringify([id, published_at])}`; parsed time only serves ordering and retention. A live correction or language change updates the same local row's title, summary and full content while preserving read/dismissed state and notification identity. Unchanged duplicates do not emit data changes. Unpublication retains local history; republication with a new timestamp creates a new event. Failure ends the round and retains saved history; a later poll retries unsaved records.

### Reuse and compatibility

Reuse the closed implementations' single notification table, list/detail/read APIs, preferences, SQLite deduplication, scheduler and navigation. This proposal adds no table beyond that notification table, no dependency and no enterprise-edition detection. The notification center and task results layers add no DataApi endpoint; the list refinement layer adds exactly one, `POST /notifications/dismiss-read`, for clear read, with no table or migration. It does not remove internal notification categories or settings. When transplanting the old code, generate any required notification-table migration after the verified base's migrations; do not restore obsolete draft migration numbers.

Keep the existing task-result contract: publish durable outcomes after terminal listeners or committed job settlement, preserve stable result identities and persist consumption with the optional notification. Scheduled tasks own publication so stream and job events cannot double-notify. Approval waits are not failures; confirmed user stops are cancelled and other interrupted runs do not become successful output. Foreground success is silent; existing read-state, background notification and sound policies remain unchanged. Do not reintroduce context-capacity notices or add task-dashboard coupling, terminal-event replay or crash recovery.

### Validation approach

The Spec PR runs documentation, translation-pairing and scoped formatting checks only. No product behavior is implemented or accepted by those checks. Each implementation layer runs explicitly filtered existing tests plus focused regressions for its ACs, affected type/lint/translation checks and Windows development-window checks in light and dark themes. The list refinement layer also checks a macOS development window, where the titlebar inset differs from Windows. Use real SQLite fixtures for persistence, controlled focus events for polling and local content fixtures for the drawer. Do not create live announcements. Report native platform and real-provider verification limits accurately.

## Alternatives considered

- Keep the toolbar popover and numeric badge: retains the separated entry and visual noise this design removes.
- Use a right drawer, a dark modal overlay or a layout-pushing panel: conflicts with the selected left-side, non-modal interaction.
- Keep category tabs or replace them with groups: makes users choose a bucket instead of scanning one ordered inbox.
- Retain detailed task errors and duration in every row: obscures the source and outcome; details remain available at the destination.
- Simplify toasts and OS notifications at the same time: expands beyond the selected drawer-only change.
- Fetch from every renderer focus event or add a second announcement cache: duplicates ownership and weakens cancellation/deduplication guarantees.
- Combine all implementation into one PR: loses the requested separation between notification-center behavior and task-result integration.
- Keep the drawer flush with the content panel at its 12px radius: both surfaces share one color, so the coinciding top and bottom edges read as a misaligned outline instead of a floating layer. On macOS the drawer also sat 3px below the panel's top edge.
- Keep the time and type icon on a line below the body: costs one line per row and separates the time from the title it qualifies.
- Keep faded previews: the fade dims the whole second line, which reads as low-contrast text rather than as truncation.
- Blur the list at its scroll edges: a masked backdrop blur renders a visible band under the header and escapes the drawer's rounded clipping in Chromium.
- Offer clear all with a confirmation: removes notifications the user has not seen. Clear read never does, so it needs no confirmation.
- Put the bulk actions in an overflow menu or keep them as text buttons: a menu adds a step to each action with no keyboard shortcut to offset it, and two text buttons crowd the header in long locales.

## Acceptance criteria

- AC1 — The sidebar has no standalone settings or notification button; Notifications is available in the account menu in full, icon and revealed hidden layouts, with a right chevron and no duplicate tab-bar bell. (verification: renderer and Windows; owner: notification center)
- AC2 — Positive unread counts show only a red dot on the account trigger and menu entry; zero clears both, opening either overlay does not mark read, and unread rows retain an accessible unread description and brighter semibold titles while read titles become gray, without a visible Unread label, without numeric badges. (verification: renderer; owner: notification center)
- AC3 — The left drawer has no dark or blocking overlay, overlays rather than resizes chat content, respects sidebar/top-control boundaries and fits narrow windows in both themes. (verification: Windows; owner: notification center)
- AC4 — The menu-to-drawer focus handoff keeps the opened drawer visible; outside interaction and Esc close it, keyboard focus returns to a visible account trigger, and layout or IPC opening never duplicates the drawer or records. (verification: renderer and Windows; owner: notification center)
- AC5 — Mixed notification types share one descending-time list without category requests/tabs/groups; paging, retry, empty state and requested-record reveal preserve that order. (verification: renderer; owner: notification center)
- AC6 — Opening the drawer leaves read state unchanged; activation, mark-all-read and dismissal retain their distinct behavior and survive restart without duplicating records. (verification: renderer and real SQLite; owner: notification center)
- AC7 — Announcement HTML/Markdown remains literal, line breaks and in-place expansion survive, repeated expansion of a read record causes no repeated read write, and release notes retain their update behavior. (verification: renderer and Windows; owner: notification center)
- AC8 — Startup checks after five seconds and subsequent checks 27–33 minutes after completion continue in the background; true foreground transitions respect a five-minute cooldown since the last poll started, internal window/tab changes do not poll, and language changes check immediately. (verification: main with controlled scheduler/focus events; owner: notification center)
- AC9 — Overlapping timer/focus triggers share one poll; disable/stop/re-enable and request failures cannot allow stale writes, duplicate timers or queued duplicate polls. (verification: main with controlled in-flight requests; owner: notification center)
- AC10 — Community product/platform mapping, client-language selection, in-place corrections preserving read/dismissed state, pagination, 30-day retention, timeout, raw fractional publication-time deduplication and partial-write retry match the product announcement API. (verification: main and real SQLite; owner: notification center)
- AC11 — Agent and Assistant drawer rows show their source icon/name, brief successful reply without a conversation-name prefix (or status fallback), and time; scheduled-task rows retain status; long names and missing/deleted sources remain usable, while toast and OS presentation are unchanged. (verification: renderer and Windows; owner: task results)
- AC12 — Task activation preserves message/end navigation, waits for history, falls back for missing anchors and reports deleted targets; scheduled details can show saved errors omitted from the compact row. (verification: renderer and main navigation tests; owner: task results)
- AC13 — Runtime failures/cancellations/interruptions publish once from authoritative final outcomes, scheduled stream/job ownership prevents duplicates, and approval waits or paused output cannot be misreported as successful completion. (verification: main and real SQLite; owner: task results)
- AC14 — Existing foreground silence, initial read state, background delivery and sound preferences remain valid, and consumed outcomes do not reappear after dismissal, expiry or restart. (verification: main and real SQLite; owner: task results)
- AC15 — The drawer sits 6px inside the content panel at its top, bottom and docked side with an 8px radius, and its top edge has the same offset from the panel's top edge on macOS and Windows. (verification: macOS and Windows; owner: list refinement)
- AC16 — Each row shows its type icon or source avatar, primary name and right-aligned time on one title line with the body beneath, without separators or a separate time line; hovering the row or focusing its dismissal control shows that control in place of the time. (verification: renderer and macOS; owner: list refinement)
- AC17 — Collapsed announcement and long body previews end in an ellipsis after two lines at full text contrast; truncated names and titles reveal their full value on hover or focus, and untruncated ones show no tooltip. (verification: renderer and macOS; owner: list refinement)
- AC18 — Dismissing a row collapses it within 150ms without waiting for the write, honors reduced motion, and restores the row with an error when the write fails. (verification: renderer; owner: list refinement)
- AC19 — Clear read removes every read notification and keeps unread ones without confirmation, and the result persists; mark all read and clear read are icon actions with tooltips and accessible labels. (verification: renderer and real SQLite; owner: list refinement)
- AC20 — The list fades at an edge only while rows are hidden beyond it, and scrolling changes no row. (verification: renderer and macOS; owner: list refinement)

## Risks

- A shared Drawer change can affect unrelated surfaces. Its new overlay option must preserve the existing default, and the notification use must be non-modal in behavior as well as appearance.
- Sidebar hover, layout changes and multiple windows can create duplicate UI owners or false foreground transitions. Validate these transitions explicitly; `RuntimeActivityService` tracks sleep holds, not foreground presence.
- Compact rows reveal less context, especially when several conversations use the same Agent. This is intentional; retain target navigation and accessible full names instead of restoring hidden summaries.
- Mark all read followed by clear read empties the inbox in two adjacent clicks, and no surface restores a dismissed notification. The rows stay in storage for the 30-day retention. This is accepted; add an undo or a confirmation if misclicks are reported.
- The title line gives the time a fixed share of the row, so an older record's date and time leave less room for a long title. The title truncates and stays available on hover or focus.
- The notification center layer's drawer evidence predates the inset. The list refinement layer re-checks the drawer bounds it changes instead of reusing that evidence.
- Closed-PR tests and old development profiles are historical evidence. Reconcile the new base and migration chain, retain old profiles, and use isolated fixtures; a green documentation check does not validate the implementation.
