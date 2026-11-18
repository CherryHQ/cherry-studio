# Testing a Mini App

## What the scripts prove

`node scripts/validate.mjs <appDir>` — authoring-time contract check: manifest shape against the packaged contract, icon digest against bytes, and a scan that rejects any asset referencing a development server (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`, any `ws://`/`http://` loopback with a port). Exit code 0 and a JSON summary on success; exit code 1 with every finding on failure.

`node scripts/package.mjs <appDir> <out.miniapp>` — validates, then writes a deterministic ZIP: entries sorted by POSIX path, fixed DOS timestamp, no extra fields, deflate level 9. Two runs over unchanged input produce byte-identical output, so the printed `{ sha256, sizeBytes }` is the package's identity. Any later validation or preview token is bound to that digest — repackage and every earlier report is void.

What the scripts do NOT prove: that the app runs under the real MiniApp protocol, CSP, bridge, permissions and quotas. Only a host preview does that.

## Host preview (when the authoring tools exist)

With the `mini_app` / `miniapp-browser` tools: `validate` the packaged artifact to obtain an `artifactToken`, `preview` it, drive the bound preview page (snapshot, click, type, wait, logs, screenshots), then `close`. Preview storage and files are temporary and never migrate into an installed app. Automation must never touch host permission or installation dialogs — if a flow requires one, stop and hand it to the user.

Without those tools: deliver the validated package plus its SHA-256, state clearly that no real-runtime testing or installation was performed, and point at the upgrade path. Never imply a preview happened.

## Repair loop

At most three consecutive automated repair rounds (validate/package/preview failure → fix → retry). After the third failure, stop: report the failing round, the evidence (validator findings, preview logs, screenshots), and the recovery steps a human should take. Do not keep re-rolling.
