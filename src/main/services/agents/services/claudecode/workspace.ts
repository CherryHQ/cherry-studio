export function applyWorkspaceRoot(
  env: Record<string, string | undefined>,
  cwd?: string
): Record<string, string | undefined> {
  if (cwd) {
    env.WORKSPACE_ROOT = cwd
  }

  return env
}
