import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import KnowledgePageDialogSection from '../KnowledgePageDialogSection'

const { knowledgePage } = vi.hoisted(() => ({ knowledgePage: vi.fn() }))
vi.mock('../../KnowledgePageProvider', () => ({ useKnowledgePage: knowledgePage }))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

const originalLanguage = i18n.language
beforeAll(async () => {
  await i18n.changeLanguage('en-us')
})
afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})
afterEach(() => vi.restoreAllMocks())

it('keeps the renamed group and its dialog in the closed phase before unmounting', async () => {
  const getComputedStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const styles = getComputedStyle(element)
    return new Proxy(styles, {
      get(target, property, receiver) {
        if (property === 'animationName') return element.getAttribute('data-state') === 'closed' ? 'exit' : 'enter'
        if (property === 'display') return 'grid'
        return Reflect.get(target, property, receiver)
      }
    })
  })
  const state = {
    editingGroup: { id: 'group-1', name: 'Research' } as { id: string; name: string } | null,
    editingBase: null,
    restoringBase: null,
    isAddSourceDialogOpen: false,
    isCreateBaseDialogOpen: false,
    isCreateGroupDialogOpen: false,
    isUpdatingGroup: false,
    handleRenameGroupDialogOpenChange: vi.fn(),
    submitRenameGroup: vi.fn()
  }
  knowledgePage.mockImplementation(() => state)
  const { rerender } = render(<KnowledgePageDialogSection />)
  await act(async () => {
    await import('../../components/RenameKnowledgeGroupDialog')
  })
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('textbox')).toHaveValue('Research')

  state.editingGroup = null
  rerender(<KnowledgePageDialogSection />)

  expect(dialog).toBeInTheDocument()
  expect(dialog).toHaveAttribute('data-state', 'closed')
  expect(within(dialog).getByRole('textbox')).toHaveValue('Research')
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})
