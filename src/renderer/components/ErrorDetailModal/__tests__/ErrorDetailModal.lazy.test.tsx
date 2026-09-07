import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  diagnosisModuleEvaluated: vi.fn(),
  showPopup: vi.fn()
}))

vi.mock('@renderer/components/popups/ContentPopup', () => ({
  default: { show: mocks.showPopup }
}))

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

  it('opens error details without loading the AI diagnosis implementation', () => {
    expect(diagnosisEvaluationsWhenDetailLoaded).toBe(0)

    showErrorDetailPopup({ error: { name: 'ProviderError', message: 'unavailable', stack: null } })

    expect(mocks.showPopup).toHaveBeenCalledOnce()
    expect(mocks.diagnosisModuleEvaluated).not.toHaveBeenCalled()
  })
})
