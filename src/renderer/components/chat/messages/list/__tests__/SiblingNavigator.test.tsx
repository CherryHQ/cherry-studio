import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import SiblingNavigator from '../SiblingNavigator'

vi.unmock('@cherrystudio/ui')

const scrollIntoView = HTMLElement.prototype.scrollIntoView
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView
})

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => ({}),
  useMessageListUi: () => ({
    getMessageSiblings: () => ({
      group: [
        { id: 'first', preview: 'First branch' },
        { id: 'current', preview: 'Current branch' },
        { id: 'last', preview: 'Last branch' }
      ],
      activeIndex: 1
    })
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: () => 'Branches' })
}))

describe('SiblingNavigator focus', () => {
  it.each(['pointer', 'keyboard'])(
    'focuses the current branch when opened with %s and allows arrow navigation',
    async (input) => {
      const user = userEvent.setup()
      render(<SiblingNavigator messageId="current" />)
      const trigger = screen.getByRole('button', { name: 'Branches', expanded: false })

      if (input === 'pointer') {
        await user.click(trigger)
      } else {
        trigger.focus()
        await user.keyboard('{ArrowDown}')
      }

      expect(await screen.findByRole('menuitem', { name: '2 Current branch' })).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitem', { name: '3 Last branch' })).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(screen.getByRole('menuitem', { name: '2 Current branch' })).toHaveFocus()
    }
  )
})
