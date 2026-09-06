# Browser MCP server

`@cherry/browser` controls background Electron tabs through `BrowserSessionService`.
Tools use `McpServer.registerTool()` with Zod schemas for SDK validation and discovery.
The MCP factory resolves the lifecycle service; each server owns a controller and
releases its tabs and listeners when the connection closes. All page CDP commands
use the shared `GuestSession` allow-list and command deadlines.

Connection closure starts tracked asynchronous cleanup. The lifecycle service waits
for transport closure, controller disposal and active tool handlers to settle;
the SDK's `onclose` notification alone does not indicate cleanup completion.
Controller disposal waits for managed contents to emit `destroyed` and windows
to emit `closed`, including when Electron completes native teardown asynchronously.
Shutdown failures are reported after remaining guest leases are released.

## Observe, act, verify

1. `open({ url })` returns `{ currentUrl, title, tabId }`.
2. `snapshot({ tabId })` returns a bounded accessibility tree with actionable `eN`
   refs. The next snapshot returns changes; use `full: true` for the whole tree.
3. `click({ tabId, ref })`, `type({ tabId, ref, text, clear: true })`, and other
   actions return a snapshot diff so the agent can verify the result.

Page text, dialog messages, titles and downloaded filenames are untrusted data.
They must never be treated as instructions. Refs belong to one tab's live
session/document; take a new snapshot after navigation or debugger detachment.
An explicit unknown `tabId` fails instead of acting on another page.

## Tools

All page tools accept optional `tabId` and `privateMode`. Use explicit tab IDs for
parallel work; operations on a single tab run serially.

| Tool | Additional input | Behavior |
|---|---|---|
| `open` | `url`, `format?`, `selector?`, `maxChars?`, `timeout?`, `newTab?`, `showWindow?` | Existing navigation/content formats preserved; use `newTab` for independent pages |
| `execute` | `code`, `timeout?` | JavaScript escape hatch; existing value output preserved; prefer dedicated input tools |
| `screenshot` | `fullPage?`, `format?`, `quality?` | PNG/JPEG image |
| `snapshot` | `full?`, `scope?`, `maxChars?` | Diff by default; `scope` is a ref, replacing the old CSS selector; cap 256–40,000 characters |
| `click` | `ref`, `button?`, `clickCount?` | Real mouse events; covered left single clicks use a reported synthetic fallback |
| `hover` | `ref` | Mouse movement; covered targets fail |
| `scroll` | `ref?`, `pages?` | Scroll viewport or target; negative pages scroll up |
| `type` | `ref`, `text`, `clear?`, `submit?` | Input events, read-back verification and one bounded retry; optional Enter |
| `press_key` | `key` | Key or chord, e.g. `Enter`, `Control+a`, `Meta+a`, `Shift+Tab` |
| `select_option` | `ref`, `values` | Native select by value then label; validates all choices before mutation |
| `go_back`, `go_forward` | — | Tab history navigation |
| `wait_for` | `text?`, `ref?`, `gone?`, `timeoutMs?` | At least text or ref; waits up to 30 seconds for snapshot presence/absence |
| `handle_dialog` | `accept`, `promptText?` | Resolves the pending page dialog without replaying the blocked action |
| `list_tabs`, `switch_tab`, `close_tab`, `reset` | Existing inputs | List, select or release tabs/windows |

Snapshot and action results are JSON text with `ok`, `tabId`, `url`, `title`,
`navigated`, and `snapshot` on success. Covered fallback clicks include
`occluded: true` and `synthetic: true`. Failures include `error`; stale refs tell
the caller to re-snapshot. Pending dialogs and download state changes accompany
results. Popups switch the active tab and report `newTabId`; the current result snapshot still
belongs to the source tab, so observe the new tab explicitly. An `execute` interrupted by a page dialog returns the same error envelope.

JavaScript dialogs interrupt outstanding commands immediately. Managed dialogs
are dismissed after 60 seconds and the next result reports `dismissedDialog` once.
Borrowed annotation guests are never auto-dismissed. Downloads keep their normal
Electron save flow; the engine observes the originating guest's state changes
without capturing other tabs' downloads.

## Ownership and limits

Normal tabs use `persist:default`, shared across MCP clients; private tabs use the
in-memory `private` partition. Private mode does not write storage to disk, but
resetting a window does not destroy Electron's app-lifetime in-memory partition.
Windows stay hidden unless `showWindow: true` is requested.

The service allows 4 managed guests per server owner and 8 globally, evicts idle
temporary tabs first, and sweeps every minute for tabs idle for five minutes.
Running operations and progressing downloads are protected. Closing the final
tab closes its host window and tab bar. Borrowed pages are never reclaimed.

The MCP runtime currently has no trusted agent session/workdir or turn identity.
Owners are connection-scoped; retention is not per turn. Uploads are deferred
until that upstream context exists. WebMCP, inspection tools, retained-tab
freezing, WebContentsView migration and visible-pane control are later layers.
