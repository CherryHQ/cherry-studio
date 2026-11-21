import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { type CapabilityItem, CapabilityList } from '../CapabilityList'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
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

const ENABLE_ALL = 'library.config.agent.section.tools.skills_enable_all'
const ITEMS: CapabilityItem[] = [
  { id: 'builtin', name: 'skill-creator', description: 'Create skills', locked: true },
  { id: 'review', name: 'code-review', description: 'Review changes' },
  { id: 'pdf', name: 'pdf', description: 'Fill PDF forms' },
  { id: 'off', name: 'inactive server', pickable: false }
]

function Harness({ items = ITEMS, initial = [] as string[], onAdd = vi.fn() }) {
  const [selectedIds, setSelectedIds] = useState(initial)
  return (
    <>
      <CapabilityList
        items={items}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        searchPlaceholder="Search skills"
        addLabel="Add skill"
        addActions={[{ id: 'import', label: 'Local import', icon: null, onSelect: onAdd }]}
        emptyLabel="No skills installed"
        portalContainer={null}
      />
      <output data-testid="selected">{selectedIds.join(',')}</output>
    </>
  )
}

describe('CapabilityList', () => {
  it('filters rows by name or description', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'forms')
    expect(screen.getByRole('switch', { name: 'pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'code-review' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Search skills' }))
    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'review')
    expect(screen.getByRole('switch', { name: 'code-review' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'pdf' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('textbox', { name: 'Search skills' }))
    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'zzz')
    expect(screen.getByText('common.no_results')).toBeInTheDocument()
  })

  it('enables every switchable item with Enable all and keeps selections that are not listed', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['deleted-kb']} />)

    await user.click(screen.getByRole('switch', { name: ENABLE_ALL }))
    expect(screen.getByTestId('selected')).toHaveTextContent('deleted-kb,review,pdf')
    expect(screen.getByRole('switch', { name: ENABLE_ALL })).toBeChecked()

    await user.click(screen.getByRole('switch', { name: ENABLE_ALL }))
    expect(screen.getByTestId('selected').textContent).toBe('deleted-kb')
  })

  it('keeps a locked item on without writing it to the selection', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const locked = screen.getByRole('switch', { name: 'skill-creator' })
    expect(locked).toBeChecked()
    expect(locked).toBeDisabled()

    await user.click(screen.getByRole('switch', { name: 'code-review' }))
    expect(screen.getByTestId('selected').textContent).toBe('review')
  })

  it('runs an add action from the add menu', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(<Harness onAdd={onAdd} />)

    await user.click(screen.getByRole('button', { name: 'Add skill' }))
    await user.click(screen.getByRole('menuitem', { name: 'Local import' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('keeps search, add, and Enable all when there is nothing to list', () => {
    render(<Harness items={[]} />)

    expect(screen.getByText('No skills installed')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add skill' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: ENABLE_ALL })).toBeDisabled()
  })
})
