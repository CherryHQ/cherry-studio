import { Accordion } from '@cherrystudio/ui'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@renderer/utils/errorDiagnosis', () => ({ diagnoseError: mocks.diagnoseError }))

const { default: AiDiagnosisSection } = await import('../AiDiagnosisSection')

function renderAiDiagnosis(props: ComponentProps<typeof AiDiagnosisSection>) {
  return render(
    <Accordion type="single" collapsible defaultValue="ai-diagnosis">
      <AiDiagnosisSection {...props} />
    </Accordion>
  )
}

function getStartDiagnosisButton() {
  const action = screen
    .getAllByRole('button', { name: 'AI 诊断' })
    .find((button) => !button.hasAttribute('aria-expanded'))
  expect(action).toBeDefined()
  return action as HTMLButtonElement
}

function ControlledAiDiagnosis(props: Omit<ComponentProps<typeof AiDiagnosisSection>, 'status' | 'onStatusChange'>) {
  const [status, setStatus] = useState<ComponentProps<typeof AiDiagnosisSection>['status']>('idle')
  return <AiDiagnosisSection {...props} status={status} onStatusChange={setStatus} />
}

function renderControlledAiDiagnosis(
  props: Omit<ComponentProps<typeof AiDiagnosisSection>, 'status' | 'onStatusChange'>
) {
  return render(
    <Accordion type="single" collapsible defaultValue="ai-diagnosis">
      <ControlledAiDiagnosis {...props} />
    </Accordion>
  )
}

describe('AiDiagnosisSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.diagnoseError.mockResolvedValue({
      summary: 'Runtime failed',
      category: 'runtime',
      explanation: 'Check the provider',
      steps: []
    })
  })

  it('does not announce an idle diagnosis as checking before the user starts it', () => {
    renderAiDiagnosis({
      error: { name: 'ProviderError', message: 'failed', stack: null },
      status: 'idle',
      onStatusChange: vi.fn()
    })

    expect(screen.queryByText('检查中')).not.toBeInTheDocument()
    expect(mocks.diagnoseError).not.toHaveBeenCalled()
  })

  it('delegates diagnosis persistence to the injected capability', async () => {
    const user = userEvent.setup()
    const onDiagnosisComplete = vi.fn()

    renderAiDiagnosis({
      error: { name: 'AgentRuntimeError', message: 'failed', stack: null },
      status: 'idle',
      onStatusChange: vi.fn(),
      blockId: 'message-1-part-0',
      onDiagnosisComplete
    })

    await user.click(getStartDiagnosisButton())

    await waitFor(() => {
      expect(onDiagnosisComplete).toHaveBeenCalledWith(
        'message-1-part-0',
        expect.objectContaining({ summary: 'Runtime failed' })
      )
    })
  })

  it('keeps a completed diagnosis visible when persistence fails', async () => {
    const user = userEvent.setup()

    renderControlledAiDiagnosis({
      error: { name: 'ProviderError', message: 'failed', stack: null },
      blockId: 'message-1-part-0',
      onDiagnosisComplete: () => {
        throw new Error('write failed')
      }
    })

    await user.click(getStartDiagnosisButton())

    expect(await screen.findByText('Check the provider')).toBeVisible()
  })

  it('ignores a diagnosis that completes after unmount', async () => {
    const user = userEvent.setup()
    const diagnosis = {
      summary: 'Late result',
      category: 'runtime',
      explanation: 'No longer relevant',
      steps: []
    }
    let resolveDiagnosis!: (value: typeof diagnosis) => void
    mocks.diagnoseError.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDiagnosis = resolve
      })
    )
    const onStatusChange = vi.fn()
    const onDiagnosisComplete = vi.fn()

    const { unmount } = renderAiDiagnosis({
      error: { name: 'ProviderError', message: 'failed', stack: null },
      status: 'idle',
      onStatusChange,
      blockId: 'message-1-part-0',
      onDiagnosisComplete
    })

    await user.click(getStartDiagnosisButton())
    await waitFor(() => expect(mocks.diagnoseError).toHaveBeenCalledOnce())
    unmount()
    await act(async () => resolveDiagnosis(diagnosis))

    expect(onStatusChange).not.toHaveBeenCalledWith('done')
    expect(onStatusChange).not.toHaveBeenCalledWith('error')
    expect(onDiagnosisComplete).not.toHaveBeenCalled()
  })
})
