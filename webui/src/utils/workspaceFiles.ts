import type { WebUiWorkspaceFileEntry } from '../types/api'

export type WebUiWorkspaceTreeNode = WebUiWorkspaceFileEntry & {
  readonly children?: readonly WebUiWorkspaceTreeNode[]
}

const imageExtensions = new Set(['avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const markdownExtensions = new Set(['markdown', 'md', 'mdx'])
const inlineFilePathLocationPattern = /(?::\d+){1,2}$/
const pathSegmentPattern = String.raw`[^/\n\r\`"'<>|]+`
const absoluteUnixPathPattern = new RegExp(String.raw`^/(?!/)(?:${pathSegmentPattern}/)+${pathSegmentPattern}/?$`)
const absoluteWindowsPathPattern = /^[A-Za-z]:[\\/](?:[^\\/\n\r`"'<>|]+[\\/])*[^\\/\n\r`"'<>|]+\.?[^\\/\n\r`"'<>|]*$/
const relativeExplicitPathPattern = new RegExp(String.raw`^\.{1,2}/(?:${pathSegmentPattern}/)*${pathSegmentPattern}/?$`)
const homeRelativeFilePathPattern = new RegExp(
  String.raw`^~[/\\](?:${pathSegmentPattern}[/\\])*${pathSegmentPattern}/?$`
)
const workspaceRelativeFilePathPattern = new RegExp(
  String.raw`^(?:${pathSegmentPattern}/)+${pathSegmentPattern}\.[^/\`"'<>|.]+$`
)

const normalizePath = (value: string) => value.trim().replaceAll('\\', '/').replace(/\/+$/g, '')

const sortNodes = <T extends Pick<WebUiWorkspaceTreeNode, 'isDirectory' | 'name'>>(nodes: readonly T[]): T[] =>
  [...nodes].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
    return left.name.localeCompare(right.name)
  })

export const normalizeInlineFilePath = (value: string) =>
  value
    .trim()
    .replace(/^[`("'[]+|[`)"'\],.;:!?]+$/g, '')
    .replace(inlineFilePathLocationPattern, '')

export const isInlineFilePath = (value: string) => {
  const normalizedPath = normalizeInlineFilePath(value).replaceAll('\\', '/')
  return (
    absoluteUnixPathPattern.test(normalizedPath) ||
    absoluteWindowsPathPattern.test(normalizeInlineFilePath(value)) ||
    homeRelativeFilePathPattern.test(normalizeInlineFilePath(value)) ||
    relativeExplicitPathPattern.test(normalizedPath) ||
    workspaceRelativeFilePathPattern.test(normalizedPath)
  )
}

export const isAbsoluteWorkspaceRequestPath = (value: string) => {
  const normalized = normalizeInlineFilePath(value)
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('~/') ||
    normalized.startsWith('~\\') ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  )
}

export const resolveWorkspaceRequestPath = (workspacePath: string | undefined, rawPath: string) => {
  const candidate = normalizeInlineFilePath(rawPath).replaceAll('\\', '/')
  if (!candidate) return undefined
  if (!workspacePath || isAbsoluteWorkspaceRequestPath(candidate)) return candidate
  const workspace = normalizePath(workspacePath)
  const comparableWorkspace = /^[A-Za-z]:\//.test(workspace) ? workspace.toLowerCase() : workspace
  const comparableCandidate = /^[A-Za-z]:\//.test(candidate) ? candidate.toLowerCase() : candidate
  if (comparableCandidate.startsWith(`${comparableWorkspace}/`)) return candidate.slice(workspace.length + 1)
  return candidate.replace(/^\/+/, '')
}

export const getWorkspacePathBasename = (value: string) => {
  const segments = normalizePath(value).split('/').filter(Boolean)
  return segments.at(-1) ?? value
}

export const getWorkspaceParentPath = (value: string) => {
  const segments = normalizePath(value).split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

export const resolveWorkspaceRelativeArtifactPath = (workspacePath: string | undefined, rawPath: string) => {
  if (!workspacePath) return undefined
  const workspace = normalizePath(workspacePath)
  const candidate = normalizePath(rawPath)
  if (!candidate || candidate.split('/').some((segment) => segment === '..')) return undefined

  const isAbsolute = candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)
  if (!isAbsolute) return candidate.replace(/^\/+/, '')

  const comparableWorkspace = /^[A-Za-z]:\//.test(workspace) ? workspace.toLowerCase() : workspace
  const comparableCandidate = /^[A-Za-z]:\//.test(candidate) ? candidate.toLowerCase() : candidate
  if (!comparableCandidate.startsWith(`${comparableWorkspace}/`)) return undefined
  return candidate.slice(workspace.length + 1)
}

export const getWorkspaceFilePreviewKind = (
  filePath: string
): 'docx' | 'image' | 'markdown' | 'pdf' | 'pptx' | 'text' => {
  const extension = filePath.split('.').at(-1)?.toLowerCase() ?? ''
  if (imageExtensions.has(extension)) return 'image'
  if (markdownExtensions.has(extension)) return 'markdown'
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'pptx') return 'pptx'
  return 'text'
}

export const getWorkspaceCodeLanguage = (filePath: string) => {
  const extension = filePath.split('.').at(-1)?.toLowerCase() ?? ''
  return (
    {
      bash: 'shell',
      bat: 'dos',
      cjs: 'javascript',
      conf: 'ini',
      css: 'css',
      env: 'ini',
      html: 'html',
      ini: 'ini',
      java: 'java',
      js: 'javascript',
      json: 'json',
      jsx: 'javascript',
      log: 'plaintext',
      md: 'markdown',
      mjs: 'javascript',
      ps1: 'powershell',
      py: 'python',
      rs: 'rust',
      sh: 'shell',
      sql: 'sql',
      toml: 'toml',
      ts: 'typescript',
      tsx: 'typescript',
      txt: 'plaintext',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml'
    } as Readonly<Record<string, string>>
  )[extension]
}

export const buildWorkspaceSearchTree = (
  entries: readonly WebUiWorkspaceFileEntry[]
): readonly WebUiWorkspaceTreeNode[] => {
  type MutableNode = WebUiWorkspaceFileEntry & { children?: MutableNode[] }
  const roots: MutableNode[] = []
  const byPath = new Map<string, MutableNode>()

  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const segments = entry.path.split('/').filter(Boolean)
    let parentChildren = roots
    for (let index = 0; index < segments.length; index += 1) {
      const currentPath = segments.slice(0, index + 1).join('/')
      let node = byPath.get(currentPath)
      if (!node) {
        const isResult = currentPath === entry.path
        node = {
          path: currentPath,
          name: segments[index] ?? currentPath,
          isDirectory: isResult ? entry.isDirectory : true,
          ...(isResult && !entry.isDirectory ? {} : { children: [] })
        }
        byPath.set(currentPath, node)
        parentChildren.push(node)
      }
      if (node.isDirectory) {
        node.children ??= []
        parentChildren = node.children
      }
    }
  }

  const recursivelySort = (nodes: readonly MutableNode[]): WebUiWorkspaceTreeNode[] =>
    sortNodes(nodes).map((node) => ({
      path: node.path,
      name: node.name,
      isDirectory: node.isDirectory,
      ...(node.children ? { children: recursivelySort(node.children) } : {})
    }))

  return recursivelySort(roots)
}
