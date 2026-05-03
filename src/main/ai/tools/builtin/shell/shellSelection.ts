/**
 * Pick which shell to invoke for `shell__exec`.
 *
 *   Unix-likes:  $SHELL → /bin/bash (fallback)
 *   Windows:     pwsh → powershell.exe (fallback)
 *
 * The `flag` is the option that introduces a command string for that shell:
 *   bash/zsh/sh → "-c"
 *   pwsh / powershell.exe → "-Command"
 *
 * Caller spawns: `spawn(shell, [flag, commandString], { cwd, env })`.
 *
 * `platform` and `envShell` are accepted as overrides so tests can pin a
 * scenario without monkey-patching `process`.
 */

import { platform as osPlatform } from 'node:os'

export interface ShellSelection {
  shell: string
  flag: string
}

export function selectShell(opts?: { platform?: NodeJS.Platform; envShell?: string }): ShellSelection {
  const p = opts?.platform ?? osPlatform()
  if (p === 'win32') {
    return { shell: 'pwsh', flag: '-Command' }
  }
  const shell = opts?.envShell ?? process.env.SHELL ?? '/bin/bash'
  return { shell, flag: '-c' }
}
