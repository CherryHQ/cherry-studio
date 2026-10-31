---
description: How a mini app lives and dies — no shutdown notice, write-on-change persistence, visibility and locale events, quiesce during updates
sources:
  - src/main/features/miniApp/runtime/MiniAppRuntimeService.ts
  - src/main/features/miniApp/runtime/events.ts
  - src/shared/ipc/schemas/miniAppBridge.ts
---

# Lifecycle

## The one rule: you can be killed at any moment

The host makes **no promise of a last chance to save**. There is no destroy event, no `suspend`, no awaited `beforeunload`. The app dies when the user closes the tab or window, when the keep-alive pool evicts it, when the renderer crashes, when Cherry quits or relaunches, when an update quiesces it, or when the machine loses power — and the host treats all of these the same way.

Everything in flight dies with it: pending computations, an `ai.chat` stream, a `cherry.network.fetch` waiting on a server. The host does not wait for them and keeps no partial results.

A partial guarantee would be worse than none: an author who tested the one path that does notify would ship an app that loses data on the others. So the model is stated once, without exceptions.

## Persistence rules

| Rule | Why |
|---|---|
| Write state as soon as it changes | `cherry.storage.set` and `cherry.file.save` are committed when their Promise resolves; they are cheap enough to call on every meaningful change |
| One key for anything that must change together | There are no multi-key transactions. Being killed between two `set` calls leaves inconsistent state; one JSON value in one key cannot be half-written. 1 MB is plenty for game state |
| Treat `app.visibilityChange` `{ visible: false }` as a save point | Going to the background is the only moment the host announces in advance, and the most common one before a kill |
| On start, assume the previous run ended abnormally | A `file.save` that was in flight at the kill either landed or did not; read back and decide, never assume a clean exit |
| Do not build on strict shutdown guarantees | Long transactions or paired external side effects are not a fit for a mini app |

```js
let state = JSON.parse((await cherry.storage.get('state')).value ?? '{"level":1}')

function commit(patch) {
  state = { ...state, ...patch }
  return cherry.storage.set('state', JSON.stringify(state))
}

cherry.on('app.visibilityChange', ({ visible }) => {
  if (!visible) commit({ pausedAt: Date.now() })
})
```

## Keep-alive pool

Opened apps stay alive in a bounded pool. A hidden app is still running — it is hidden with `display: none`, which means `document.visibilityState` stays `visible` and `visibilitychange` never fires. Timers, `requestAnimationFrame` and audio keep going unless you stop them. When the pool is full, the least recently used app is destroyed without notice.

Pause on `app.visibilityChange`, not on Page Visibility.

## While you are hidden

Staying alive is not permission to keep spending. Two capabilities carry a cost the user cannot see while they are looking elsewhere — `ai.chat` spends their money, `network.fetch` sends their data — so each has a small allowance that applies **only** while you are hidden:

| Capability | Allowance while hidden |
|---|---|
| `ai.chat` | 5 calls |
| `network.fetch` | 10 requests |

Four things to know about it:

- **It does not refill with time.** One call a minute for an evening is still hundreds of calls. The allowance comes back when the user opens your app again, and at no other moment — so `RateLimited` here is not something to retry on a timer.
- **Visible calls do not spend it.** It is whole every time you are hidden, however busy you were before.
- **Work already started finishes.** Only new calls are refused; a stream or request in flight when the user switches away runs to completion. Do not tear your own state in half on `visible: false`.
- **`storage`, `file` and `notification` are untouched.** Saving state as the user leaves is the most useful thing you can do while hidden, and a notification exists precisely to reach someone who is not looking.

Each pane has its own allowance, as it has its own visibility: the same app in a detached window is budgeted separately. Refusals are recorded in the app's activity log, which the user can read from its detail panel.

Design for it rather than against it: finish or checkpoint on `visible: false`, and resume on `visible: true`.

## Events

Subscribe with `cherry.on(event, handler)`; it returns an unsubscribe function. Both events are fire-and-forget — the host does not await handlers, and a rejected or throwing handler is ignored.

| Event | Payload | Meaning |
|---|---|---|
| `app.visibilityChange` | `{ visible: boolean }` | The user switched to (`true`) or away from (`false`) the app |
| `app.localeChange` | `{ locale: string }` | The user changed the UI language, e.g. `zh-CN`, `en-US`. Read the initial value from `cherry.app.getInfo()` |

You start visible — a guest is created because a pane is showing it — and hear about every change after that, per window: the same app open in a detached window has its own pane and its own events. Two capabilities read the same state: `cherry.file.export` needs the app visible, `cherry.clipboard` needs it visible **and** focused.

Visibility is the **pane's**, not the window's. Switching tabs, closing a split pane or leaving the mini apps page hides you; minimizing or hiding the Cherry window does not — you stay "visible" and get no event. For the clipboard this changes nothing, since a minimized window has no keyboard focus; a `file.export` dialog opened from a minimized window belongs to that window and waits with it. Window state may be folded in later; do not build on it either way.

There are exactly two, chosen by one criterion: the app cannot find the state out any other way. Anything you can query has no event:

| Not an event | Do this instead |
|---|---|
| Theme change | `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)` |
| Permission change | Permissions only change while the user is in the host UI, which hides your app. Re-read `cherry.app.getPermissions()` on `visible: true` |
| About to be destroyed | Nothing. See the first section |
| Notification clicked | Not delivered |

## Quiesce

Updating, rolling back, reinstalling, clearing data and uninstalling all take the app offline first: running instances are torn down, then the change is applied. From the app's side:

| Moment | What you see |
|---|---|
| A capability call made during the quiesce | Rejects with `Unavailable` |
| A write admitted before the quiesce that reaches its commit after it | Also rejected — the world it started in is gone. Its Promise rejects with `Unavailable` |
| After the change | The app is reopened by the user from scratch, possibly as a different version |

`cherry.storage` and `cherry.file` survive updates and rollbacks; they are cleared by clear-data, by a reinstall that asks for it, and by uninstall.

Revoking or granting an optional permission does **not** quiesce the app: the next call simply reflects the new state. A request already in flight when its permission is revoked runs to completion.

## Startup checklist

1. `const info = await cherry.app.getInfo()` — locale, your version, host version.
2. `const perms = await cherry.app.getPermissions()` — decide which optional features to enable.
3. Load state from `cherry.storage` and recover as if the last run crashed.
4. Subscribe to `app.visibilityChange` and `app.localeChange`.
5. If the app uses AI, `await cherry.ai.getCapabilities({ model })` for the slot you will call; branch on `available` before offering any AI feature, and pick prompts that fit its `contextWindow`.
