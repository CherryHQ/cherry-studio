import path from 'node:path'

import { isSameOrInside } from '@main/utils/file'

export type WorkspaceInstallDirectoryPolicyInput = {
  workspacePath: string
  installDirectory: string | undefined
  packaged: boolean
  portableBuild: boolean
}

export type WorkspaceInstallDirectoryPolicy =
  | { allowed: true }
  | { allowed: false; reason: 'install_directory'; installDirectory: string }

// Installation protection must recognize equivalent Windows namespaces here
// without changing shared path comparison semantics for other consumers.
function normalizeWindowsNamespacePath(value: string): string {
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`
  return value.replace(/^\\\\[?.]\\/, '')
}

export function evaluateWorkspaceInstallDirectoryPolicy({
  workspacePath,
  installDirectory,
  packaged,
  portableBuild
}: WorkspaceInstallDirectoryPolicyInput): WorkspaceInstallDirectoryPolicy {
  if (!packaged || portableBuild || !installDirectory || !path.isAbsolute(installDirectory)) {
    return { allowed: true }
  }
  return isSameOrInside(normalizeWindowsNamespacePath(workspacePath), normalizeWindowsNamespacePath(installDirectory))
    ? { allowed: false, reason: 'install_directory', installDirectory }
    : { allowed: true }
}

export class WorkspaceInstallDirectoryError extends Error {
  readonly reason = 'install_directory'

  constructor(
    readonly workspacePath: string,
    readonly installDirectory: string
  ) {
    super(`Workspace is inside the Cherry Studio installation directory: ${workspacePath}`)
    this.name = 'WorkspaceInstallDirectoryError'
  }
}
