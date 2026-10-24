import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import DataSourcePanelHeader from '../DataSourcePanelHeader'

vi.mock('@cherrystudio/ui', async () => ({
  ...(await import('@cherrystudio/ui/components/primitives/button')),
  ...(await import('@cherrystudio/ui/components/primitives/dropdown-menu'))
}))

const baseProps = {
  total: 5,
  loadedCount: 5,
  selectedCount: 0,
  updatedAt: '2026-06-16T00:00:00.000Z',
  onBulkReindex: vi.fn(),
  onBulkDelete: vi.fn(),
  onAdd: vi.fn(),
  onAddFeishuWiki: vi.fn()
}

describe('DataSourcePanelHeader', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('selects Feishu with the keyboard and returns focus after closing the menu', async () => {
    const user = userEvent.setup()
    const onAddFeishuWiki = vi.fn()
    render(<DataSourcePanelHeader {...baseProps} onAddFeishuWiki={onAddFeishuWiki} />)
    const add = screen.getByRole('button', { name: '添加数据源' })

    await user.tab()
    expect(add).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    const file = await screen.findByRole('menuitem', { name: '文件' })
    await waitFor(() => expect(file).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '笔记' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(file).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: '飞书知识库' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(onAddFeishuWiki).toHaveBeenCalledOnce()
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('dismisses keyboard selection with Escape without opening a source', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onAddFeishuWiki = vi.fn()
    render(<DataSourcePanelHeader {...baseProps} onAdd={onAdd} onAddFeishuWiki={onAddFeishuWiki} />)
    const add = screen.getByRole('button', { name: '添加数据源' })

    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '文件' })).toHaveFocus())
    await user.keyboard('{ArrowDown}{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(add).toHaveFocus())
    expect(onAdd).not.toHaveBeenCalled()
    expect(onAddFeishuWiki).not.toHaveBeenCalled()
  })

  it('opens a local source from the same menu and closes it after selection', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<DataSourcePanelHeader {...baseProps} onAdd={onAdd} />)

    await user.click(screen.getByRole('button', { name: '添加数据源' }))
    expect(screen.getByRole('menuitem', { name: '飞书知识库' })).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: '目录' }))

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(onAdd).toHaveBeenCalledWith('directory')
  })

  it('replaces the add menu with bulk actions while rows are selected', () => {
    render(<DataSourcePanelHeader {...baseProps} selectedCount={2} />)

    expect(screen.queryByRole('button', { name: '添加数据源' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('knowledge.external.sources.title') })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新索引' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('keeps the status slot mounted but hidden during bulk selection', () => {
    const status = <input aria-label="Sync status draft" defaultValue="unsaved configuration" />
    const { rerender } = render(<DataSourcePanelHeader {...baseProps} syncStatus={status} />)
    const draft = screen.getByRole('textbox', { name: 'Sync status draft' })

    rerender(<DataSourcePanelHeader {...baseProps} selectedCount={2} syncStatus={status} />)
    expect(draft).toBeInTheDocument()
    expect(draft).not.toBeVisible()

    rerender(<DataSourcePanelHeader {...baseProps} syncStatus={status} />)
    expect(screen.getByRole('textbox', { name: 'Sync status draft' })).toBe(draft)
    expect(draft).toBeVisible()
  })

  it('warns that a selection only covers loaded rows when unloaded pages remain', () => {
    const { rerender } = render(
      <DataSourcePanelHeader {...baseProps} total={200} loadedCount={50} selectedCount={50} />
    )

    expect(screen.getByText('仅作用于已加载项，共 200 项')).toBeInTheDocument()
    rerender(<DataSourcePanelHeader {...baseProps} total={50} loadedCount={50} selectedCount={50} />)
    expect(screen.queryByText('仅作用于已加载项，共 50 项')).not.toBeInTheDocument()
  })
})
