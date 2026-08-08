import { describe, expect, it, vi } from 'vitest'

const PROBE_TIMEOUT = 45_000
const deleteDialogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/resourceCatalog/dialogs/WorkspaceDeleteConfirmDialog', () => {
  deleteDialogEvaluated()
  return { WorkspaceDeleteConfirmDialog: () => null }
})

describe('WorkspaceSelector lazy boundary', () => {
  it(
    'does not evaluate the workspace delete dialog when the selector module loads',
    async () => {
      await import('../WorkspaceSelector')

      expect(deleteDialogEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'loads the workspace delete dialog module on demand',
    async () => {
      await import('@renderer/components/resourceCatalog/dialogs/WorkspaceDeleteConfirmDialog')

      expect(deleteDialogEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
