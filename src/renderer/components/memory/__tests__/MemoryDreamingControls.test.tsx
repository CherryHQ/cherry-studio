import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryDreamingControls } from '../MemoryDreamingControls'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  MockUsePreferenceUtils.setPreferenceValue('feature.memory.generation.enabled', true)
  MockUsePreferenceUtils.setPreferenceValue('feature.memory.dreaming.enabled', true)
  vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: { status: 'idle', pending: false } })
})

describe('memory generation settings', () => {
  it('keeps generation and organization independent and allows manual organization with both off', async () => {
    const user = userEvent.setup()
    render(<MemoryDreamingControls scope={{ kind: 'shared' }} />)
    const parent = screen.getByRole('switch', { name: '聊天中生成记忆' })
    const automatic = screen.getByRole('switch', { name: '自动整理记忆' })
    expect(parent).toBeChecked()
    expect(automatic).toBeChecked()
    await waitFor(() => expect(screen.getByRole('button', { name: '立即整理' })).toBeEnabled())
    await user.click(parent)
    await waitFor(() => expect(parent).not.toBeChecked())
    await waitFor(() => expect(automatic).toBeEnabled())
    expect(automatic).toBeChecked()
    expect(screen.getByRole('button', { name: '立即整理' })).toBeEnabled()
    await user.click(automatic)
    await waitFor(() => expect(automatic).not.toBeChecked())
    expect(parent).not.toBeChecked()
    await waitFor(() => expect(screen.getByRole('button', { name: '立即整理' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '立即整理' }))
    await waitFor(() =>
      expect(window.api.ipcApi.request).toHaveBeenCalledWith('memory.dreaming.request', { kind: 'shared' })
    )
  })

  it.each([
    [/使用默认模型从开启共享记忆的对话/, '可能会产生少量 token 消耗'],
    [/应用空闲时/, '整理已有记忆']
  ] as const)('explains %s through the model-settings info tooltip', async (name, text) => {
    const user = userEvent.setup()
    render(<MemoryDreamingControls scope={{ kind: 'shared' }} />)
    await user.hover(screen.getByRole('img', { name }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(text)
  })

  it('shows the recorded failed result even when the current task is idle and generation is disabled', async () => {
    MockUsePreferenceUtils.setPreferenceValue('feature.memory.generation.enabled', false)
    vi.mocked(window.api.ipcApi.request).mockResolvedValue({
      ok: true,
      data: {
        status: 'idle',
        pending: false,
        lastResult: { outcome: 'failed', finishedAt: Date.UTC(2026, 9, 30, 1), reason: 'output' }
      }
    })
    render(<MemoryDreamingControls scope={{ kind: 'shared' }} />)
    const result = await screen.findByRole('status')
    expect(result).toHaveTextContent('最近运行结果：失败')
    expect(result).not.toHaveTextContent('已完成')
  })
})
