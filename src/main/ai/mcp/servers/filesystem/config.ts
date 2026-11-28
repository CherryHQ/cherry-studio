export function resolveFilesystemBaseDir(args: string[] = [], envs: Record<string, string> = {}): string[] | undefined {
  const envWorkspaceRoot = envs.WORKSPACE_ROOT?.trim()
  if (envWorkspaceRoot) {
    return [envWorkspaceRoot]
  }

  const roots = args.filter((arg) => typeof arg === 'string' && arg.trim().length > 0).map((arg) => arg.trim())
  return roots.length > 0 ? roots : undefined
}
