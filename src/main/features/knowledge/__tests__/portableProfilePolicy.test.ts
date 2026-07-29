import { describe, expect, it } from 'vitest'

import { collectKnowledgeRequiredMaterial, type KnowledgeMaterialRow } from '../portableProfilePolicy'

function row(baseId: string, type: string, data: unknown): KnowledgeMaterialRow {
  return { baseId, type, data: typeof data === 'string' ? data : JSON.stringify(data) }
}

describe('collectKnowledgeRequiredMaterial', () => {
  it('projects completed leaf material beneath the owner raw root', () => {
    const result = collectKnowledgeRequiredMaterial([
      row('kb-1', 'file', { relativePath: 'source.pdf' }),
      row('kb-1', 'file', { relativePath: 'source.docx', indexedRelativePath: 'source.md' }),
      row('kb-1', 'url', { relativePath: 'page.md' }),
      row('kb-1', 'directory', { relativePath: 'folder' }),
      row('kb-1', 'file', { relativePath: 'folder/child.md' })
    ])

    expect(result.get('kb-1')).toEqual(['raw/source.pdf', 'raw/source.md', 'raw/page.md', 'raw/folder/child.md'])
  })

  it('marks a base unprovable when any leaf has no usable material path', () => {
    const result = collectKnowledgeRequiredMaterial([
      row('kb-1', 'file', { relativePath: 'source.pdf' }),
      row('kb-1', 'url', {}),
      row('kb-1', 'file', { relativePath: 'ignored-after-failure.pdf' })
    ])

    expect(result.get('kb-1')).toBeNull()
  })

  it('treats malformed detached-database JSON as unprovable instead of throwing', () => {
    expect(collectKnowledgeRequiredMaterial([row('kb-1', 'file', 'not json')]).get('kb-1')).toBeNull()
  })
})
