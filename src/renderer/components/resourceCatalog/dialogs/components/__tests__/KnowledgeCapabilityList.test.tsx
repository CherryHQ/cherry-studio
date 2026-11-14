import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { KnowledgeCapabilityList } from '../KnowledgeCapabilityList'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ bases: [{ id: 'kb-docs', name: 'Docs', itemCount: 3 }], isLoading: false }),
  useCreateKnowledgeBase: () => ({ createBase: vi.fn(), isCreating: false })
}))
vi.mock('@renderer/hooks/useGroups', () => ({ useGroups: () => ({ groups: [] }) }))
vi.mock('@renderer/components/knowledge/CreateKnowledgeBaseDialog', () => ({
  default: ({ open, onCreated }: { open: boolean; onCreated: (base: { id: string }) => void }) =>
    open ? (
      <div role="dialog" aria-label="new knowledge base">
        <button type="button" onClick={() => onCreated({ id: 'kb-new' })}>
          create
        </button>
      </div>
    ) : null
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

function Harness() {
  const [selectedIds, setSelectedIds] = useState<string[]>(['kb-docs'])
  return (
    <>
      <KnowledgeCapabilityList selectedIds={selectedIds} onSelectedIdsChange={setSelectedIds} portalContainer={null} />
      <output data-testid="selected">{selectedIds.join(',')}</output>
    </>
  )
}

describe('KnowledgeCapabilityList', () => {
  it('only offers creating a knowledge base, and links the one created from here', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'library.config.knowledge.add' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['knowledge.add.title'])
    await user.click(screen.getByRole('menuitem', { name: 'knowledge.add.title' }))
    await user.click(screen.getByRole('button', { name: 'create' }))

    expect(screen.getByTestId('selected')).toHaveTextContent('kb-docs,kb-new')
  })
})
