/**
 * Resolve every configured filesystem root.
 *
 * `WORKSPACE_ROOT` keeps overriding positional args, matching the single-root
 * contract this server shipped with. Otherwise each non-empty argument is an
 * allowed root, in the order the user configured them: the first is also the
 * base for relative paths.
 */
export function resolveFilesystemBaseDirs(
  args: string[] = [],
  envs: Record<string, string> = {}
): string[] {
  const envWorkspaceRoot = envs.WORKSPACE_ROOT?.trim()
  if (envWorkspaceRoot) {
    return [envWorkspaceRoot]
  }

  const roots = args
    .filter((arg): arg is string => typeof arg === 'string')
    .map((arg) => arg.trim())
    .filter(Boolean)

  return Array.from(new Set(roots))
}
