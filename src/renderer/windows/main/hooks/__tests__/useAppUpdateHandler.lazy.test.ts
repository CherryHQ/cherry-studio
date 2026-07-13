import { describe, expect, it, vi } from 'vitest'

// Evaluating large module graphs (icon barrels, chat chain) under full-suite
// concurrency can blow past the global testTimeout — pin a generous bound.
const PROBE_TIMEOUT = 45_000

const updateDialogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/UpdateDialogPopup', () => {
  updateDialogEvaluated()
  return { default: { show: vi.fn() } }
})

/**
 * Lazy-boundary probe (S6c): UpdateDialogPopup drags the streamdown/remark
 * markdown stack (~0.84 MB) along. The update handler runs in main's first
 * paint, so it must only reach the dialog via dynamic import.
 */
describe('useAppUpdateHandler lazy boundary', () => {
  it(
    'importing the handler does not evaluate UpdateDialogPopup',
    async () => {
      await import('../useAppUpdateHandler')
      expect(updateDialogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: the dialog module loads on demand',
    async () => {
      await import('@renderer/components/UpdateDialogPopup')
      expect(updateDialogEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
