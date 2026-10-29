# Agent Note: Notification center drawer and task result presentation

Status: proposed

English | [中文](2026-10-29-notification-center-redesign.zh.md)

## Problem

The notification entry should follow the account area introduced by [#23043](https://github.com/CherryHQ/cherry-studio/pull/23043). The closed [#21772](https://github.com/CherryHQ/cherry-studio/pull/21772) and [#21884](https://github.com/CherryHQ/cherry-studio/pull/21884) contain reusable notification storage, announcement polling and task-result behavior. Their toolbar popover, numeric badge, category tabs and detailed task rows do not match the intended presentation. Those PRs stay closed; new implementation PRs reuse their relevant changes.

Users need one quiet inbox, a reachable unread indicator and a short answer to who finished or failed. They should open the original conversation or task for details. Returning to the app should also refresh official announcements without creating concurrent requests.

## Proposal

### Delivery and ownership

The dependency chain is `#23043 → Spec → notification center → task results`. This Spec changes documentation only. Both implementation layers require approval of the current Spec head. Keep the note proposed in the intermediate layer; the final layer records actual evidence for every AC before moving the bilingual triplet to implemented.

| Layer | Responsibility | Acceptance criteria |
|---|---|---|
| Notification center | Entry, unread dots, drawer, unified list, existing notification storage and official announcements | AC1–AC10 |
| Task results | Compact task presentation, runtime outcomes, delivery policies and result navigation | AC11–AC14 |

The account-menu behavior remains owned by [Account menu cache and interaction](../../implemented/bug-fix/2026-10-29-account-menu-cache.md). This proposal adds the notification entry beside that experience; it does not redesign account actions.

### Entry and unread indicator

- In the full and icon-only sidebars, place the bell directly above the user avatar. Use the sidebar footer action slot. Remove the old permanently visible bell from the tab bar.
- When the sidebar is hidden, place the bell next to the top-bar avatar. A temporarily revealed sidebar must not mount another drawer or duplicate notification subscriptions.
- Show one small dot when any unread notification exists. Never show a number or `99+` on the bell, in the drawer heading or on individual rows. Individual unread rows also use a dot. Preserve accessible labels for the notification entry and unread state.
- Keep the existing unread-count API. The view only tests whether the count is greater than zero. Do not create a second unread state or a separate badge counter.

### Left drawer

Use the existing [Drawer primitive](../../../../packages/ui/src/components/primitives/drawer.tsx). Add an optional overlay control with the existing behavior as its default. The notification drawer uses non-modal behavior without a dark overlay; other consumers keep their current behavior.

The drawer slides in from the left and overlays content without changing the chat layout width. With a visible sidebar, its left boundary follows the sidebar's right edge. With a hidden sidebar, it starts at the window's left edge. Keep the window's top controls accessible. Default width is 384px, capped by the available content width. The header and footer stay visible while the list scrolls independently.

The header contains the notification title, mark-all-read action and close button. The footer retains the 30-day history notice. Clicking the bell again, clicking outside, pressing Esc or using the close button closes the drawer. An outside click can continue to its underlying control; there is no invisible modal barrier. Opening moves focus into the drawer. Keyboard dismissal returns focus to the currently visible bell, including after a sidebar layout change. Honor reduced-motion preferences.

Each main window owns one drawer and one open/requested-notification state. Sidebar and top-bar triggers share that state. A `notification.open` event opens the same drawer and reveals its requested record without duplicating it or breaking time order. Layout changes while open reposition the drawer instead of resetting its list. Opening the account menu dismisses the drawer through the normal outside interaction.

### One notification list

Remove the All, System, Usage and Official tabs and their filter state. Fetch the existing paginated list without a category parameter and retain descending creation-time order. Do not add replacement grouping headings or category chips. Internal categories and category preference switches remain available for delivery policy.

Retain pagination, load more, mark all read, per-row dismissal, loading, empty state, failed-load retry and unavailable-target feedback. Opening the drawer alone does not mark rows read. Keep the current activation rules: content rows mark read when opened; task rows mark read through activation and navigate to their target. Dismissing a row must not also activate or expand it. Place dismissal beside the row's information, without reserving a separate full-height column.

Official announcements remain literal plain text with line breaks. A faded collapsed preview expands inside the same row; do not insert a second copy. Existing optional HTTPS source links appear only when expanded. API announcements do not fabricate a URL. Release notes keep Markdown and the existing update action. Backup and usage notices retain their meaningful content.

### Compact task rows

Apply the same compact layout to Agent, Assistant and scheduled-task rows, including successful batches and failed, cancelled or interrupted outcomes. This change applies only inside the drawer. Application toasts, operating-system notifications and their delivery settings retain their current presentation.

| Row | Icon | Primary name | Result |
|---|---|---|---|
| Agent | Agent avatar | Agent name | Completed, Failed, Cancelled or Interrupted |
| Assistant | Assistant avatar | Assistant name | Completed, Failed, Cancelled or Interrupted |
| Scheduled task | Task icon | Scheduled-task name | Completed, Failed, Cancelled or Interrupted |

Show the icon, primary name, result and time. Use one identity icon rather than adding a second generic category icon. Resolve identity through the existing entity APIs; if unavailable, use an existing saved identity/name where valid, then the default source name and icon. A deleted source must not make the row disappear. Do not parse display text to recover identity.

Hide conversation titles, reply excerpts, detailed errors, elapsed duration and successful-batch counts in these rows. Keep those stored values unchanged for target pages and other delivery surfaces. Long names truncate with their full value available on hover or focus. Show local time for today's records and a short local date plus time for older records; expose the full timestamp on hover or focus. Status text remains visible so color is not the only signal. Failure/interruption can use the existing error color, without coloring the entire card.

Clicking a task row keeps the existing navigation contract: a message anchor locates that message, an explicit end target opens the end, and a missing anchor falls back to the end after history loads. Scheduled results open task details with the saved error summary. A missing or deleted target reports that it is unavailable instead of creating a replacement conversation.

### Official announcement refresh

Preserve the existing startup delay of five seconds after all services are ready and the thirty-minute delay after each completed poll, including failed polls. Polling continues in the background. Add an immediate check when the app transitions from background to foreground. The initial startup focus is not an extra transition; switching Cherry Studio windows, tabs, account menus or the notification drawer is not an app foreground transition.

Observe application focus in the main process and aggregate it at app level. Only a transition from no focused Cherry Studio application window to a focused one requests a poll. Coalesce transient blur/focus events during an internal window handoff. Do not create one polling timer or one network request owner per renderer.

Timer and foreground triggers use one request entry point. If a poll is already running, that poll satisfies the new trigger; do not overlap or queue another copy. Starting a foreground poll replaces a pending timed check. When the poll finishes, schedule the next check thirty minutes later. Every real background-to-foreground transition can trigger a check when idle; there is no extra cooldown that silently ignores it.

Disabling announcements or stopping the service removes the focus subscription, cancels the request and timer, and invalidates the old session. Old results cannot write notifications or schedule a replacement timer. Re-enabling uses the existing startup scheduling and recent-history rules.

Keep the public endpoint `https://api.cherry-ai.com/api/announcements`, Electron `net.fetch`, `platform=desktop` and `getAppEdition()` mapping to `global/cn`. Send no login, signature or management credentials. Each round starts at offset zero with pages of 100, a 15-second timeout per request and the last 30 days of publications; records exactly at the retention boundary are expired. Existing records are not a pagination stopping condition. Stop at an expired record, the total or an empty page. Keep the original `published_at` string, including fractional seconds, in `announcement:api:${JSON.stringify([id, published_at])}`; parsed time only serves ordering and retention. Failure ends the round and retains saved history. A later poll retries unsaved records. Unpublication does not erase local history.

### Reuse and compatibility

Reuse the closed implementations' single notification table, list/detail/read APIs, preferences, SQLite deduplication, scheduler and navigation. This proposal adds no table beyond that notification table, no new DataApi endpoint, no dependency and no enterprise-edition detection. It does not remove internal notification categories or settings. When transplanting the old code, generate any required notification-table migration after the verified base's migrations; do not restore obsolete draft migration numbers.

Keep the existing task-result contract: publish durable outcomes after terminal listeners or committed job settlement, preserve stable result identities and persist consumption with the optional notification. Scheduled tasks own publication so stream and job events cannot double-notify. Approval waits are not failures; confirmed user stops are cancelled and other interrupted runs do not become successful output. Foreground success is silent; existing read-state, background notification and sound policies remain unchanged. Do not reintroduce context-capacity notices or add task-dashboard coupling, terminal-event replay or crash recovery.

### Validation approach

The Spec PR runs documentation, translation-pairing and scoped formatting checks only. No product behavior is implemented or accepted by those checks. Each implementation layer runs explicitly filtered existing tests plus focused regressions for its ACs, affected type/lint/translation checks and Windows development-window checks in light and dark themes. Use real SQLite fixtures for persistence, controlled focus events for polling and local content fixtures for the drawer. Do not create live announcements. Report native platform and real-provider verification limits accurately.

## Alternatives considered

- Keep the toolbar popover and numeric badge: retains the separated entry and visual noise this design removes.
- Use a right drawer, a dark modal overlay or a layout-pushing panel: conflicts with the selected left-side, non-modal interaction.
- Keep category tabs or replace them with groups: makes users choose a bucket instead of scanning one ordered inbox.
- Retain task excerpts, errors and duration in every row: obscures the source and outcome; details remain available at the destination.
- Simplify toasts and OS notifications at the same time: expands beyond the selected drawer-only change.
- Fetch from every renderer focus event or add a second announcement cache: duplicates ownership and weakens cancellation/deduplication guarantees.
- Combine all implementation into one PR: loses the requested separation between notification-center behavior and task-result integration.

## Acceptance criteria

- AC1 — Full and icon-only sidebars place the bell directly above the avatar; hidden sidebars expose it beside the top-bar avatar, with no permanent duplicate toolbar entry. (verification: renderer and Windows; owner: notification center)
- AC2 — Any positive unread count produces only a dot, zero produces none, and individual unread rows expose a dot and an accessible unread label without a numeric badge. (verification: renderer; owner: notification center)
- AC3 — The left drawer has no dark or blocking overlay, overlays rather than resizes chat content, respects sidebar/top-control boundaries and fits narrow windows in both themes. (verification: Windows; owner: notification center)
- AC4 — Bell toggle, outside interaction, close button and Esc dismiss the drawer; keyboard focus returns to the visible trigger, and layout changes or IPC opens never create duplicate drawers or records. (verification: renderer and Windows; owner: notification center)
- AC5 — Mixed notification types share one descending-time list without category requests/tabs/groups; paging, retry, empty state and requested-record reveal preserve that order. (verification: renderer; owner: notification center)
- AC6 — Opening the drawer leaves read state unchanged; activation, mark-all-read and dismissal retain their distinct behavior and survive restart without duplicating records. (verification: renderer and real SQLite; owner: notification center)
- AC7 — Announcement HTML/Markdown remains literal, line breaks and in-place expansion survive, repeated expansion of a read record causes no repeated read write, and release notes retain their update behavior. (verification: renderer and Windows; owner: notification center)
- AC8 — Startup checks after five seconds and subsequent checks thirty minutes after completion continue in the background; a true foreground transition requests one immediate check, while internal window/tab changes do not. (verification: main with controlled scheduler/focus events; owner: notification center)
- AC9 — Overlapping timer/focus triggers share one poll; disable/stop/re-enable and request failures cannot allow stale writes, duplicate timers or queued duplicate polls. (verification: main with controlled in-flight requests; owner: notification center)
- AC10 — Edition mapping, pagination, 30-day retention, timeout, raw fractional publication-time deduplication, partial-write retry and retained local history keep their existing contracts. (verification: main and real SQLite; owner: notification center)
- AC11 — Agent, Assistant and scheduled-task drawer rows show only their source icon/name, result and time; long names and missing/deleted sources remain usable, while toast and OS presentation are unchanged. (verification: renderer and Windows; owner: task results)
- AC12 — Task activation preserves message/end navigation, waits for history, falls back for missing anchors and reports deleted targets; scheduled details can show saved errors omitted from the compact row. (verification: renderer and main navigation tests; owner: task results)
- AC13 — Runtime failures/cancellations/interruptions publish once from authoritative final outcomes, scheduled stream/job ownership prevents duplicates, and approval waits or paused output cannot be misreported as successful completion. (verification: main and real SQLite; owner: task results)
- AC14 — Existing foreground silence, initial read state, background delivery and sound preferences remain valid, and consumed outcomes do not reappear after dismissal, expiry or restart. (verification: main and real SQLite; owner: task results)

## Risks

- A shared Drawer change can affect unrelated surfaces. Its new overlay option must preserve the existing default, and the notification use must be non-modal in behavior as well as appearance.
- Sidebar hover, layout changes and multiple windows can create duplicate UI owners or false foreground transitions. Validate these transitions explicitly; `RuntimeActivityService` tracks sleep holds, not foreground presence.
- Compact rows reveal less context, especially when several conversations use the same Agent. This is intentional; retain target navigation and accessible full names instead of restoring hidden summaries.
- Closed-PR tests and old development profiles are historical evidence. Reconcile the new base and migration chain, retain old profiles, and use isolated fixtures; a green documentation check does not validate the implementation.
