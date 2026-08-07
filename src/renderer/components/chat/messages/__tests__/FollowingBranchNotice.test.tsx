import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import FollowingBranchNotice from '../FollowingBranchNotice'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'chat.message.following_branch.notice') return `${options?.count ?? 0} more messages`
      if (key === 'chat.message.following_branch.open') return 'View branches'
      return key
    }
  })
}))

describe('FollowingBranchNotice', () => {
  it('renders the hidden-message count and a view-branches affordance', () => {
    render(<FollowingBranchNotice count={3} onOpenBranches={() => {}} />)

    expect(screen.getByTestId('following-branch-notice')).toBeInTheDocument()
    expect(screen.getByText('3 more messages')).toBeInTheDocument()
    expect(screen.getByText('View branches')).toBeInTheDocument()
  })

  it('calls onOpenBranches when clicked', () => {
    const onOpenBranches = vi.fn()
    render(<FollowingBranchNotice count={1} onOpenBranches={onOpenBranches} />)

    fireEvent.click(screen.getByTestId('following-branch-notice'))

    expect(onOpenBranches).toHaveBeenCalledTimes(1)
  })
})
