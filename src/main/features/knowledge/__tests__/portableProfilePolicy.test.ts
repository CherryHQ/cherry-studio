import { describe, expect, it } from 'vitest'

import {
  collectKnowledgeIndexRequirements,
  collectKnowledgeRequiredMaterial,
  type KnowledgeMaterialRow
} from '../portableProfilePolicy'

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

    expect(result.get('kb-1')).toEqual([
      'raw/source.pdf',
      'raw/source.docx',
      'raw/source.md',
      'raw/page.md',
      'raw/folder/child.md'
    ])
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

  it('requires both the original source and the processed artifact', () => {
    expect(
      collectKnowledgeRequiredMaterial([
        row('kb-1', 'file', { relativePath: 'source.docx', indexedRelativePath: 'processed/source.md' })
      ]).get('kb-1')
    ).toEqual(['raw/source.docx', 'raw/processed/source.md'])
  })

  it('fails closed when a declared processed artifact is malformed', () => {
    expect(
      collectKnowledgeRequiredMaterial([
        row('kb-1', 'file', { relativePath: 'source.docx', indexedRelativePath: 42 })
      ]).get('kb-1')
    ).toBeNull()
  })
})

describe('collectKnowledgeIndexRequirements', () => {
  it('keeps the owner item id paired with the index material path', () => {
    const result = collectKnowledgeIndexRequirements([
      { id: 'item-1', ...row('kb-1', 'file', { relativePath: 'source.pdf', indexedRelativePath: 'source.md' }) },
      { id: 'item-2', ...row('kb-1', 'url', { relativePath: 'page.md' }) }
    ])

    expect(result.get('kb-1')).toEqual([
      { itemId: 'item-1', relativePath: 'source.md' },
      { itemId: 'item-2', relativePath: 'page.md' }
    ])
  })
})
