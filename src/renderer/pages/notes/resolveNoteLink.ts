import type { NotesTreeNode } from '@renderer/types/note'

export type NoteLinkResolution =
  | { kind: 'resolved'; nodeId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }
  | { kind: 'unsupported' }

export function resolveNoteLink(notesTree: readonly NotesTreeNode[], target: string): NoteLinkResolution {
  const hasExtension = /\.md$/i.test(target)
  const path = hasExtension ? target.slice(0, -3) : target
  if (
    !path ||
    /[\\#]/.test(path) ||
    Array.from(path).some(
      (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    ) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path) ||
    path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  )
    return { kind: 'unsupported' }

  const matches: string[] = []
  const visit = (nodes: readonly NotesTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'file') {
        const relative = node.treePath.replace(/^\//, '')
        if ((path.includes('/') ? relative : relative.split('/').at(-1)) === path) matches.push(node.id)
      }
      if (node.children) visit(node.children)
    }
  }
  visit(notesTree)
  if (matches.length === 0) return { kind: 'missing' }
  if (matches.length > 1) return { kind: 'ambiguous' }
  return { kind: 'resolved', nodeId: matches[0] }
}
