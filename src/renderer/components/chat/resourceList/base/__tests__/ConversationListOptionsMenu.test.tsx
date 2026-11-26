import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as Ui from '@cherrystudio/ui'
import type { ConversationListSort } from '@shared/data/types/conversationList'

import { ConversationListOptionsMenu } from '../ConversationListOptionsMenu'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await vi.importActual<typeof Ui>('@cherrystudio/ui')
  return {
    ...(await importOriginal()),
    DropdownMenu: actual.DropdownMenu,
    DropdownMenuContent: actual.DropdownMenuContent,
    DropdownMenuItem: actual.DropdownMenuItem,
    DropdownMenuPortal: actual.DropdownMenuPortal,
    DropdownMenuRadioGroup: actual.DropdownMenuRadioGroup,
    DropdownMenuRadioItem: actual.DropdownMenuRadioItem,
    DropdownMenuSeparator: actual.DropdownMenuSeparator,
    DropdownMenuSub: actual.DropdownMenuSub,
    DropdownMenuSubContent: actual.DropdownMenuSubContent,
    DropdownMenuSubTrigger: actual.DropdownMenuSubTrigger,
    DropdownMenuTrigger: actual.DropdownMenuTrigger
  }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Menu() {
  const [mode, setMode] = useState('time')
  const [sort, setSort] = useState<ConversationListSort>({ by: 'lastActivityAt', direction: 'asc' })
  return (
    <>
      <output aria-label="saved choice">{JSON.stringify({ mode, sort })}</output>
      <ConversationListOptionsMenu
        title="Group by"
        mode={mode}
        onChange={setMode}
        options={[
          { label: 'Time', value: 'time' },
          { label: 'Owner', value: 'owner' }
        ]}
        sort={sort}
        onSortChange={setSort}
      />
    </>
  )
}

describe('ConversationListOptionsMenu', () => {
  // Grouping previously silently replaced the sorting rule; choices must remain independent.
  it('keeps sorting when grouping changes, and replaces it only through Sort by', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    const openSubmenu = async (name: RegExp) => {
      await user.click(screen.getByRole('button', { name: 'chat.list.options' }))
      await user.click(screen.getByRole('menuitem', { name }))
      await user.keyboard('{ArrowRight}')
    }
    await openSubmenu(/^Group by/)
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByLabelText('saved choice')).toHaveTextContent('"mode":"owner"'))
    expect(screen.getByLabelText('saved choice')).toHaveTextContent('"sort":{"by":"lastActivityAt","direction":"asc"}')

    await openSubmenu(/^chat.list.sort.title/)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() =>
      expect(screen.getByLabelText('saved choice')).toHaveTextContent('"sort":{"by":"name","direction":"asc"}')
    )
    expect(screen.getByLabelText('saved choice')).toHaveTextContent('"mode":"owner"')

    await openSubmenu(/^chat.list.sort.title/)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByLabelText('saved choice')).toHaveTextContent('"direction":"desc"'))

    await openSubmenu(/^chat.list.sort.title/)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByLabelText('saved choice')).toHaveTextContent('"sort":{"by":"orderKey"}'))
    await openSubmenu(/^chat.list.sort.title/)
    expect(screen.queryByRole('menuitemradio', { name: 'chat.list.sort.descending' })).not.toBeInTheDocument()
  })
})
