export function resolveFilesystemBaseDir(args: string[] = [], envs: Record<string, string> = {}): string | undefined {
  const envWorkspaceRoot = envs.WORKSPACE_ROOT?.trim()
  if (envWorkspaceRoot) {
    return envWorkspaceRoot
  }

  return args.find((arg) => typeof arg === 'string' && arg.trim().length > 0)?.trim()
}
