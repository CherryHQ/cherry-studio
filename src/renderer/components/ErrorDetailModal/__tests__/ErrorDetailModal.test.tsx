import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn(),
  diagnosticUploadModuleEvaluated: vi.fn()
}))

const translations: Record<string, string> = {
  'common.copy': 'Copy',
  'error.diagnosis.ai_button': 'AI diagnosis',
  'error.diagnosis.ai_done': 'AI diagnosis complete',
  'error.diagnosis.ai_loading': 'Diagnosing',
  'error.diagnosis.ai_result': 'AI diagnosis',
  'error.diagnostic_report.action': 'Submit diagnostic report',
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

vi.mock('@renderer/components/feedback/DiagnosticUploadDialog', () => {
  mocks.diagnosticUploadModuleEvaluated()
  return {
    default: ({
      initialDescription,
      onOpenChange,
      open
    }: {
      initialDescription?: string
      onOpenChange: (open: boolean) => void
      open: boolean
    }) =>
      open ? (
        <div role="dialog" aria-label="Diagnostic report review">
          <pre>{initialDescription}</pre>
          <button type="button" onClick={() => onOpenChange(false)}>
            Cancel report
          </button>
        </div>
      ) : null
  }
})

function createDeferredDiagnosis() {
  let resolve!: (diagnosis: DiagnosisResult) => void
  const promise = new Promise<DiagnosisResult>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const { ErrorDetailContent } = await import('../ErrorDetailModal')

Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })

describe('ErrorDetailContent diagnostic report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the report action only with configuration and returns to the preserved detail after closing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ErrorDetailContent error={{ name: 'ProviderError', message: 'failed', stack: null }} />
    )

    expect(screen.queryByRole('button', { name: 'Submit diagnostic report' })).not.toBeInTheDocument()
    expect(mocks.diagnosticUploadModuleEvaluated).not.toHaveBeenCalled()

    rerender(
      <ErrorDetailContent
        diagnosticReport={{ location: 'Home conversation' }}
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
      />
    )

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Copy',
      'Submit diagnostic report',
      'AI diagnosis'
    ])
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    expect(await screen.findByRole('dialog', { name: 'Diagnostic report review' })).toHaveTextContent(
      'Location: Home conversation'
    )
    expect(mocks.diagnosticUploadModuleEvaluated).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Cancel report' }))
    expect(screen.queryByRole('dialog', { name: 'Diagnostic report review' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit diagnostic report' })).toBeInTheDocument()
  })

  it('uses a diagnosis completed in the current error-detail session', async () => {
    const user = userEvent.setup()
    mocks.diagnoseError.mockResolvedValueOnce({
      category: 'runtime',
      explanation: 'Check the provider account.',
      steps: [],
      summary: 'Provider failed'
    })

    render(
      <ErrorDetailContent
        blockId="message-1-part-0"
        diagnosticReport={{ location: 'Agent conversation' }}
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
        onDiagnosisComplete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'AI diagnosis' }))
    expect(await screen.findByText('Check the provider account.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    expect(screen.getByRole('dialog', { name: 'Diagnostic report review' })).toHaveTextContent(
      'AI diagnosis: Check the provider account.'
    )
  })

  it('does not overwrite an open report when a pending diagnosis finishes', async () => {
    const user = userEvent.setup()
    const pendingDiagnosis = createDeferredDiagnosis()
    mocks.diagnoseError.mockReturnValueOnce(pendingDiagnosis.promise)

    render(
      <ErrorDetailContent
        blockId="message-1-part-0"
        diagnosticReport={{ location: 'Home conversation' }}
        error={{ name: 'ProviderError', message: 'failed', stack: null }}
        onDiagnosisComplete={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'AI diagnosis' }))
    await user.click(screen.getByRole('button', { name: 'Submit diagnostic report' }))
    const report = await screen.findByRole('dialog', { name: 'Diagnostic report review' })

    await act(async () => {
      pendingDiagnosis.resolve({
        category: 'runtime',
        explanation: 'Late diagnosis',
        steps: [],
        summary: 'Late'
      })
    })

    expect(report).not.toHaveTextContent('Late diagnosis')
  })
})
