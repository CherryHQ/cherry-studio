# Agent Note: Conversation-owned browser tabs

Status: proposed

English | [中文](2026-11-14-session-browser-tabs.zh.md)

## Problem

The right-pane browser holds one page per Agent Session or ordinary chat Topic. Opening documentation, a development preview or an HTML artifact replaces the previous page. A single guest binding also prevents an Agent from targeting one page while the user reads another.

## Proposal

Keep Files and Browser as separate right-pane capabilities. Files owns workspace navigation and editing; Browser owns website navigation, browser history and controlled web guests. Their presentation may share primitives, but merging their resource models is outside this change.

Each conversation owns an ordered, memory-only collection of pages and one visible page. Each page has a stable renderer page ID and an independently revocable main-process guest binding ID. Application route tabs remain owners of the conversation collection. Collapsing the pane or switching its visible page preserves guests and page state. Agent collections retain the existing active-turn lifetime.

Manual first-page and new-tab actions use the configured blank, custom or last-page policy. Last-page memory is separate per conversation and is updated only by the selected ordinary page; explicit URLs and automation-created pages keep their requested destinations. Address-bar navigation targets the visible page. Message links reuse a page at the same URL and security profile or create one. Explicit new-tab actions permit duplicates. HTTP(S) popups create pages inside their source conversation and respect background-tab intent. POST and preview/artifact popups retain their existing restrictions. Development preview updates reuse their preview identity without stealing selection. HTML artifacts retain per-file authorization and separate partitions.

Agent handles retain an exact guest binding independently of user selection. Each acquired page retains its observation lease until that page or the control session closes, so observing another page does not invalidate its element refs. The REPL supports listing pages, acquiring an explicit tab and creating a tab. Each action checks conversation ownership and permission. Closing/replacing a guest invalidates its old handle and interrupts its work; an old handle never redirects to a neighbor. Pointer and keyboard operations request presentation of their exact page through the existing pane-opening preference. Background execution semantics and permission gates remain owned by the browser engine.

Files and Browser use the same right-pane tab component, with a neutral selected surface and shared sizing. Keep the strip on one row, with a fixed new-tab control and an overflow menu only when pages do not fit. The selected page stays visible. Website favicons replace the loading indicator when loading stops; address suggestions use the locally cached favicon with a globe fallback. Browser tab context menus offer opening the committed URL in a top-level browser tab or a new window, copying its link, opening HTTP(S) in the external browser, and closing the clicked page, other pages, pages to its right or all pages in this conversation. They omit reload. Opening elsewhere retains the source page; opening a background page menu preserves selection. Overflow entries expose the same menu. Batch closing includes hidden pages and preserves a surviving selected page, otherwise selecting the nearest surviving page to the right, then the left.

The tab strip owns maximize/collapse controls; do not render a separate Browser title row. Closing the selected page chooses the right neighbor, then the left; closing the last page or all pages closes the right sidebar. Keyboard navigation, close actions, loading state and accessible names work in both themes. A running-page indication lets the user return to the Agent target.

## Alternatives considered

- Merge Files and Browser now: mixes editable-file lifetimes, workspace navigation and web guest control, increasing scope without solving page targeting.
- Add only a visual tab strip: preserves the one-guest limitation and loses page state on each switch.
- Follow the user's selected tab for every Agent operation: makes an unrelated UI switch redirect an already-bound action.
- Persist and restore page collections on restart: requires a separate persistence and restore policy; this change keeps the existing process lifetime.

## Acceptance criteria

- AC1 — Multiple pages in one conversation preserve their independent guests and page state when switching pages, right-pane capabilities or conversations; other conversations never inherit them. (verification: runtime/host tests and Electron; owner: renderer browser)
- AC2 — New, switch, close, overflow and keyboard actions remain available in a narrow pane; closing the last page or all pages closes the right sidebar, while closing pages with survivors keeps it open. (verification: real UI component tests and Electron; owner: renderer browser)
- AC3 — Address navigation stays in its page, message links open/reuse pages, preview updates preserve user selection, and allowed popups remain in their source conversation. (verification: affected consumer/registry tests and Electron; owner: browser integration)
- AC4 — Agent handles target their original page after the user switches pages; explicit acquisition and new-page creation work, and closed/replaced/cross-conversation handles fail without acting elsewhere. (verification: main-process protocol and REPL tests; owner: browser control)
- AC5 — Browser permissions, partition isolation, per-file authorization, active-turn retention and cancellation continue to apply per guest. (verification: affected main/renderer tests and Electron; owner: browser lifecycle)
- AC6 — Running-page status, translated labels, visible focus and loading/empty states remain usable in light and dark themes. (verification: component tests, locale checks and Electron; owner: renderer browser)

## Risks

Retained guests consume more memory. No idle eviction may silently discard user page state or an active operation. Main-process binding replacement must not change another page's identity. Popup adoption retains existing restrictions and does not claim support for opener-dependent authentication or POST flows. Formal Spec PR approval and the implemented lifecycle transition remain separate from local implementation verification.
