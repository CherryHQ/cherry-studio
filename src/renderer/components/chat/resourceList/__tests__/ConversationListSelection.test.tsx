import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { ResourceList } from '../base'
import { ConversationListSelectionToolbar } from '../ConversationListSelection'
vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
it('selects only eligible filtered items and keeps archive/cancel actions reachable', async () => {
  const items = [
    { id: 'a', name: 'A', pinned: false },
    { id: 'b', name: 'B', pinned: true }
  ]
  const onSelectAll = vi.fn(),
    onArchive = vi.fn(),
    onCancel = vi.fn()
  render(
    <ResourceList.Provider items={items}>
      <ConversationListSelectionToolbar<(typeof items)[number]>
        canSelectAll
        canSelectItem={(item) => !item.pinned}
        onArchive={onArchive}
        onCancel={onCancel}
        onSelectAll={onSelectAll}
        selectedCount={1}
      />
    </ResourceList.Provider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'common.select_all_filtered' }))
  expect(onSelectAll).toHaveBeenCalledWith([items[0]])
  await user.click(screen.getByRole('button', { name: 'common.archive (1)' }))
  expect(onArchive).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'common.cancel' }))
  expect(onCancel).toHaveBeenCalledOnce()
})
