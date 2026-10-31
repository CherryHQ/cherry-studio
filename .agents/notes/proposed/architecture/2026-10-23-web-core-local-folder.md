# Agent Note: Web Core agent local folders

Status: proposed

English | [中文](2026-10-23-web-core-local-folder.zh.md)

## Problem

A Web agent works only in a workspace in the browser's private storage ([agent Spec](2026-10-21-web-core-agent.md)), so it cannot edit the user's own files, which is what the desktop's user-chosen workspaces are for; the agent Spec left them out. The design document lists local folders through the File System Access API as the next step for the Web agent.

The desktop composer already offers user-chosen workspaces: the workspace selector calls `window.api.file.selectFolder`, registers the chosen path through the `ai.agent.workspace.register` route, and the session runs in it. In the Web edition the folder dialog has no handler and the route's service is replaced, so the selector fails.

A browser gives a page a folder only as a `FileSystemDirectoryHandle` from `showDirectoryPicker()`, which only Chromium-based browsers (Chrome, Edge) have. The picker needs a user gesture in the page, and after a reload the page may have to ask for the permission again, also in a user gesture. ZenFS's `WebAccess` backend, which mounts the account's OPFS directory, reads every file of the folder into memory on mount and keeps an index that misses changes made outside the app, so it cannot mount a user's project.

## Proposal

The desktop selector, the registration route and the session host stay unchanged; the Web edition answers the folder dialog and mounts the chosen folder in the Worker's file system. All changes stay in `packages/web-core`.

1. **Picking a folder.** The page answers `IpcChannel.File_SelectFolder` itself, inside the click that asked for it: `showDirectoryPicker({ mode: 'readwrite' })`, then the handle goes to the Worker, which returns the folder's path. Cancelling returns `null`, as the desktop dialog does. A browser without the picker shows a toast that local folders need Chrome or Edge and returns `null`.
2. **A folder file system.** A ZenFS backend in the Worker (`LocalFolderFS`) runs every call on the directory handle when it is made: no preload, no cache, no index, so files the user changes in other programs are current. Only the async calls are implemented; sync calls fail with `ENOTSUP`. The file tools and the approval policy (`realpath`) only use async calls, and so does the Worker's `fs.promises.rename`.
3. **Paths and storage.** A folder is mounted at `/local/<id>/<folder name>` and registered as a user workspace with that path, so the composer, the session and the approval policy treat it as the desktop treats a chosen folder. Handles are kept per account in IndexedDB (`cherry-studio-local-folders`) and mounted when the account opens. Picking a folder that is already stored (`isSameEntry`) reuses its id, so it keeps its workspace. `ai.agent.workspace.register` is served for paths of stored folders only.
4. **Permission after a reload.** When the account opens, a folder whose permission is not `granted` is mounted as unavailable: every call fails with `EACCES` and a message that access must be allowed again, so nothing is written elsewhere. The first such call asks the page to show a warning toast with an Allow button; its click calls `requestPermission` and the Worker mounts the folder. Picking the folder again also restores it.
5. **Agent prompt.** The base prompt tells the model whether its workspace is in the browser's private storage or a folder on the user's computer.
6. **Tests.** An OPFS directory handle stands in for the picked folder: it has the same handle API, without the dialog.
   - `e2e/localFolder.spec.ts` (harness, Chromium, WebKit and Firefox) drives the Worker's `fs.promises` on a picked folder, and simulates a lapsed permission in the Worker to check the unavailable mount and the access request.
   - `e2e/agent.spec.ts` gains a Chromium test in which the composer picks the folder, the agent writes a file there after approval, and after a reload reads it; and a test in all three browsers for a browser without the picker.

Python and JavaScript get no access to local folders: Pyodide runs in the sandboxed iframe's opaque origin, which cannot open the app's IndexedDB, and QuickJS gives a script no browser API.

Out of scope: removing a workspace (it deletes the workspace's sessions, which the Web edition does not support yet), local folders in Firefox and Safari, and watching a folder for changes.

## Alternatives considered

- **ZenFS `WebAccess` for the folder.** It works for the account's own OPFS directory, but on mount it walks the whole folder and copies every file into memory; a project with `node_modules` or `.git` would not open, and the index misses outside changes.
- **Copying the folder into OPFS.** The agent would edit a copy, and the user's files would not change.
- **Asking for permission again when the account opens.** `requestPermission` needs a user gesture, and a prompt for every stored folder on every visit asks for folders the user may not use.
- **A Web-only workspace selector.** The desktop selector already does what is needed once the dialog and the route are answered.

## Acceptance criteria

- AC1 — In Chromium, picking a folder in the composer's workspace selector registers it as a workspace named after the folder; an agent turn in `default` mode writes a file there after approval, and the file is in the picked directory. (verification: packaged artifact)
- AC2 — After a reload, the session's workspace is the same folder and the agent reads the file it wrote. (verification: packaged artifact)
- AC3 — On a folder whose permission is not granted, a file call fails with the access message, nothing is written, and the page is asked once to offer access; after access is allowed the same call succeeds. (verification: packaged artifact, with the lapsed permission simulated in the Worker; the browser's own permission prompt needs a real folder and is checked by hand)
- AC4 — In WebKit and Firefox the selector's new-folder action shows the Chrome-or-Edge toast and registers nothing. (verification: packaged artifact)
- AC5 — In Chromium, WebKit and Firefox, `LocalFolderFS` reads, writes, lists, stats, renames and removes files on a directory handle, and sees a file created outside it. The existing Web Core tests still pass, and no file under `src/main`, `src/preload`, `src/renderer` or `src/shared` changes. (verification: packaged artifact and change-scope report)

## Risks

- **Chromium only.** Firefox and Safari have no `showDirectoryPicker`; their users keep the browser workspace.
- **The agent edits real files.** Edits ask for approval in `default` mode as on the desktop, but `acceptEdits`, `auto` and `bypassPermissions` write without asking, and there is no undo.
- **The permission can lapse.** Chrome keeps it across visits only when the user chooses so, or the app is installed; otherwise the toast asks again after a reload.
- **Search cost.** `find` and `grep` walk the folder through the handle API, which is slower than a disk search; they skip `.git` and `node_modules` as before.
