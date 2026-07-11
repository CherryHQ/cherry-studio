import { joinPath } from '@renderer/utils/path'

/**
 * Pure path / selection helpers shared by `ArtifactPane` and the
 * `useArtifactFileTreeModel` hook. Extracted into their own module so the
 * hook (which the agent page imports to lift the tree model above the
 * Host↔Overlay remount boundary) and the presentational component can both
 * depend on them without forming an import cycle.
 */

/** Synthetic id/path for the workspace root node in the projected file tree. */
export const WORKSPACE_ROOT_ID = '__workspace_root__'

export interface ArtifactPaneFileSelection {
  workspacePath: string
  filePath: string
}

export const getPathBasename = (path: string): string => {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return path
  const segments = trimmed.split(/[/\\]+/).filter(Boolean)
  return segments.at(-1) ?? trimmed
}

export const normalizeTreePath = (path: string): string => {
  const normalized = path.trim().replace(/\\/g, '/')
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(withoutTrailingSlash)) return `${withoutTrailingSlash}/`
  if (!withoutTrailingSlash && normalized.startsWith('/')) return '/'
  return withoutTrailingSlash
}

export const isAbsoluteTreePath = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:\//.test(path)

export const hasParentTraversal = (path: string): boolean => path.split(/[/\\]+/).some((segment) => segment === '..')

export const getPathDirname = (path: string): string => {
  const normalized = normalizeTreePath(path)
  const basename = getPathBasename(normalized)
  if (!basename || normalized === basename) return ''

  const dirname = normalized.slice(0, normalized.length - basename.length).replace(/\/+$/, '')
  if (!dirname && normalized.startsWith('/')) return '/'
  if (/^[A-Za-z]:$/.test(dirname)) return `${dirname}/`
  return dirname
}

export const normalizeArtifactPaneFilePath = (workspacePath: string, rawPath: string): string | null => {
  const workspace = normalizeTreePath(workspacePath)
  const normalized = normalizeTreePath(rawPath)
  if (!normalized) return null

  if (normalized === workspace) return null
  if (workspace === '/' && normalized.startsWith('/')) return normalized.slice(1)
  if (normalized.startsWith(`${workspace}/`)) return normalized.slice(workspace.length + 1)
  if (isAbsoluteTreePath(normalized)) return null

  return normalized.replace(/^\/+/, '')
}

export const resolveArtifactPaneFileSelection = (
  workspacePath: string | undefined,
  rawPath: string
): ArtifactPaneFileSelection | null => {
  const normalized = normalizeTreePath(rawPath)
  if (!normalized) return null

  if (workspacePath) {
    const workspaceFilePath = normalizeArtifactPaneFilePath(workspacePath, normalized)
    if (workspaceFilePath) {
      if (!hasParentTraversal(workspaceFilePath)) {
        return { workspacePath, filePath: workspaceFilePath }
      }
      // Deliberate: a workspace-relative artifact path that climbs out via `..` is allowed — the
      // agent legitimately creates files outside the workspace — but re-root it to the resolved
      // file's directory (like the absolute-path branch below) so the displayed tree root and the
      // previewed file stay consistent, instead of showing the workspace while reading outside it.
      // Sandboxing, if ever needed, is the consumer's responsibility at the trust boundary.
      const resolvedAbsolute = joinPath(normalizeTreePath(workspacePath), workspaceFilePath)
      const escapedWorkspacePath = getPathDirname(resolvedAbsolute)
      const escapedFilePath = getPathBasename(resolvedAbsolute)
      return escapedWorkspacePath && escapedFilePath && escapedFilePath !== escapedWorkspacePath
        ? { workspacePath: escapedWorkspacePath, filePath: escapedFilePath }
        : null
    }
  }

  if (!isAbsoluteTreePath(normalized)) return null

  const externalWorkspacePath = getPathDirname(normalized)
  const filePath = getPathBasename(normalized)
  if (!externalWorkspacePath || !filePath || filePath === externalWorkspacePath) return null

  return { workspacePath: externalWorkspacePath, filePath }
}
