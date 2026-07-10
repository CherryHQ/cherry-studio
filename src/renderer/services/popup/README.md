# services/popup

The imperative **dialog track** — blocking, answer-returning interactions. Its non-blocking twin is [`services/toast`](../toast.ts).

## API — the barrel `index.ts` is the only entry

| Import | Use |
|---|---|
| `popup.confirm` / `error` / `info` / `warning` | prefab confirm / acknowledge boxes → `Promise<boolean>` |
| `createPopup(Component, opts)` | your own dialog → a `{ show, hide }` handle; `show(props): Promise<R>` |

`popup` is a facade object mirroring `toast`'s shape, so the two tracks read symmetrically (`popup.confirm(...)` next to `toast.success(...)`). The prefabs are **not** exported individually — always go through the `popup` facade (`confirm` / `error` collide with `window.confirm` / `catch (error)`).

## Ready-made popups — `ConfirmActionPopup` / `ContentPopup`

Two reusable components in [`components/popups`](../../components/popups) sit between the prefabs and raw `createPopup`. Both are **built on `createPopup`** (same store, same contract), but each captures one of the two commonest bespoke shapes so callers don't rebuild it:

| Component | Use | Returns |
|---|---|---|
| `ConfirmActionPopup` | confirm, **then run a fallible async action** behind an OK-button spinner — toasts the failure and stays open to retry | `Promise<boolean>` |
| `ContentPopup` | drop **arbitrary content** into a modal shell — no action buttons; closes via ✕ / overlay / Escape | `void` |

Pick in this order:

- a yes/no answer → `popup.confirm`
- a confirm that gates a fallible action → `ConfirmActionPopup`
- show a panel / view → `ContentPopup`
- a dialog whose own buttons must drive a typed result → `createPopup<P, R>`

Not a popup: an overlay whose open-state a parent owns → inline `<Dialog open>`; an anchored menu/popover/tooltip → the Radix primitive directly.

## Files

| File | Role |
|---|---|
| `index.ts` | the barrel — sole public entry; the full API + contract JSDoc lives here |
| `PopupService.ts` | the module-level store (`useSyncExternalStore` source) + two-phase close timing |
| `createPopup.ts` | the factory: single-flight `show`, injects `{ open, resolve }` into the component |
| `presets.ts` | the `confirm`/`error`/`info`/`warning` prefabs + the `popup` facade |
| `types.ts` | `PopupHandle`, `PopupInjectedProps`, entry/props types |

The **render endpoint** lives outside this directory: `<PopupHost/>` (`components/PopupHost/`) drains this store, and each window mounts it as a leaf. Nothing renders until a host is mounted.

## Contract (details in `index.ts`)

- **single-flight** — a second `show()` while one is in flight returns the first promise; new props are ignored.
- **no host → resolves `dismissResult`** — never hangs, never rejects; so popups are unusable on a window-startup path (the host only subscribes after its first commit).
- **two-phase close** — `open:false`, then unmount after the exit animation (`POPUP_EXIT_MS`).
- **promise-only outcome (prefabs)** — the answer comes solely from the returned `Promise<boolean>` (`if (await popup.confirm(...)) { … }`); there is no `onOk`/`onCancel`. A dialog that must run an action behind an in-dialog spinner, drive a multi-step flow, or return a non-boolean answer is not a prefab — reach for `ConfirmActionPopup` (confirm + fallible action) or `ContentPopup` (show content) above, or `createPopup<P, R>` for anything bespoke.
- **focus on close (prefabs)** — `popup.confirm`/`error`/`info`/`warning` accept `focusOnClose?: () => void` to place focus once the dialog closes, overriding Radix's default focus-return (Radix otherwise sends focus back to whatever was focused before the dialog opened, which is wrong when the opener has since unmounted). Implemented via `onCloseAutoFocus` + `preventDefault`, so no race and no `requestAnimationFrame`.
- **lazy popup** — a `React.lazy` component must carry its own `<Suspense>` (store updates are not transitions).

## Add a popup

```tsx
type Props = MyParams & PopupInjectedProps<MyResult>

const MyPopup = createPopup<MyParams, MyResult>(
  ({ open, resolve, ...params }: Props) => (
    <Dialog open={open} onOpenChange={(next) => !next && resolve(dismissValue)}>
      …
    </Dialog>
  ),
  { dismissResult: dismissValue }
)

// caller — anywhere, no host reference needed
const result = await MyPopup.show(params)
```
