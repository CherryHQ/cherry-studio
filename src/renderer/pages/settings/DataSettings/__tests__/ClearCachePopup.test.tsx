import type * as PopupService from '@renderer/services/popup'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inspectMock = vi.hoisted(() => vi.fn())
const inspectBrowserMock = vi.hoisted(() => vi.fn())
const confirmMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: inspectMock }
}))

vi.mock('@renderer/services/popup', async (importOriginal) => {
  const actual = await importOriginal<typeof PopupService>()
  return {
    ...actual,
    popup: { ...actual.popup, confirm: confirmMock }
  }
})

vi.mock('../legacyV1BrowserData', () => ({
  inspectLegacyV1BrowserData: inspectBrowserMock
}))

import { ClearCachePopupContainer } from '../ClearCachePopup'

describe('ClearCachePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(false)
    inspectBrowserMock.mockResolvedValue({
      bytes: 50,
      accuracy: 'estimated',
      completeness: 'complete'
    })
    inspectMock.mockImplementation(
      (
        _route: string,
        {
          groups
        }: {
          groups: Array<'normal_cache' | 'site_data' | 'orphaned_data' | 'legacy_v1'>
        }
      ) => {
        const group = groups[0]
        const bytes = {
          normal_cache: 1024,
          site_data: 2048,
          orphaned_data: 512,
          legacy_v1: 100
        }[group]
        return Promise.resolve({
          results: [
            {
              group,
              size: {
                bytes,
                accuracy: group === 'orphaned_data' ? 'exact' : 'estimated',
                completeness: 'complete'
              }
            }
          ]
        })
      }
    )
  })

  it('shows four choices with nothing selected by default', async () => {
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(4)
    for (const checkbox of checkboxes) {
      expect(checkbox).not.toBeChecked()
    }
    expect(screen.getByText('应用缓存')).toBeInTheDocument()
    expect(
      screen.getByText('清理应用使用过程中产生的缓存和临时文件，释放存储空间，不会删除聊天记录和设置。')
    ).toBeInTheDocument()
    expect(screen.getByText('v1 版本遗留数据')).toBeInTheDocument()
    expect(screen.getByText('残留文件与知识库')).toBeInTheDocument()
    expect(screen.getByText(/不再使用的文件、知识库残留和备份恢复临时文件/)).toBeInTheDocument()
    expect(screen.queryByText(/未完成的恢复将无法继续/)).not.toBeInTheDocument()
    expect(screen.getByText('v1 版本遗留数据，包括旧的对话记录和设置。清理后无法恢复。')).toBeInTheDocument()
    expect(screen.queryByText('备份恢复临时文件')).not.toBeInTheDocument()
    expect(screen.getByText(/重新登录网站/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(inspectMock).toHaveBeenCalledTimes(4)
    expect(inspectBrowserMock).toHaveBeenCalledOnce()
  })

  it('updates the estimated selected total and disables confirmation with no selection', async () => {
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    expect(screen.getByText('约 3 KB')).toBeInTheDocument()

    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(screen.getByText('0 B')).toBeInTheDocument()
  })

  it('requires a destructive warning before selecting v1 data', async () => {
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    const legacyCheckbox = screen.getAllByRole('checkbox')[3]
    fireEvent.click(legacyCheckbox)

    await waitFor(() => expect(confirmMock).toHaveBeenCalledOnce())
    expect(legacyCheckbox).not.toBeChecked()
    const warning = confirmMock.mock.calls[0][0]
    expect(warning).toMatchObject({
      title: '确认选择 v1 版本遗留数据？',
      okText: '仍要选择',
      cancelText: '取消',
      okButtonProps: { danger: true },
      maskClosable: false,
      closable: false
    })
    const warningContent = render(warning.content)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-type', 'error')
    expect(alert).toHaveTextContent('v1 版本数据将被永久删除')
    expect(alert).toHaveTextContent('如果没有备份，这些数据将无法恢复')
    warningContent.unmount()
    expect(legacyCheckbox).not.toBeChecked()

    fireEvent.click(legacyCheckbox)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(legacyCheckbox).toBeChecked())
  })

  it('marks the selected total as partially unknown when an item is only partially measured', async () => {
    inspectMock.mockImplementation(
      (
        _route: string,
        {
          groups
        }: {
          groups: Array<'normal_cache' | 'site_data' | 'orphaned_data' | 'legacy_v1'>
        }
      ) => {
        const group = groups[0]
        return Promise.resolve({
          results: [
            {
              group,
              size: {
                bytes: group === 'normal_cache' ? 1024 : 0,
                accuracy: 'estimated',
                completeness: group === 'normal_cache' ? 'partial' : 'complete'
              }
            }
          ]
        })
      }
    )

    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getAllByText('已统计 1 KB，部分大小未知')).toHaveLength(2)
  })

  it('closes after a successful cleanup without rescanning', async () => {
    const onClear = vi.fn().mockResolvedValue(true)
    const resolve = vi.fn()
    render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: '清除缓存' }))

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(undefined))
    expect(onClear).toHaveBeenCalledWith(['normal_cache'])
    expect(inspectMock).toHaveBeenCalledTimes(4)
  })

  it('blocks repeated cleanup and refreshes every size after an incomplete cleanup', async () => {
    let finishCleanup: ((success: boolean) => void) | undefined
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = resolve
    })
    const onClear = vi.fn(() => cleanup)
    const resolve = vi.fn()
    render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const confirmButton = screen.getByRole('button', { name: '清除缓存' })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(onClear).toHaveBeenCalledWith(['normal_cache']))
    expect(confirmButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled()
    expect(screen.getAllByRole('checkbox').every((checkbox) => checkbox.hasAttribute('disabled'))).toBe(true)
    expect(inspectMock).toHaveBeenCalledTimes(4)

    fireEvent.click(confirmButton)
    expect(onClear).toHaveBeenCalledTimes(1)

    finishCleanup?.(false)

    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(8))
    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    expect(resolve).not.toHaveBeenCalled()
    expect(confirmButton).toBeEnabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled()
  })

  it('allows closing while cleanup continues without rescanning the closed popup', async () => {
    let finishCleanup: ((success: boolean) => void) | undefined
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = resolve
    })
    const onClear = vi.fn(() => cleanup)
    const resolve = vi.fn()
    const { rerender } = render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const confirmButton = screen.getByRole('button', { name: '清除缓存' })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(onClear).toHaveBeenCalledOnce())
    expect(confirmButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(resolve).toHaveBeenCalledWith(undefined)

    rerender(<ClearCachePopupContainer open={false} resolve={resolve} onClear={onClear} />)
    finishCleanup?.(true)
    await cleanup

    expect(onClear).toHaveBeenCalledOnce()
    expect(inspectMock).toHaveBeenCalledTimes(4)
  })
})
