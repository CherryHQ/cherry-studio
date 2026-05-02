import { describe, expect, it } from 'vitest'

import { getItemStatus, getItemTitle, getReadyCount, getVisibleItems } from '../utils/selectors'
import { createDirectoryItem, createFileItem, createNoteItem, createSitemapItem, createUrlItem } from './testUtils'

describe('dataSourcePanel.selectors', () => {
  it('gets titles from the correct source field for each item type', () => {
    expect(getItemTitle(createFileItem({ id: 'file-1', originName: '季度报告.pdf' }))).toBe('季度报告.pdf')
    expect(getItemTitle(createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' }))).toBe(
      'https://example.com/product-docs'
    )
    expect(getItemTitle(createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹' }))).toBe(
      '/Users/eeee/本地资料夹'
    )
    expect(getItemTitle(createNoteItem({ id: 'note-1', content: '\n \n  第一行标题  \n第二行内容' }))).toBe(
      '第一行标题'
    )
    expect(getItemTitle(createNoteItem({ id: 'note-2', content: '\n   \n' }))).toBe('')
  })

  it('maps item statuses into row status metadata', () => {
    expect(getItemStatus(createFileItem({ id: 'file-1', status: 'completed' }))).toEqual({
      kind: 'completed',
      labelKey: 'knowledge_v2.data_source.status.ready',
      textClassName: 'text-emerald-500/70',
      icon: 'check'
    })
    expect(getItemStatus(createFileItem({ id: 'file-2', status: 'failed' }))).toEqual({
      kind: 'failed',
      labelKey: 'knowledge_v2.data_source.status.error',
      textClassName: 'text-red-500/60',
      icon: 'alert'
    })
    expect(getItemStatus(createFileItem({ id: 'file-3', status: 'processing', phase: 'embedding' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.embedding',
      textClassName: 'text-amber-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-4', status: 'processing', phase: 'reading' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.rag.file_processing',
      textClassName: 'text-blue-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-5', status: 'processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.status.processing',
      textClassName: 'text-yellow-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createDirectoryItem({ id: 'directory-1', status: 'processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.status.processing',
      textClassName: 'text-yellow-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createSitemapItem({ id: 'sitemap-1', status: 'processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.status.processing',
      textClassName: 'text-yellow-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-6', status: 'processing', phase: 'embedding' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.embedding',
      textClassName: 'text-amber-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createDirectoryItem({ id: 'directory-2', status: 'processing', phase: 'preparing' }))).toEqual(
      {
        kind: 'processing',
        labelKey: 'knowledge_v2.data_source.status.pending',
        textClassName: 'text-zinc-500/70',
        icon: 'loader'
      }
    )
  })

  it('filters items by the active filter without changing the all filter behavior', () => {
    const items = [
      createFileItem({ id: 'file-1' }),
      createNoteItem({ id: 'note-1', content: '会议纪要' }),
      createUrlItem({ id: 'url-1', source: 'https://example.com/product-docs' })
    ]

    expect(getVisibleItems(items, 'all')).toBe(items)
    expect(getVisibleItems(items, 'note')).toEqual([items[1]])
    expect(getVisibleItems(items, 'url')).toEqual([items[2]])
  })

  it('counts only completed items as ready', () => {
    expect(
      getReadyCount([
        createFileItem({ id: 'file-1', status: 'completed' }),
        createFileItem({ id: 'file-2', status: 'processing', phase: 'embedding' }),
        createFileItem({ id: 'file-3', status: 'failed' }),
        createNoteItem({ id: 'note-1', content: '会议纪要', status: 'completed' })
      ])
    ).toBe(2)
  })
})
