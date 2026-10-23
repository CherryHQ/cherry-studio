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

All changes are in `packages/web-core`; desktop sources are not changed.

1. **Content Security Policy.** web-core defines the policy once and serves it as a response header with COOP and COEP from the dev server and `vite preview`; the README gives it for static hosting.
   - `default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`.
   - `script-src 'self' 'wasm-unsafe-eval'`, plus the Pyodide CDN (`https://cdn.jsdelivr.net/pyodide/`). Inline scripts run only by hash: the build hashes the Pyodide sandbox frame's script, the only inline script the app needs. No `'unsafe-eval'`, no `'unsafe-inline'` for scripts.
   - `worker-src 'self' data:` (the Pyodide worker starts from a `data:` URL, see the agent Spec); `frame-src 'self' data: blob:` for previews.
   - `style-src 'self' 'unsafe-inline'`: the desktop renderer injects styles at runtime; styles cannot run scripts.
   - `img-src`, `media-src` and `font-src`: `'self' data: blob:`, plus `https:` for images and media, which model replies and provider logos load from anywhere.
   - `connect-src 'self' data: blob: https:`: the community edition sends model requests from the browser to providers the user configures, so any HTTPS host must be reachable. An edition narrows it (the enterprise edition to its backend and gateway) through the same function.
   Every e2e page records `securitypolicyviolation` events, and a test fails on any violation, so a feature blocked by the policy cannot ship unnoticed.
2. **Start-up check.** Before starting the Core Worker, the page checks that it is cross-origin isolated, that module Workers, WebAssembly and OPFS are present, and the Worker checks that it can open a synchronous access handle. A failure replaces the spinner with its cause, in the start screen's languages:
   - not cross-origin isolated: the site is served without the required headers (a deployment problem, with a link to the README section);
   - a missing feature: the browser is not supported, naming the supported browsers;
   - OPFS refused (e.g. some private windows): the browser does not allow storage for this site.
   Supported browsers are the current and previous major versions of Chrome, Edge, Firefox and Safari, the versions the e2e suite runs; the check is by feature, so other browsers with the features also start.
3. **Persistent storage.** When the account opens, the page asks for persistent storage (`navigator.storage.persist()`). If the browser refuses, the page shows a warning toast once per account: the browser may delete the data under storage pressure, and site data should not be cleared. The Worker treats a full storage (`QuotaExceededError`, `SQLITE_FULL`) as a known error, and the page shows a toast saying the browser's storage for this site is full, instead of a generic failure.
4. **Isolation tests** (e2e, three browsers):
   - A model reply with HTML that tries to run script (`<script>`, `<img onerror>`, `javascript:` links) runs none of it.
   - An HTML code block's preview runs no script and cannot read the page's storage: the desktop's restricted preview sandbox already guarantees this, and the test keeps it so.
   - A QuickJS script finds no `fetch`, `indexedDB`, `navigator` or `postMessage`.
   - Existing tests already cover Python's opaque origin and the agent's approvals.
5. **Load tests** (e2e, Chromium, which measures memory with `performance.measureUserAgentSpecificMemory()`):
   - **Long chat:** 200 turns in one topic against the mock provider. The time from sending to the first streamed token and the memory of the page and the Worker are recorded every 50 turns.
   - **Long agent session:** 50 agent turns that each write and read a file. The same measurements are recorded.
   - The results go into this note when it becomes implemented.
6. **Capability matrix.** The README gains a table of what the Web edition can do and what stays on the desktop, by user-facing feature (chat, attachments, agent tools, Python, JavaScript, local folders, MCP, knowledge bases, mini apps, backup, and so on), with the browsers each needs. Features the Web edition does not support already answer with `WebUnsupportedError`; the table is where a user or an administrator reads it.

Out of scope: hardening of the enterprise Web app (its CSP `connect-src`, the access token kept in Worker memory, isolation between profiles), which is in the enterprise repository; backend authorization, tracked with the enterprise backend; backup and recovery (M4); and the evidence for #21728's acceptance items that depend on backup.

## Alternatives considered

- **A CSP `<meta>` tag instead of a header.** Works on any static host without configuration, but cannot set `frame-ancestors` and applies only after the tag is parsed. The deployment already has to set COOP and COEP headers, so the CSP joins them.
- **Nonces instead of a hash for the inline script.** Nonces need a server that renders each response; the app is static files.
- **Restricting `connect-src` in the community edition.** Model requests go to providers the user adds, so any list would break custom providers.
- **Asking for persistent storage only when the user acts.** Chrome and Edge decide without a prompt; Firefox shows its own prompt. Asking at open protects the data from the first visit.
- **Load tests in every browser.** Only Chromium can measure the Worker's memory; timings in WebKit and Firefox come from the existing scale tests.

## Acceptance criteria

- AC1 — The dev server and `vite preview` serve the CSP above with COOP and COEP. The full e2e suite passes in Chromium, WebKit and Firefox under it and records no `securitypolicyviolation` event; the README gives the header for static hosting. (verification: packaged artifact)
- AC2 — A page served without the isolation headers, a browser without OPFS synchronous access handles (simulated), and a refused OPFS (simulated) each show their own start-screen message, not a spinner or a generic error. (verification: packaged artifact)
- AC3 — Opening an account asks for persistent storage; when it is refused (simulated), one warning toast appears per account and not again after a reload. A database write that fails because storage is full shows the storage-full toast. (verification: packaged artifact)
- AC4 — In all three browsers, scripts in a model reply's HTML and in an HTML code block's preview do not run and cannot read OPFS, and a QuickJS script sees none of `fetch`, `indexedDB`, `navigator` or `postMessage`. (verification: packaged artifact)
- AC5 — The long chat and long agent session tests run in Chromium and record send-to-first-token times and page and Worker memory every 50 turns, in this note. Memory after turn 200 (chat) and turn 50 (agent) is at most 1.5 times the memory after turn 50 (chat) and turn 10 (agent), and the time to the first token after the last turn is at most twice that after the first. (verification: packaged artifact)
- AC6 — The README has the capability matrix, and every route the matrix lists as desktop-only answers with `WebUnsupportedError`. No file under `src/main`, `src/preload`, `src/renderer` or `src/shared` changes. (verification: change-scope report and code review)

## Risks

- **`'unsafe-inline'` styles.** CSS can still exfiltrate data through selectors and background images in theory; the risk is far smaller than script injection, and removing it would mean changing the desktop renderer's styling.
- **`connect-src https:` in the community edition.** An injected script, if one ever ran, could still send data anywhere. The CSP makes running one much harder; it does not limit where data goes.
- **Persistent storage is the browser's call.** Chrome grants it by site engagement, so a first-time visitor is often refused; the warning is the only mitigation until backup exists.
- **Load thresholds come from a mock provider.** Real providers stream more slowly and with larger replies; the tests detect leaks and slowdowns in the app, not real-world speed.
- **CDN dependence.** Pyodide still loads from jsDelivr; a deployment that blocks it loses Python. Hosting Pyodide with the app is left to a later change.
