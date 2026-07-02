/**
 * Detects shell commands that install dependencies into a GLOBAL / shared
 * location and would therefore leak across agent sessions.
 *
 * The agent runtime keeps the user's real HOME (so the launched CLIs read their
 * config/creds — see binaryEnv.ts `getBinaryExecutionEnv`), which means a global
 * install lands in `~/.bun`, `~/.local/share/uv`, etc. — shared by every agent
 * and polluting the user's machine. Project-local installs (cwd `node_modules` /
 * `.venv`, isolated per workspace) and ephemeral runners (`bun x` / `uvx`) are
 * safe and intentionally NOT flagged.
 *
 * Best-effort and non-adversarial: agents default to the conventional global
 * forms below; this catches those, not deliberate obfuscation.
 */

// A `-g` / `--global` flag as a standalone token (not a substring of a package
// name like `some-g-pkg`).
const GLOBAL_FLAG = /(?:^|\s)(?:-g|--global)(?:\s|$)/

const RULES: Array<{ test: (seg: string) => boolean; reason: string }> = [
  {
    // npm / pnpm / yarn / bun  <install|i|add>  -g|--global
    test: (s) => /\b(?:npm|pnpm|yarn|bun)\b/.test(s) && /\b(?:install|i|add)\b/.test(s) && GLOBAL_FLAG.test(s),
    reason: 'global JS package install (-g/--global)'
  },
  {
    // yarn global add <pkg>
    test: (s) => /\byarn\s+global\s+add\b/.test(s),
    reason: 'yarn global add'
  },
  {
    // Persistent global Python tools — `uvx` (ephemeral) is the allowed form.
    test: (s) => /\buv\s+tool\s+install\b/.test(s),
    reason: 'uv tool install (persistent global tool — use `uvx` for one-off runs)'
  },
  {
    test: (s) => /\bpipx\s+install\b/.test(s),
    reason: 'pipx install (global)'
  },
  {
    // pip installing outside a project venv (--user / --system / system override).
    test: (s) => /\bpip3?\s+install\b/.test(s) && /(?:^|\s)(?:--user|--system|--break-system-packages)(?:\s|$)/.test(s),
    reason: 'global pip install (--user/--system/--break-system-packages)'
  },
  {
    test: (s) => /\buv\s+pip\s+install\b/.test(s) && /(?:^|\s)--system(?:\s|$)/.test(s),
    reason: 'uv pip install --system'
  }
]

/**
 * Returns a short human reason when `command` performs a global/shared install,
 * or `null` when it is safe (project-local, ephemeral, or unrelated).
 */
export function detectGlobalInstall(command: string): string | null {
  // Test each chained segment independently so a flag in one command can't be
  // mis-attributed to a manager keyword in another (`ls && npm i -g x`).
  const segments = command.split(/&&|\|\||[;\n|]/)
  for (const raw of segments) {
    const seg = raw.trim()
    if (!seg) continue
    for (const rule of RULES) {
      if (rule.test(seg)) return rule.reason
    }
  }
  return null
}
