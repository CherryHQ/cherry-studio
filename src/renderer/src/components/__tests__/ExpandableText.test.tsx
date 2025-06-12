import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ExpandableText from '../ExpandableText'

// mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}))

describe('ExpandableText', () => {
  const TEXT = 'This is a long text for testing.'

  it('should render text and expand button', () => {
    render(<ExpandableText text={TEXT} />)
    expect(screen.getByText(TEXT)).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('common.expand')
  })

  it('should toggle expand/collapse when button is clicked', async () => {
    render(<ExpandableText text={TEXT} />)
    const button = screen.getByRole('button')
    // 初始为收起状态
    expect(button).toHaveTextContent('common.expand')
    // 点击展开
    await userEvent.click(button)
    expect(button).toHaveTextContent('common.collapse')
    // 再次点击收起
    await userEvent.click(button)
    expect(button).toHaveTextContent('common.expand')
  })
})
