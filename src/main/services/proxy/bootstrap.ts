/**
 * Node `--require` preload that applies the app's proxy settings inside spawned Claude Code child processes, which the main process's in-process patching cannot reach (see #13895).
 *
 * Wiring: bundled to `out/proxy/index.js` by `scripts/buildProxyBootstrapPlugin.ts`, then injected via `execArgv` in `claudecode/index.ts` only when a proxy is configured.
 *
 * Do NOT delete: it was removed as "orphaned" in 8fe0d6448a, but it has a live runtime consumer — dropping this entry breaks `pnpm build` and silently disables child-process proxying (notably SOCKS). Restored intentionally.
 */
import { applyNodeProxyFromEnvironment } from './nodeProxy'

try {
  applyNodeProxyFromEnvironment()
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  process.stderr.write(
    `[CherryStudioProxyBootstrap] Proxy bootstrap failed - child process will run WITHOUT proxy: ${message}\n`
  )
}
