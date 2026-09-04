import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/components/popups/ContentPopup', async () => {
  const React = await import('react')
  const { createPopup } = await import('@renderer/services/popup')
  const ContentPopup = createPopup<{ content: ReactNode; title?: ReactNode }, void>(({ content, open, title }) =>
    open ? React.createElement('div', { role: 'dialog' }, title, content) : null
  )
  return { default: ContentPopup }
})

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn(),
  showDoctor: vi.fn()
}))

const translations: Record<string, string> = {
  'common.copy': 'Copy',
  'error.diagnosis.ai_button': 'AI diagnosis',
  'error.diagnosis.ai_done': 'AI diagnosis complete',
  'error.diagnosis.ai_loading': 'Diagnosing',
  'error.diagnosis.ai_result': 'AI diagnosis',
  'error.diagnostic_report.action': 'Report a problem',
  'error.diagnostic_report.location': 'Location',
  'error.message': 'Error message',
  'error.modelId': 'Model',
  'error.name': 'Error name',
  'error.provider': 'Provider',
  'error.stack': 'Stack',
  'error.statusCode': 'Status code',
  'message.copied': 'Copied'
}

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

vi.mock('@renderer/i18n/resolver', () => ({ default: { t: (key: string) => translations[key] ?? key } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => translations[key] ?? key
  })
}))

vi.mock('@renderer/components/doctor/DoctorPopup', () => ({
  default: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))

import { PopupHost } from '@renderer/components/PopupHost'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const { ErrorDetailContent, showErrorDetailPopup } = await import('../ErrorDetailModal')

Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })

describe('ErrorDetailContent diagnostic report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.useFakeTimers()
    await act(async () => {
      for (const entry of [...popupService.getSnapshot()]) {
        popupService.settle(entry.instanceId, undefined)
      }
      vi.advanceTimersByTime(POPUP_EXIT_MS)
    })
    vi.useRealTimers()
  })

  it('shows the report action only with a configured handoff and passes the reviewed description to its owner', async () => {
    const user = userEvent.setup()
    const onOpenDiagnosticReport = vi.fn()
    const { rerender } = render(
      <ErrorDetailContent error={{ name: 'ProviderError', message: 'failed', stack: null }} />
    )

    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument()

    rerender(
      <ErrorDetailContent
        diagnosticReport={{ location: 'Home conversation' }}
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
        onOpenDiagnosticReport={onOpenDiagnosticReport}
      />
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Copy',
      'Report a problem',
      'AI diagnosis'
    ])
    await user.click(screen.getByRole('button', { name: 'Report a problem' }))
    const description = onOpenDiagnosticReport.mock.calls[0][0]
    expect(description).toContain('Location: Home conversation')
    expect(description).toContain('Error name: ProviderError')
    expect(description).toContain('Error message: failed')
  })

  it('waits for error details to finish closing before opening report review', async () => {
    vi.useFakeTimers()
    render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({
        diagnosticReport: { location: 'Home conversation' },
        error: { name: 'ProviderError', message: 'failed', stack: null }
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    await act(async () => {})

    expect(mocks.showDoctor).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(POPUP_EXIT_MS - 1)
    })
    expect(mocks.showDoctor).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    await act(async () => {})
    expect(mocks.showDoctor).toHaveBeenCalledWith({
      initialPanel: 'report',
      initialDescription: expect.stringContaining('Location: Home conversation')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps AI diagnosis visible in error details but out of the diagnostic-report prefill', async () => {
    const user = userEvent.setup()
    const onOpenDiagnosticReport = vi.fn()
    mocks.diagnoseError.mockResolvedValueOnce({
      category: 'runtime',
      explanation: 'Leaked prompt: private diagnosis payload.',
      steps: [],
      summary: 'Provider failed'
    })

    render(
      <ErrorDetailContent
        blockId="message-1-part-0"
        diagnosticReport={{ location: 'Agent conversation' }}
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
        onDiagnosisComplete={vi.fn()}
        onOpenDiagnosticReport={onOpenDiagnosticReport}
      />
    )

    await user.click(screen.getByRole('button', { name: 'AI diagnosis' }))
    expect(await screen.findByText('Leaked prompt: private diagnosis payload.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Report a problem' }))
    const description = onOpenDiagnosticReport.mock.calls[0][0]
    expect(description).toContain('Error message: failed')
    expect(description).not.toContain('private diagnosis payload')
  })
})
