import { Tag } from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

const COLOR = '#ff0000'

describe('Tag', () => {
  it('should render children text', () => {
    render(<Tag color={COLOR}>content</Tag>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('should render icon if provided', () => {
    render(
      <Tag color={COLOR} icon={<span data-testid="icon">cherry</span>}>
        content
      </Tag>
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('should render closable tag with close button', () => {
    render(
      <Tag color={COLOR} closable>
        closable tag
      </Tag>
    )
    expect(screen.getByText('closable tag')).toBeInTheDocument()
    expect(screen.getByTestId('tag-close')).toBeInTheDocument()
  })

  it('should not allow click when disabled', () => {
    render(
      <Tag color={COLOR} disabled>
        tag-content
      </Tag>
    )
    const tag = screen.getByTestId('tag')
    expect(tag).toBeInTheDocument()
    expect(tag).toHaveStyle({ cursor: 'not-allowed' })
  })
})
