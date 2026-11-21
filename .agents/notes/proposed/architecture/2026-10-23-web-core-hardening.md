# Agent Note: Web Core hardening

Status: proposed

English | [中文](2026-10-23-web-core-hardening.zh.md)

## Problem

The design document's milestone M5 hardens the Web edition before release: isolation tests, a Content Security Policy, browser compatibility and load tests. The earlier Specs ([database](2026-10-20-web-core-database.md), [app](2026-10-20-web-core-app.md), [agent](2026-10-21-web-core-agent.md), [local folders](2026-10-23-web-core-local-folder.md)) leave these gaps:

- **No Content Security Policy.** The page serves only COOP and COEP. Everything the app keeps (the database, attachments, provider API keys in preferences) is readable by any script that runs in the page, so a script injected through a model reply or a dependency reaches all of it.
- **Unsupported browsers fail late and unclearly.** The page starts the Core Worker without checking what the browser offers. A browser without OPFS synchronous access handles, a page served without the isolation headers, or a private window where OPFS is unavailable ends in "Cherry Studio could not start" with a low-level message, or in a spinner.
- **The browser may evict the data.** The page never asks for persistent storage, so under storage pressure the browser may delete the account's OPFS directory without asking. Until backup exists (milestone M4, which waits for the enterprise backend), nothing recovers it.
- **Untrusted content is not tested against the account data.** The Python sandbox is (agent Spec AC4). Generated HTML in chat previews, Markdown in model replies and QuickJS scripts are not.
- **No long-session measurements.** The database Spec measured start-up at 50k messages; nothing measures a long chat or agent session, where memory leaks and slowdowns would show.
- **No capability matrix.** #21728 asks that unsupported desktop features be explained to users; the README lists replaced modules, not what a user can and cannot do.

## Proposal

Most changes are in `packages/web-core`. The desktop renderer gains two things the Web edition sets differently: a switch on the first-run page (`enableCherryInLogin`), which the Web edition turns off because CherryIN signs in through a callback on the computer, which a Web page cannot receive; and a module, `src/renderer/utils/hostFeatures.ts`, that says what the app around the renderer can do (item 6). The desktop sets every entry of it true, so it shows what it showed before; web-core replaces the module with one that sets them false.

1. **Content Security Policy.** web-core defines the policy once and serves it as a response header with COOP and COEP from the dev server and `vite preview`; the app build writes the headers to `dist/app/_headers` (the file Cloudflare Pages and Netlify read), and the README explains them for other hosts.
   - `default-src 'self'`; `object-src 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. No `base-uri`: the desktop's HTML previews set `<base href="about:srcdoc">`, and `script-src` already limits where scripts come from.
   - `script-src 'self' 'wasm-unsafe-eval'`, plus the Pyodide CDN (`https://cdn.jsdelivr.net/pyodide/`). Inline scripts run only by hash: the build hashes the Pyodide sandbox frame's script, the only inline script the app needs. No `'unsafe-eval'`, no `'unsafe-inline'` for scripts: zod probes `eval` to compile faster parsers, so the page and the Worker turn that off (`jitless`) before any schema runs.
   - `worker-src 'self' data:` (the Pyodide worker starts from a `data:` URL, see the agent Spec); `frame-src 'self' data: blob:` for previews.
   - `style-src 'self' 'unsafe-inline'`: the desktop renderer injects styles at runtime; styles cannot run scripts.
   - `img-src`, `media-src` and `font-src`: `'self' data: blob:`, plus `https:` for images and media, which model replies and provider logos load from anywhere.
   - `connect-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*`: the community edition sends model requests from the browser to providers the user configures, so any HTTPS host and local model servers must be reachable. An edition narrows it (the enterprise edition to its backend and gateway) through the same function.
   In the e2e runs the policy carries a `report-uri` to the mock server, which also receives reports from Workers and frames, and every test fails on a violation report, so a feature blocked by the policy cannot ship unnoticed.
2. **Start-up check.** Before starting the Core Worker, the page checks that it is cross-origin isolated, that module Workers, WebAssembly and OPFS are present, and the Worker checks that it can open a synchronous access handle. A failure replaces the spinner with its cause, in the start screen's languages:
   - not cross-origin isolated: the site is served without the required headers, which a site administrator must fix;
   - a missing feature: the browser is not supported, naming the supported browsers;
   - OPFS refused (e.g. some private windows): the browser does not allow storage for this site.
   Supported browsers are the current and previous major versions of Chrome, Edge, Firefox and Safari, the versions the e2e suite runs; the check is by feature, so other browsers with the features also start.
