export function resolveFilesystemBaseDir(args: string[] = [], envs: Record<string, string> = {}): string[] {
  const envWorkspaceRoot = envs.WORKSPACE_ROOT?.trim()
  if (envWorkspaceRoot) {
    return [envWorkspaceRoot]
  }

  return args.filter((arg) => typeof arg === 'string' && arg.trim().length > 0).map((arg) => arg.trim())
}
