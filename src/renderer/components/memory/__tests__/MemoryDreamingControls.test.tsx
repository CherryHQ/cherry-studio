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
  it('disables child controls under the parent while preserving the automatic setting', async () => {
    const user = userEvent.setup()
    render(<MemoryDreamingControls scope={{ kind: 'shared' }} />)
    const parent = screen.getByRole('switch', { name: '聊天中生成记忆' })
    const automatic = screen.getByRole('switch', { name: '自动整理记忆' })
    expect(parent).toBeChecked()
    expect(automatic).toBeChecked()
    await waitFor(() => expect(screen.getByRole('button', { name: '立即整理' })).toBeEnabled())
    await user.click(parent)
    await waitFor(() => expect(parent).not.toBeChecked())
    expect(automatic).toBeDisabled()
    expect(automatic).toBeChecked()
    expect(screen.getByRole('button', { name: '立即整理' })).toBeDisabled()
    await waitFor(() => expect(parent).toBeEnabled())
    await user.click(parent)
    await waitFor(() => expect(automatic).toBeEnabled())
    await user.click(automatic)
    await waitFor(() => expect(automatic).not.toBeChecked())
    expect(parent).toBeChecked()
    expect(screen.getByRole('button', { name: '立即整理' })).toBeEnabled()
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
