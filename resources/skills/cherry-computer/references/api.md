# Computer automation

Bind a known application directly: `var app = await computer.getApp('Calculator')`. This emits this document and the initial AX state. `computer.listApps()` returns `{ apps, capabilities }` for discovery; print it when the target is unknown or ambiguous. Do not enumerate just to resolve a known app name.

The SDK resolves running applications by name/ID. With the new SDK/native runtime, macOS also resolves bundle IDs and paths and can launch an installed app without activation. Windows/Linux currently require running applications. An older SDK explicitly reports that launch is unavailable; do not use a terminal to bypass that limit.

## API

```ts
interface App {
  getAXState(options?: { maxTreeNodes?: number; maxTreeDepth?: number; textLimit?: number }): Promise<{ id: string; target: string; app: object; window: object; text?: string; tree: object }>
  getScreenshot(): Promise<{ id: string; target: string; screenshot: object }>
  getAXStateAndScreenshot(options?: { maxTreeNodes?: number; maxTreeDepth?: number; textLimit?: number }): Promise<object>
  click(ref: string): Promise<{ status: 'completed' }>
  clickAt(x: number, y: number): Promise<{ status: 'completed' }>
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<{ status: 'completed' }>
  typeText(text: string): Promise<{ status: 'completed' }>
  pressKey(key: string): Promise<{ status: 'completed' }>
  setValue(ref: string, value: string): Promise<{ status: 'completed' }>
  scroll(direction: 'up' | 'down' | 'left' | 'right', pages: number, ref?: string): Promise<{ status: 'completed' }>
  performSecondaryAction(ref: string, actionId: string): Promise<{ status: 'completed' }>
}
```

Observation methods automatically emit text and/or images, linked by an observation ID; do not print the same observation again. `text` contains the AX outline; do not read `.data`, `.outline` or `.snapshotId`. Refs are the complete identifiers at the start of AX lines. A screenshot-only observation does not supply element refs. `screenshot.status` and `tree.status` describe availability independently; permission failure is not an empty application.

AX defaults to 400 nodes, depth 64 and 200 characters per text value. If output is omitted, lower `maxTreeNodes` or `textLimit`; if a tree is truncated, inspect the relevant UI region or request a larger budget (up to 1200 nodes and 2000 characters per text value).

## Workflow

Perform one or more already-determined actions, then observe before deciding the next step. Prefer AX-based input. Coordinates require a fresh screenshot and use its image pixels. Every action invalidates element/coordinate refs. Keyboard operations can continue targeting the same app/window; clicking another element requires a fresh AX observation. App methods validate ownership and target freshness on the host.

`typeText` sends text as keyboard input to the bound application on macOS; it also works for keyboard-driven controls such as calculators without an editable AX field. It does not set the AX value or activate another application. Use `setValue` when explicitly replacing an editable control's value. Newlines send Return and may submit a form. Other platforms retain their native input restrictions and report unsupported input explicitly.

For a calculator supporting keyboard input, after locating its clear button and storing the ref in `clearRef`:

```js
await app.click(clearRef);
await app.typeText('128*37+456');
await app.pressKey('Return');
await app.getAXState();
```

If AX lacks sufficient information, request a screenshot instead of guessing. Completed input does not prove task success. A fresh final observation must support the answer. Never repeat `=` or another mutating action because an old screenshot appears unchanged. Output marked OMITTED is not visible evidence.

Reuse the app object across cells. At the start of a new turn call its observation method before acting. A stopped app/task requires the user's control setting to be restored; rebinding/reset cannot restore authorization. On a failed or uncertain action, stop and observe; never replay earlier actions. `typeText` newlines may submit forms. Key syntax includes `Return`, `Escape`, `cmd+a`; keys target the application, not global shortcuts. Use `computer.documentation()` after context loss.