3. **Persistent storage.** When the account opens, the page asks for persistent storage (`navigator.storage.persist()`). If the browser refuses, the page shows a warning toast once per account: the browser may delete the data under storage pressure, and site data should not be cleared.
4. **Isolation tests** (e2e, three browsers):
   - A model reply with HTML that tries to run script (`<script>`, `<img onerror>`, `javascript:` links) runs none of it.
   - An HTML code block's preview runs no script and cannot read the page's storage: the desktop's restricted preview sandbox already guarantees this, and the test keeps it so.
   - A QuickJS script finds no `fetch`, `indexedDB`, `navigator` or `postMessage`.
   - Existing tests already cover Python's opaque origin and the agent's approvals.
5. **Load tests** (e2e, Chromium, which measures memory with `performance.measureUserAgentSpecificMemory()`):
   - **Long chat:** 200 turns in one topic against the mock provider. The time from sending to the reply showing and the memory of the page and its Workers are recorded every 50 turns.
   - **Long agent session:** 50 agent turns that each write and read a file. The same measurements are recorded.
   - The results go into this note when it becomes implemented.
6. **Capability matrix.** The README gains a table of what the Web edition can do and what stays on the desktop, by user-facing feature (chat, attachments, agent tools, Python, JavaScript, local folders, MCP, knowledge bases, mini apps, backup, and so on), with the browsers each needs. Features the Web edition does not support already answer with `WebUnsupportedError`; the table is where a user or an administrator reads it. The Web app also stops offering the entries that lead to them: the launchpad's other apps, the composer's tools, the message menu's notes, knowledge base, read-aloud and note-app exports, the agent's browser, dictation, the help menu, the Cherry account in the user menu and the CherryIN sign-in. Saving or exporting a message as Markdown or an image becomes a browser download, and the agent's file tree and file preview are served.
   - The renderer hides an entry when `hostFeatures` says the app cannot carry it out: more windows, opening paths in the computer's apps, app zoom, updates, developer tools, image uploads, file storage (attachments and the files page), Word documents' text, notes, knowledge bases, MCP servers for assistants, mini apps, paintings, dictation and reading aloud, diagnostics, the agent browser, computer use, the desktop program's own settings (start at login, tray, network access, GPU and power use, native menus, the spell checker's languages), installed fonts, Claude Code agents, provider sign-ins and the built-in CherryAI model. Settings search leaves out the rows it hides.
   - Preferences that only the desktop program acts on (developer mode, the native menu style, the agent browser pane) are set off on every start (`fixedWebPreferences`), also in workspaces where they were on.
   - The built-in CherryAI model needs the client secret built into the desktop app, so first-run setup on the Web cannot be skipped: the user sets up a provider first.
   - A Pi agent's edit dialog stops offering environment variables, which only the Claude Code runtime reads (a runtime capability, `envVars`). This also changes the desktop, where the field had no effect on Pi agents.
   - The file tree's fuzzy scoring moves from `src/main/services/file/tree/search.ts` into `fuzzyScore.ts`, which the Worker's file search reuses.
7. **Renderer-call guard.** An e2e test (`e2e/rendererCalls.spec.ts`) collects every IpcApi route and legacy `window.api` channel the renderer source calls, and every call the Web edition answers (the Worker's handlers and channels, and the page's `answerInPage` and `handleInPage`). A call the Web edition does not answer must be listed with the reason its caller cannot be reached on the Web (a page outside the Web menus, a `hostFeatures` entry, a fixed preference). A new unanswered call fails the test, and so does a listed entry that no longer needs listing.

Out of scope: hardening of the enterprise Web app (its CSP `connect-src`, the access token kept in Worker memory, isolation between profiles), which is in the enterprise repository; backend authorization, tracked with the enterprise backend; backup and recovery (M4); and the evidence for #21728's acceptance items that depend on backup.

## Alternatives considered

