# Capture Workflow

Use this reference for the first Cherry Studio capture in a task. Repository-local Electron instructions take precedence when they are stricter.

## 1. Inventory and output layout

Map every target to one reference filename before operating the app. A useful batch layout is:

```text
<batch>/
  final/
  qa/
  drafts/
```

Keep references read-only. Drafts may be replaced only inside the current batch folder; do not overwrite an approved final without an explicit retry decision.

## 2. Verify or replace the instance

Inspect exact processes and ports:

```bash
ps -axo pid=,ppid=,pgid=,command= | \
  rg -i 'Cherry Studio|CherryStudio|remote-debugging-port|electron-vite'
lsof -nP -iTCP -sTCP:LISTEN | rg 'Cherry|Electron|:9222|:5173'
```

For an existing tracked instance, revalidate the PID, cwd or installed-app path, listener ownership, and CDP target before every UI operation:

```bash
lsof -a -p <PID> -d cwd -Fn
lsof -nP -a -p <PID> -iTCP:<CDP_PORT> -sTCP:LISTEN
curl -fsS http://127.0.0.1:<CDP_PORT>/json/version | jq .
curl -fsS http://127.0.0.1:<CDP_PORT>/json/list | \
  jq '.[] | {id, type, title, url}'
```

For the installed macOS client, the main target normally ends in:

```text
/out/renderer/windows/main/index.html
```

Do not attach to `quickAssistant`, `subWindow`, settings, splash, or mini-app targets.

When exact CDP access is absent and replacement is authorized by the screenshot task:

1. Record the existing main PID, command, parent, PGID, cwd, and ports.
2. Send `SIGTERM` only to that main PID and wait up to eight seconds.
3. Do not escalate to `SIGKILL` automatically.
4. Relaunch the same installed application with the same profile and only the required CDP argument.
5. Verify the new PID owns the listener and the expected target before writing `instance.json`.

## 3. Select the correct CDP target

List targets; never assume index `0`. `agent-browser` may select Quick Assistant even after the main page is brought forward. Select the page whose title is `Cherry Studio` and whose URL is the verified main-window target.

```bash
agent-browser --cdp <PORT> tab
agent-browser --cdp <PORT> tab <MAIN_INDEX>
agent-browser --cdp <PORT> get title
agent-browser --cdp <PORT> get url
agent-browser --cdp <PORT> snapshot -i -c
```

When multiple page targets make the generic attachment ambiguous, bind the verified URL directly:

```bash
node scripts/cdp_target.mjs --port <PORT> --url-contains '/windows/main/index.html' eval 'document.title'
```

Re-list after opening global search results or detached windows.

## 4. Locate content by evidence

For Chat or Agent marketing screenshots:

1. Open global search.
2. Search a distinctive phrase from the reference request or result.
3. Select the matching message, inspect the detail, then activate `打开`.
4. Confirm the visible DOM contains both the exact request and result markers.
5. Confirm the rendered screenshot, because hidden DOM text is not visible evidence.

Opening a search result may create a duplicate tab. Move the correct tab into the reference position, close only the verified duplicate, and switch back to the intended active tab before capture.

## 5. Match the window and composition

Query the live renderer:

```javascript
({
  inner: [window.innerWidth, window.innerHeight],
  outer: [window.outerWidth, window.outerHeight],
  dpr: window.devicePixelRatio,
  lang: document.documentElement.lang,
  theme: document.documentElement.className
})
```

Derive the point size from the target pixels and actual device pixel ratio. Do not resize the exported PNG afterward.

Before final capture:

- verify the active tab, sidebar selection, language, theme, and visible task/result
- dismiss search, menus, dialogs, toasts, and selectors
- wait for charts, images, fonts, and animations
- move the pointer to a neutral title-bar drag region, commonly near `(50, 20)` CSS pixels
- take a CDP screenshot and inspect it for hover-only timestamps or chart controls

## 6. Final macOS capture

Use `scripts/window_id.swift <PID>` to resolve the only on-screen layer-0 window owned by the verified PID. If more than one candidate exists, the helper stops and lists the IDs; inspect them instead of guessing. Record the verified main window ID.

Use `scripts/capture_window.sh` with the verified PID, window ID, and exact output size. It raises only the verified process's unique main-sized Accessibility window, retries transient Electron/macOS visibility races, revalidates the supplied native window ID, and captures it with native chrome and Alpha. It does not navigate or change feature state.

Run `scripts/compare_capture.sh`. Review:

- `reference-vs-sample.png`
- `difference.png`
- `metrics.txt`

The comparison script enforces dimensions, transparent corners, and a default normalized RMSE ceiling of `0.20`. The reviewer must still reject wrong content, locale, theme, hover state, crop, or tab/sidebar composition.

For a completed directory whose filenames match the references, run `scripts/compare_batch.sh` and keep its `summary.tsv` with the final QA artifacts.

## 7. Finish

Leave a healthy persistent instance running. Report its PID, CDP port, tracking file, and output paths. Stop only an instance that the user explicitly asked to stop or that the authoritative repository policy permits stopping.
