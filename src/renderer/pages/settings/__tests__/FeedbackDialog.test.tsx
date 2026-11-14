import '@testing-library/jest-dom/vitest'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { cacheService } from '@data/CacheService'
import enUs from '@renderer/i18n/locales/en-us.json'
import { toast } from '@renderer/services/toast'
import type { DoctorState } from '@shared/types/doctor'
import type { DoctorAgentState } from '@shared/types/doctorAgent'
import { doctorAgentStateCacheKey, doctorStateCacheKey } from '@shared/utils/doctor'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  openRoute: vi.fn(),
  showDoctor: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

vi.mock('@renderer/components/doctor', () => ({
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: (...args: unknown[]) => mocks.openRoute(...args)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (enUs as Record<string, string>)[key] ?? key
  })
}))

import { FEEDBACK_GITHUB_URL, FeedbackDialog, getFeedbackAgentRoute } from '../FeedbackDialog'

function ControlledFeedbackDialog() {
  const [open, setOpen] = useState(true)
  return <FeedbackDialog open={open} onOpenChange={setOpen} />
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ sessionId: 'feedback-session' })
    Object.defineProperty(window.electron, 'process', {
      configurable: true,
      value: { platform: 'darwin' }
    })
  })

  it('closes the chooser and opens an email draft with version and platform details', async () => {
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { version: '2.1.9' }
      if (route === 'system.shell.open_external_website') {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      }
      return undefined
    })
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Contact/ }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'system.shell.open_external_website',
        expect.stringMatching(/^mailto:/)
      )
    )
    const request = mocks.ipcRequest.mock.calls.find(([route]) => route === 'system.shell.open_external_website')
    const url = new URL(request![1] as string)
    expect(url.pathname).toBe('support@cherry-ai.com')
    expect(url.searchParams.get('subject')).toBe('Cherry Studio Feedback')
    expect(url.searchParams.get('body')).toContain('Version: 2.1.9')
    expect(url.searchParams.get('body')).toContain('Platform: darwin')
  })

  it('closes feedback before opening the problem report panel', async () => {
    mocks.showDoctor.mockImplementationOnce(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      return Promise.resolve()
    })
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Report a problem/i }))

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'report' }))
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('attaches the current global AI analysis to the problem report, like the help menu', async () => {
    MockCacheUtils.resetMocks()
    cacheService.setShared(doctorStateCacheKey('global'), {
      status: 'completed',
      report: { runId: 'report-1' }
    } as DoctorState)
    const agent: DoctorAgentState = {
      status: 'completed',
      runId: 'agent-run-1',
      scope: 'global',
      reportRunId: 'report-1',
      sessionId: 'session-1',
      modelId: 'openai::gpt-4o',
      startedAt: '2026-05-01T00:00:02.000Z',
      text: 'The proxy blocks the provider.',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    cacheService.setShared(doctorAgentStateCacheKey('global'), agent)
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Report a problem/i }))

    await waitFor(() =>
      expect(mocks.showDoctor).toHaveBeenCalledWith({
        initialPanel: 'report',
        aiDiagnosis: expect.objectContaining({ scope: 'global', text: 'The proxy blocks the provider.' })
      })
    )
  })

  it('creates an isolated feedback session before opening the Agent route', async () => {
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Feedback assistant/ }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('ai.agent.support_session.create'))
    await waitFor(() => expect(mocks.openRoute).toHaveBeenCalledWith(getFeedbackAgentRoute('feedback-session')))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reports feedback-session creation failures without opening an empty Agent route', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('restore failed'))
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Feedback assistant/ }))

    // A feedback failure must not offer another Details -> Report entry.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith({
        title: enUs['settings.about.feedback.agent_error'],
        data: { suppressDetail: true }
      })
    )
    expect(mocks.openRoute).not.toHaveBeenCalled()
  })

  it('opens the GitHub issue chooser', async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /GitHub Issue/ }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith('system.shell.open_external_website', FEEDBACK_GITHUB_URL)
    )
  })

  it('closes before reporting GitHub issue chooser failures', async () => {
    mocks.ipcRequest.mockImplementation((route: string) => {
      if (route === 'system.shell.open_external_website') {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        return Promise.reject(new Error('open failed'))
      }
      return Promise.resolve({ sessionId: 'feedback-session' })
    })
    render(<ControlledFeedbackDialog />)

    await userEvent.setup().click(screen.getByRole('button', { name: /GitHub Issue/ }))

    await waitFor(() =>
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open GitHub issue chooser', expect.any(Error))
    )
    expect(toast.error).toHaveBeenCalledWith({
      title: enUs['settings.about.feedback.github.error'],
      data: { suppressDetail: true }
    })
  })
})
