import type * as PopupService from '@renderer/services/popup'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(screen.getByText('网站与小程序数据')).toBeInTheDocument()
    expect(screen.getByText('v1 版本遗留数据')).toBeInTheDocument()
    expect(screen.getByText('残留文件与知识库')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除缓存' })).toBeDisabled()
  })

  it('updates the estimated selected total', async () => {
    const user = userEvent.setup()
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])
    expect(screen.getByText('约 3 KB')).toBeInTheDocument()
  })

  it('requires a destructive warning before selecting v1 data', async () => {
    const user = userEvent.setup()
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<ClearCachePopupContainer open resolve={vi.fn()} onClear={vi.fn()} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    const legacyCheckbox = screen.getAllByRole('checkbox')[3]
    await user.click(legacyCheckbox)

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

    await user.click(legacyCheckbox)
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(legacyCheckbox).toBeChecked())
  })

  it('marks the selected total as partially unknown when an item is only partially measured', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getAllByText('已统计 1 KB，部分大小未知')).toHaveLength(2)
  })

  it('closes after a successful cleanup', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn().mockResolvedValue(true)
    const resolve = vi.fn()
    render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getByRole('button', { name: '清除缓存' }))

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(undefined))
    expect(onClear).toHaveBeenCalledWith(['normal_cache'])
  })

  it('blocks repeated cleanup and refreshes every size after an incomplete cleanup', async () => {
    const user = userEvent.setup()
    let finishCleanup: ((success: boolean) => void) | undefined
    const cleanup = new Promise<boolean>((resolve) => {
      finishCleanup = resolve
    })
    const onClear = vi.fn(() => cleanup)
    const resolve = vi.fn()
    render(<ClearCachePopupContainer open resolve={resolve} onClear={onClear} />)

    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    await user.click(screen.getAllByRole('checkbox')[0])
    const confirmButton = screen.getByRole('button', { name: '清除缓存' })
    await user.click(confirmButton)

    await waitFor(() => expect(onClear).toHaveBeenCalledWith(['normal_cache']))
    expect(confirmButton).toBeDisabled()
    expect(screen.getAllByRole('checkbox').every((checkbox) => checkbox.hasAttribute('disabled'))).toBe(true)

    await user.click(confirmButton)
    expect(onClear).toHaveBeenCalledTimes(1)

    finishCleanup?.(false)

    await waitFor(() => expect(inspectMock).toHaveBeenCalledTimes(8))
    await waitFor(() => expect(screen.queryAllByText('计算中…')).toHaveLength(0))
    expect(resolve).not.toHaveBeenCalled()
    expect(confirmButton).toBeEnabled()
  })
})