- **A CSP `<meta>` tag instead of a header.** Works on any static host without configuration, but cannot set `frame-ancestors` and applies only after the tag is parsed. The deployment already has to set COOP and COEP headers, so the CSP joins them.
- **Nonces instead of a hash for the inline script.** Nonces need a server that renders each response; the app is static files.
- **Restricting `connect-src` in the community edition.** Model requests go to providers the user adds, so any list would break custom providers.
- **Asking for persistent storage only when the user acts.** Chrome and Edge decide without a prompt; Firefox shows its own prompt. Asking at open protects the data from the first visit.
- **Load tests in every browser.** Only Chromium can measure the Worker's memory; timings in WebKit and Firefox come from the existing scale tests.
- **Hiding entries only from web-core, by replacing each renderer module that shows one.** Keeps the desktop sources unchanged, but copies dozens of desktop modules into web-core, where they drift from the desktop. One `hostFeatures` module keeps each entry and its condition in the desktop source.

## Acceptance criteria

- AC1 — The dev server and `vite preview` serve the CSP above with COOP and COEP, and the app build writes them to `dist/app/_headers`. The full e2e suite passes in Chromium, WebKit and Firefox under it with no violation report. (verification: packaged artifact)
- AC2 — A page served without the isolation headers, a browser without OPFS synchronous access handles (simulated), and a refused OPFS (simulated) each show their own start-screen message, not a spinner or a generic error. (verification: packaged artifact)
- AC3 — Opening an account asks for persistent storage; when it is refused (simulated), one warning toast appears per account and not again after a reload; when it is granted, none appears. (verification: packaged artifact)
- AC4 — In all three browsers, scripts in a model reply's HTML and in an HTML code block's preview do not run and cannot read OPFS, and a QuickJS script sees none of `fetch`, `indexedDB`, `navigator` or `postMessage`. (verification: packaged artifact)
- AC5 — The long chat and long agent session tests run in Chromium and record reply times and the memory of the page and its Workers every 50 turns (chat) and every 10 turns (agent), in this note. Memory after turn 200 (chat) and turn 50 (agent) is at most 1.5 times the memory after turn 50 (chat) and turn 10 (agent), and the last ten replies take on average at most twice as long as the first ten. (verification: packaged artifact)
- AC6 — The README has the capability matrix, and every route the matrix lists as desktop-only answers with `WebUnsupportedError`. The Web app shows none of the entries listed in item 6 and saves a message as a download. First-run setup cannot be skipped. Under `src/main`, `src/preload`, `src/renderer` and `src/shared`, the only changes are the first-run switch, `hostFeatures` and the code that hides entries by it (including settings search and the topic menu's optional save actions), the `envVars` runtime capability, the fuzzy-scoring module, and their tests; apart from a Pi agent's environment variables, the desktop shows the entries it showed before. (verification: packaged artifact, change-scope report and code review)
- AC7 — `e2e/rendererCalls.spec.ts` passes: every IpcApi route and `window.api` channel the renderer calls is answered by the Worker or the page, or listed with the reason its caller cannot be reached on the Web, and no listed entry is stale. (verification: packaged artifact)

## Risks

- **`'unsafe-inline'` styles.** CSS can still exfiltrate data through selectors and background images in theory; the risk is far smaller than script injection, and removing it would mean changing the desktop renderer's styling.
- **`connect-src https:` in the community edition.** An injected script, if one ever ran, could still send data anywhere. The CSP makes running one much harder; it does not limit where data goes.
- **Persistent storage is the browser's call.** Chrome grants it by site engagement, so a first-time visitor is often refused; the warning is the only mitigation until backup exists.
- **Load thresholds come from a mock provider.** Real providers stream more slowly and with larger replies; the tests detect leaks and slowdowns in the app, not real-world speed.
- **A full storage fails with a generic error.** Browsers give a site a large share of the disk (Chrome and Safari up to 60%, Firefox 10%), so a trial account is unlikely to fill it; a write that fails then shows the desktop's generic error.
- **New desktop entries.** A new renderer entry that needs the desktop shows on the Web until it reads `hostFeatures`. The renderer-call guard catches it when it calls a route the Web edition does not answer, not when it only changes a setting nothing on the Web reads.
- **CDN dependence.** Pyodide still loads from jsDelivr; a deployment that blocks it loses Python. Hosting Pyodide with the app is left to a later change.
