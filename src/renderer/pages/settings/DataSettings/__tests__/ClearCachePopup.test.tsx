import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inspectMock = vi.hoisted(() => vi.fn())
const inspectBrowserMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: inspectMock }
}))

vi.mock('../legacyV1BrowserData', () => ({
  inspectLegacyV1BrowserData: inspectBrowserMock
}))

import { ClearCachePopupContainer } from '../ClearCachePopup'

describe('ClearCachePopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectBrowserMock.mockResolvedValue({
      bytes: 50,
      accuracy: 'estimated',
      completeness: 'complete'
    })
    inspectMock.mockImplementation(
      (
        _route: string,
        { groups }: { groups: Array<'normal_cache' | 'site_data' | 'legacy_v1' | 'restore_staging'> }
      ) => {
        const group = groups[0]
        const bytes = {
          normal_cache: 1024,
          site_data: 2048,
          legacy_v1: 100,
          restore_staging: 4096
        }[group]
        return Promise.resolve({
          results: [
            {
              group,
              size: {
                bytes,
                accuracy: group === 'restore_staging' ? 'exact' : 'estimated',
                completeness: 'complete'
              }
            }
          ]
        })
      }
    )
  })

  it('shows four choices and selects only regular cache by default', async () => {
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(4)
    expect(checkboxes[0]).toBeChecked()
    for (const checkbox of checkboxes.slice(1)) {
      expect(checkbox).not.toBeChecked()
    }
    expect(screen.getByText('旧版本遗留数据')).toBeInTheDocument()
    expect(screen.getByText(/旧知识库回滚数据/)).toBeInTheDocument()
    expect(screen.getByText('备份恢复临时文件')).toBeInTheDocument()
    expect(screen.getByText(/未完成的恢复将无法继续/)).toBeInTheDocument()
    expect(screen.getByText(/重新登录网站/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: '清除缓存' })).toBeEnabled()
    expect(inspectMock).toHaveBeenCalledTimes(4)
    expect(inspectBrowserMock).toHaveBeenCalledOnce()
  })

  it('updates the estimated selected total and disables confirmation with no selection', async () => {
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    fireEvent.click(checkboxes[1])
    expect(screen.getByText('约 3 KB')).toBeInTheDocument()

    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
    expect(screen.getByText('0 B')).toBeInTheDocument()
  })

  it('marks the selected total as partially unknown when an item is only partially measured', async () => {
    inspectMock.mockImplementation(
      (
        _route: string,
        { groups }: { groups: Array<'normal_cache' | 'site_data' | 'legacy_v1' | 'restore_staging'> }
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
    expect(screen.getAllByText('已统计 1 KB，部分大小未知')).toHaveLength(2)
  })

  it('closes after a successful cleanup without rescanning', async () => {
    const onClear = vi.fn().mockResolvedValue(true)
    const resolve = vi.fn()
    render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
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
