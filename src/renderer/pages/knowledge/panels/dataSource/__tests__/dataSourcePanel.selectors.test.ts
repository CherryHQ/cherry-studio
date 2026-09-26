import { describe, expect, it } from 'vitest'

import type { PosixRelativeFilePath } from '@shared/utils/file'

import { getItemStatus, getItemTitle } from '../utils/selectors'
import { createDirectoryItem, createFileItem, createNoteItem, createUrlItem } from './testUtils'

describe('dataSourcePanel.selectors', () => {
  it('gets titles from the correct source field for each item type', () => {
    expect(getItemTitle(createFileItem({ id: 'file-1', source: '/tmp/季度报告.pdf' }))).toBe('季度报告.pdf')
    expect(getItemTitle(createFileItem({ id: 'file-2', source: '/tmp/fallback.md' }))).toBe('fallback.md')
    // A captured url snapshot shows its title-derived file name (`.md` stripped); a url not
    // yet indexed (no snapshot) falls back to the raw URL.
    expect(
      getItemTitle(
        createUrlItem({
          id: 'url-1',
          source: 'https://example.com/product-docs',
          relativePath: 'Drop-in replacements for React Native UI.md' as PosixRelativeFilePath
        })
      )
    ).toBe('Drop-in replacements for React Native UI')
    expect(getItemTitle(createUrlItem({ id: 'url-2', source: 'https://example.com/product-docs' }))).toBe(
      'https://example.com/product-docs'
    )
    expect(getItemTitle(createDirectoryItem({ id: 'directory-1', source: '/Users/eeee/本地资料夹' }))).toBe(
      '本地资料夹'
    )
    expect(getItemTitle(createNoteItem({ id: 'note-1', content: '\n \n  第一行标题  \n第二行内容' }))).toBe(
      '第一行标题'
    )
    // A drafted note's title is its own field, so the row shows it rather than the body's opening
    // line — the same name same-name detection keys off.
    expect(getItemTitle(createNoteItem({ id: 'note-3', source: '季度复盘', content: '第一行标题\n第二行内容' }))).toBe(
      '季度复盘'
    )
    expect(getItemTitle(createNoteItem({ id: 'note-2', content: '\n   \n' }))).toBe('')
  })

  it('maps item statuses into row status metadata', () => {
    expect(getItemStatus(createFileItem({ id: 'file-1', status: 'completed' }))).toEqual({
      kind: 'completed',
      labelKey: 'knowledge.data_source.status.ready',
      textClassName: 'text-success',
      icon: 'check'
    })
    expect(getItemStatus(createFileItem({ id: 'file-2', status: 'failed' }))).toEqual({
      kind: 'failed',
      labelKey: 'knowledge.data_source.status.error',
      textClassName: 'text-error',
      icon: 'alert'
    })
    expect(getItemStatus(createFileItem({ id: 'file-3', status: 'embedding' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.data_source.status.embedding',
      textClassName: 'text-warning',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-4', status: 'reading' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.rag.file_processing',
      textClassName: 'text-info',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-5', status: 'processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.status.processing',
      textClassName: 'text-yellow-500',
      icon: 'loader'
    })
    expect(getItemStatus(createDirectoryItem({ id: 'directory-1', status: 'processing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.status.processing',
      textClassName: 'text-yellow-500',
      icon: 'loader'
    })
    expect(getItemStatus(createFileItem({ id: 'file-6', status: 'embedding' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.data_source.status.embedding',
      textClassName: 'text-warning',
      icon: 'loader'
    })
    expect(getItemStatus(createDirectoryItem({ id: 'directory-2', status: 'preparing' }))).toEqual({
      kind: 'processing',
      labelKey: 'knowledge.data_source.status.pending',
      textClassName: 'text-zinc-500',
      icon: 'loader'
    })
  })
})
