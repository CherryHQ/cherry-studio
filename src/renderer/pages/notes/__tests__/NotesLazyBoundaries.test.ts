import { describe, expect, it, vi } from 'vitest'

const PROBE_TIMEOUT = 45_000

const optionalModules = vi.hoisted(() => ({
  exportServiceEvaluated: vi.fn(),
  knowledgeHookEvaluated: vi.fn(),
  notesSettingsEvaluated: vi.fn(),
  obsidianPopupEvaluated: vi.fn(),
  saveToKnowledgePopupEvaluated: vi.fn()
}))

vi.mock('@renderer/services/ExportService', () => {
  optionalModules.exportServiceEvaluated()
  return { exportNote: vi.fn() }
})

vi.mock('@renderer/hooks/useKnowledgeBase', () => {
  optionalModules.knowledgeHookEvaluated()
  return { useKnowledgeBases: vi.fn(() => ({ bases: [] })) }
})

vi.mock('@renderer/components/ObsidianExportPopup', () => {
  optionalModules.obsidianPopupEvaluated()
  return { default: { show: vi.fn() } }
})

vi.mock('@renderer/components/SaveToKnowledgePopup', () => {
  optionalModules.saveToKnowledgePopupEvaluated()
  return { default: { showForNote: vi.fn() } }
})

vi.mock('../NotesSettings', () => {
  optionalModules.notesSettingsEvaluated()
  return { default: () => null }
})

describe('Notes optional workflow lazy boundaries', () => {
  it(
    'does not evaluate optional workflow modules when the Notes menu surfaces load',
    async () => {
      await Promise.all([import('../hooks/useNotesMenu'), import('../HeaderNavbar')])

      expect(optionalModules.exportServiceEvaluated).not.toHaveBeenCalled()
      expect(optionalModules.knowledgeHookEvaluated).not.toHaveBeenCalled()
      expect(optionalModules.notesSettingsEvaluated).not.toHaveBeenCalled()
      expect(optionalModules.obsidianPopupEvaluated).not.toHaveBeenCalled()
      expect(optionalModules.saveToKnowledgePopupEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: the optional modules remain loadable on demand',
    async () => {
      await Promise.all([
        import('@renderer/services/ExportService'),
        import('@renderer/hooks/useKnowledgeBase'),
        import('@renderer/components/ObsidianExportPopup'),
        import('@renderer/components/SaveToKnowledgePopup'),
        import('../NotesSettings')
      ])

      expect(optionalModules.exportServiceEvaluated).toHaveBeenCalledTimes(1)
      expect(optionalModules.knowledgeHookEvaluated).toHaveBeenCalledTimes(1)
      expect(optionalModules.notesSettingsEvaluated).toHaveBeenCalledTimes(1)
      expect(optionalModules.obsidianPopupEvaluated).toHaveBeenCalledTimes(1)
      expect(optionalModules.saveToKnowledgePopupEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
