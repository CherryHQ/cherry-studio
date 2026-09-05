import { PopupHost } from '@renderer/components/PopupHost'
import { popupService } from '@renderer/services/popup'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnosisModuleEvaluated: vi.fn()
}))

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())
vi.mock('../ErrorDiagnosticsPanel', () => ({ ErrorDiagnosticsPanel: () => null }))

vi.mock('@renderer/utils/errorDiagnosis', () => {
  mocks.diagnosisModuleEvaluated()
  return {}
})

const { showErrorDetailPopup } = await import('../ErrorDetailModal')
const diagnosisEvaluationsWhenDetailLoaded = mocks.diagnosisModuleEvaluated.mock.calls.length

describe('ErrorDetailModal lazy dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    for (const entry of [...popupService.getSnapshot()]) {
      popupService.settle(entry.instanceId, undefined)
    }
  })

  it('opens error details without loading the AI diagnosis implementation', () => {
    expect(diagnosisEvaluationsWhenDetailLoaded).toBe(0)
    render(<PopupHost />)

    act(() => {
      showErrorDetailPopup({ error: { name: 'ProviderError', message: 'unavailable', stack: null } })
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.diagnosisModuleEvaluated).not.toHaveBeenCalled()
  })
})
