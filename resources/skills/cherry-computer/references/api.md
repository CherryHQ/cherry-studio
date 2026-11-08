# Computer automation

Bind a known application directly: `var app = await computer.getApp('Calculator')`. This emits this document and the initial AX state. `computer.listApps()` returns `{ apps, capabilities }` for discovery; print it when the target is unknown or ambiguous. Do not enumerate just to resolve a known app name.

The SDK resolves running applications by name/ID. With the new SDK/native runtime, macOS also resolves bundle IDs and paths and can launch an installed app without activation. Windows/Linux currently require running applications. An older SDK explicitly reports that launch is unavailable; do not use a terminal to bypass that limit.

## API

```ts
interface AXOptions { maxTreeNodes?: number; maxTreeDepth?: number; textLimit?: number }
interface AXElement {
  id: string
  parentId?: string
  role: string
  name: string
  value?: string
  actions: string[]
  secondaryActions: { id: string; label: string }[]
}
interface AXState {
  id: string
  target: string
  app: object
  window: object
  text?: string
  tree: { status: 'available'; elements: AXElement[]; truncated: ('nodes' | 'depth' | 'text')[] }
      | { status: 'unavailable'; reason: object }
  page?: { offset: number; returned: number; total: number; nextCursor?: string }
}
interface App {
  getAXState(options?: AXOptions | { cursor: string }): Promise<AXState>
  getScreenshot(): Promise<{ id: string; target: string; screenshot: object }>
  getAXStateAndScreenshot(options?: AXOptions): Promise<AXState & { screenshot: object }>
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

Observation methods automatically emit structured state and/or images, linked by an observation ID; do not print the same observation again. Use `tree.elements` for extraction and each element's complete `id` as its action ref. `parentId` may refer to a node on another page. `text` remains a human-readable outline in the JS return value, but is not a parsing format and is not emitted alongside the structured nodes. Do not regex, split or otherwise parse that outline; names/values can contain quotes, newlines and `actions=`. Do not invent `.data`, `.outline` or `.snapshotId` fields. A screenshot-only observation does not supply element refs. `screenshot.status` and `tree.status` describe availability independently; permission failure is not an empty application.

AX defaults to 400 nodes, depth 64 and 200 characters per text value. Output is paged at complete node boundaries using a serialized UTF-8 byte budget. Initial binding reserves extra room for documentation. `page.offset` is zero-based, `returned` is this page's node count, and `total` counts nodes captured in this snapshot. A `page.nextCursor` means more captured nodes remain: call `getAXState({ cursor })` in the **next cell**, without other options. It reads the same captured snapshot, without observing the app again. Read one page per cell; do not loop over pages or print the full accumulated tree in one cell. Cursors are consumed once and expire after any action, fresh observation, rebind or new run. Page IDs and refs remain stable within the snapshot; continuation pages do not repeat its screenshot.

Pagination is separate from native truncation: reaching the last page does not clear `tree.truncated`. If it lists `nodes`, `depth` or `text`, the native capture is still incomplete. Inspect the relevant UI region or request a larger capture (up to 1200 nodes and 2000 characters per text value). If a single node exceeds a page's budget, the host returns an explicit error; retry with a smaller `textLimit` or use a screenshot.

For extraction, first capture into `var state = await app.getAXState()`. After checking `state.tree.status === 'available'`, use fields directly, for example:

```js
var matches = state.tree.elements.filter(e => e.role === 'AXStaticText');
console.log(matches.slice(0, 5).map(e => ({ name: e.name, value: e.value })));
```

Zero matches means only that this filter found nothing **on this page**. Check roles and `page.nextCursor`; continue with `state = await app.getAXState({ cursor: state.page.nextCursor })` in a new cell when a cursor exists. Check native truncation before concluding content is absent. Do not keep rewriting a failed text parser or treat omitted/unavailable output as an empty page.

## Workflow

Perform one or more already-determined actions, then observe before deciding the next step. Prefer AX-based input. Coordinates require a fresh screenshot and use its image pixels. Every action invalidates element/coordinate refs and page cursors. Keyboard operations can continue targeting the same app/window; clicking another element requires a fresh AX observation. App methods validate ownership and target freshness on the host.

`typeText` sends text as keyboard input to the bound application on macOS; it also works for keyboard-driven controls such as calculators without an editable AX field. It does not set the AX value or activate another application. Use `setValue` when explicitly replacing an editable control's value. Newlines send Return and may submit a form. Other platforms retain their native input restrictions and report unsupported input explicitly.

A text role alone does not imply editability. Use `setValue` only when the observed
node's `actions` includes it. Some browser address bars expose a read-only display
field: click its ref, observe again, then use the new editable field's ref. Check
its value before pressing Return and verify the destination afterward. Do not reuse
the display field's ref or infer navigation from a completed input receipt.

For a calculator supporting keyboard input, after locating its clear button and storing the ref in `clearRef`:

```js
await app.click(clearRef);
await app.typeText('128*37+456');
await app.pressKey('Return');
await app.getAXState();
```

If AX lacks sufficient information, request a screenshot instead of guessing. Completed input does not prove task success. A fresh final observation must support the answer. Never repeat `=` or another mutating action because an old screenshot appears unchanged. Output marked OMITTED is not visible evidence.

Reuse the app object across cells. At the start of a new turn call its observation method before acting. A stopped app/task requires the user's control setting to be restored; rebinding/reset cannot restore authorization. On a failed or uncertain action, stop and observe; never replay earlier actions. `typeText` newlines may submit forms. Key syntax includes `Return`, `Escape`, `cmd+a`; keys target the application, not global shortcuts. Use `computer.documentation()` after context loss.
