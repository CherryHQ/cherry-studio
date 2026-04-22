import { describe, expect, it } from 'vitest'

import { getItemStatus, getItemTitle, getReadyCount, getVisibleItems } from '../utils/selectors'
import { createDirectoryItem, createFileItem, createNoteItem, createUrlItem } from './testUtils'

describe('dataSourcePanel.selectors', () => {
  it('gets titles from the correct source field for each item type', () => {
    expect(getItemTitle(createFileItem({ id: 'file-1', originName: '季度报告.pdf' }))).toBe('季度报告.pdf')
    expect(getItemTitle(createUrlItem({ id: 'url-1', name: '产品文档' }))).toBe('产品文档')
    expect(getItemTitle(createDirectoryItem({ id: 'directory-1', name: '本地资料夹' }))).toBe('本地资料夹')
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
    expect(getItemStatus(createFileItem({ id: 'file-3', status: 'embed' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.embedding',
      textClassName: 'text-amber-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-4', status: 'file_processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.rag.file_processing',
      textClassName: 'text-blue-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-5', status: 'pending' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.pending',
      textClassName: 'text-zinc-500/70',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-6', status: 'read' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.chunking',
      textClassName: 'text-violet-500/70',
      icon: 'loader'
    })
  })

  it('filters items by the active filter without changing the all filter behavior', () => {
    const items = [
      createFileItem({ id: 'file-1' }),
      createNoteItem({ id: 'note-1', content: '会议纪要' }),
      createUrlItem({ id: 'url-1', name: '产品文档' })
    ]

    expect(getVisibleItems(items, 'all')).toBe(items)
    expect(getVisibleItems(items, 'note')).toEqual([items[1]])
    expect(getVisibleItems(items, 'url')).toEqual([items[2]])
  })

  it('counts only completed items as ready', () => {
    expect(
      getReadyCount([
        createFileItem({ id: 'file-1', status: 'completed' }),
        createFileItem({ id: 'file-2', status: 'embed' }),
        createFileItem({ id: 'file-3', status: 'failed' }),
        createNoteItem({ id: 'note-1', content: '会议纪要', status: 'completed' })
      ])
    ).toBe(2)
  })
})
