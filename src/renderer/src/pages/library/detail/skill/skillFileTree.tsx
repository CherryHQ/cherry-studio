import { Icon } from '@iconify/react'
import { getFileIconName } from '@renderer/utils/fileIconName'
import type { SkillFileNode } from '@types'
import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { memo } from 'react'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown'])

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  txt: 'text'
}

export function isMarkdownFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return MARKDOWN_EXTENSIONS.has(ext)
}

export function guessLanguage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return LANG_MAP[ext] ?? 'text'
}

interface FileTreeNodeProps {
  node: SkillFileNode
  depth: number
  expandedDirs: Set<string>
  selectedFile: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}

/**
 * Single row in the skill file tree. Mirrors the recursive renderer in
 * `pages/settings/SkillsSettings`, but rebuilt on Tailwind so the library
 * tree visually aligns with the rest of the resource library.
 */
export const FileTreeNode: FC<FileTreeNodeProps> = memo(
  ({ node, depth, expandedDirs, selectedFile, onToggleDir, onSelectFile }) => {
    const indent = { paddingLeft: `${depth * 12 + 8}px` }

    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.path)
      return (
        <div>
          <button
            type="button"
            onClick={() => onToggleDir(node.path)}
            title={node.name}
            style={indent}
            className="flex w-full items-center gap-1.5 rounded-3xs py-1 pr-2 text-left text-xs text-foreground/75 transition-colors hover:bg-accent/50 hover:text-foreground">
            <ChevronRight
              size={11}
              className="shrink-0 text-muted-foreground/50 transition-transform"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
            />
            <Icon
              icon={isExpanded ? 'material-icon-theme:folder-open' : 'material-icon-theme:folder'}
              className="shrink-0"
              width={14}
              height={14}
            />
            <span className="truncate">{node.name}</span>
          </button>
          {isExpanded &&
            node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                selectedFile={selectedFile}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
        </div>
      )
    }

    const isActive = selectedFile === node.path
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        title={node.name}
        style={indent}
        className={`flex w-full items-center gap-1.5 rounded-3xs py-1 pr-2 text-left text-xs transition-colors ${
          isActive
            ? 'bg-accent/60 text-foreground'
            : 'text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground'
        }`}>
        <span className="inline-block size-3 shrink-0" aria-hidden="true" />
        <Icon icon={`material-icon-theme:${getFileIconName(node.name)}`} className="shrink-0" width={14} height={14} />
        <span className="truncate">{node.name}</span>
      </button>
    )
  }
)

FileTreeNode.displayName = 'FileTreeNode'
