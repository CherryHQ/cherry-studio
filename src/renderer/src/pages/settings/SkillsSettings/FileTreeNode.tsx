import { Icon } from '@iconify/react'
import { ChevronRight } from 'lucide-react'
import React, { type FC, memo } from 'react'
import styled from 'styled-components'

import type { SkillFileNode } from './types'

const ICON_STYLE_16 = { fontSize: 16, flexShrink: 0 } as const
const SPACER_STYLE = { width: 12, flexShrink: 0 } as const
const CHEVRON_EXPANDED = { transform: 'rotate(90deg)', transition: 'transform 0.15s', flexShrink: 0 } as const
const CHEVRON_COLLAPSED = { transform: 'none', transition: 'transform 0.15s', flexShrink: 0 } as const

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return `vscode-icons:file-type-${ext}`
}

function getFolderIcon(isOpen: boolean): string {
  return isOpen ? 'vscode-icons:folder-open' : 'vscode-icons:folder'
}

interface FileTreeNodeProps {
  node: SkillFileNode
  depth: number
  expandedDirs: Set<string>
  selectedFile: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}

export const FileTreeNode: FC<FileTreeNodeProps> = memo(
  ({ node, depth, expandedDirs, selectedFile, onToggleDir, onSelectFile }) => {
    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.path)
      return (
        <div>
          <FileTreeItem $depth={depth} $active={false} onClick={() => onToggleDir(node.path)} title={node.name}>
            <ChevronRight size={12} style={isExpanded ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED} />
            <Icon icon={getFolderIcon(isExpanded)} style={ICON_STYLE_16} />
            <FileTreeName>{node.name}</FileTreeName>
          </FileTreeItem>
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
      <FileTreeItem
        key={node.path}
        $depth={depth}
        $active={isActive}
        onClick={() => onSelectFile(node.path)}
        title={node.name}>
        <span style={SPACER_STYLE} />
        <Icon icon={getFileIcon(node.name)} style={ICON_STYLE_16} />
        <FileTreeName>{node.name}</FileTreeName>
      </FileTreeItem>
    )
  }
)

FileTreeNode.displayName = 'FileTreeNode'

const FileTreeItem = styled.div<{ $depth: number; $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  padding-left: ${(props) => 8 + props.$depth * 16}px;
  cursor: pointer;
  border-radius: 4px;
  background: ${(props) => (props.$active ? 'var(--color-background-mute)' : 'transparent')};
  &:hover {
    background: var(--color-background-soft);
  }
`

const FileTreeName = styled.span`
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
