import { describe, expect, it, vi } from 'vitest'

const PROBE_TIMEOUT = 45_000
const deleteDialogEvaluated = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/resourceCatalog/dialogs/WorkspaceDeleteConfirmDialog', () => {
  deleteDialogEvaluated()
  return { WorkspaceDeleteConfirmDialog: () => null }
})

describe('WorkspaceSelector lazy boundary', () => {
  it(
    'evaluates the workspace delete dialog only when it is imported on demand',
    async () => {
      await import('../WorkspaceSelector')

      expect(deleteDialogEvaluated).not.toHaveBeenCalled()
      await import('@renderer/components/resourceCatalog/dialogs/WorkspaceDeleteConfirmDialog')

      expect(deleteDialogEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
