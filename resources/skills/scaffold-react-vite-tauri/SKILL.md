---
name: scaffold-react-vite-tauri
description: >
  Wrap a scaffolded Vite/React project in a Tauri 2 shell. Tauri 2 supports
  desktop (macOS/Windows/Linux) + mobile (iOS + Android) from the same source.
  The Vite dist is served by Tauri's WebView; the React app's responsive
  primitives (useBreakpoint, ResponsiveShell) drive form-factor switching
  automatically.
---

> ## UNAVAILABLE IN THIS PROJECT
>
> This skill drives a shell scaffolder that `prometheus-skills-mini` does not ship. The scaffolders are
> 2,879 lines of bash across 7 files that generate React/Vite/Tauri/Flutter starter projects; porting
> them is a separate change from the refiner core, and this project forbids executing a `.sh` at all
> (C1, C3) — so the commands below **will not run here**.
>
> The skill is carried rather than deleted so its interface and intent stay visible, and it says so
> loudly rather than appearing functional and failing on invocation. A loud absence beats a silent
> breakage.
>
> **Follow-up:** port the scaffolders to Node, or drop these skills. Tracked in
> `.prometheus/decisions.md` (2026-09-21, scope of the artifact-refiner port).

# Scaffold React + Vite + Tauri (Hybrid)

Take a project already scaffolded by `scaffold-react-vite` and add a Tauri 2
hybrid shell. Desktop, iOS, and Android targets share the same source.

## Setup

1. The target React project must already exist (run `scaffold-react-vite` first)
2. Set `artifact_type: scaffold-hybrid`
3. Set `content_type: direct:scaffold`

## User Input

The user will provide: $ARGUMENTS

Parse the arguments for:
- `--target <path>` (required) — the scaffolded React project root
- `--bundle-id <reverse-dns>` (optional; default `com.example.<kebab-name>`)
- `--mobile` (optional flag) — also init iOS and Android targets (requires platform SDKs)

## Prerequisites

| Tool | Required for | How |
|---|---|---|
| `cargo` + `rustup` | All targets | https://rustup.rs/ |
| `pnpm` | All targets | `corepack enable pnpm` |
| Xcode | iOS | App Store |
| Android SDK + `ANDROID_HOME` | Android | Android Studio |

The script pre-flights for these and skips gracefully when SDKs absent.

## Procedure

Dispatch to the orchestration script:

```bash
bash scripts/scaffold-react-vite-tauri.sh \
  --target "${TARGET}" \
  ${BUNDLE_ID:+--bundle-id "${BUNDLE_ID}"} \
  ${MOBILE:+--mobile}
```

The script:

1. Pre-flights for `cargo`, `rustup`, `pnpm` (and Xcode/Android SDK if `--mobile`)
2. Installs `@tauri-apps/cli` (dev) + `@tauri-apps/api` (runtime)
3. Runs `pnpm tauri init --ci` with non-interactive flags pointing at the existing Vite output
4. Customizes `src-tauri/tauri.conf.json`:
   - `identifier` set to bundle ID
   - `app.withGlobalTauri = false` (use `@tauri-apps/api` imports)
   - Conservative CSP allowing `http://localhost:*` for dev + `https:` for prod APIs
5. If `--mobile`: runs `pnpm tauri ios init` and `pnpm tauri android init` (skipped gracefully if SDKs absent)
6. Adds `tauri` script to `package.json`
7. Verifies with `pnpm tauri info`

## Default Constraints

- Tauri 2 only (Tauri 1 is legacy)
- Desktop targets: macOS, Windows, Linux — all standard
- Mobile: iOS + Android — requires platform SDKs
- Frontend dist points at `../dist` (the Vite output)
- Dev URL points at `http://localhost:5173` (Vite's default)
- React app's `useBreakpoint` hook drives layout — Tauri desktop window resized small switches to mobile layout

## When to Use This Skill

| Scenario | Use? |
|---|---|
| Ship a desktop app + iOS + Android from one React source | ✅ |
| Single-binary self-contained server (no Tauri) | ❌ use `--with-axum-wrapper` from `scaffold-react-vite` |
| Static deploy to Vercel/Netlify | ❌ Tauri not needed; PWA already works |
| Want native menu bar, native window controls | ✅ but customize `tauri.conf.json` |

## PWA + Tauri coexistence

The scaffolded React project already includes a PWA manifest + service worker
(from `scaffold-react-vite` Block B). When deployed as a Tauri app:

- Tauri's WebView serves assets via its own protocol; the SW registration runs but the SW intercepts won't matter
- The PWA manifest is harmless inside Tauri but unused
- The same `dist/` works for web, PWA install, and Tauri without conditional builds

## Composition with Other Skills

```
HTMX artifact → convert-htmx-react → TSX
                                     ↓
                         scaffold-react-vite (web/PWA + responsive + zustand)
                                     ↓
                         scaffold-react-vite-tauri (this skill)
                                     ↓
                         Desktop binary + iOS app + Android app
                         (or pnpm build → static PWA deploy)
```

## Output Contract

```yaml
artifact_type: scaffold-hybrid
content_type: direct:scaffold
outputs:
  - path: <target>/src-tauri/
    description: Tauri 2 project with Cargo.toml, tauri.conf.json, capabilities, src/main.rs
constraints_satisfied:
  - tauri_2_init_succeeded
  - bundle_id_set
  - tauri_conf_security_csp_set
  - global_tauri_disabled
  - frontend_dist_pointed_at_vite_output
  - tauri_info_exits_0
```

## References

- `scripts/scaffold-react-vite-tauri.sh` — the orchestration script
- `references/scaffolds/responsive-architecture.md` — form-factor strategy
- Tauri 2 docs — https://v2.tauri.app/
