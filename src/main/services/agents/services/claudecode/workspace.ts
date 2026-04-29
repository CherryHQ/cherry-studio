export function applyWorkspaceRoot(env: Record<string, string>, cwd?: string): Record<string, string> {
  if (cwd) {
    env.WORKSPACE_ROOT = cwd
  }

  return env
}
