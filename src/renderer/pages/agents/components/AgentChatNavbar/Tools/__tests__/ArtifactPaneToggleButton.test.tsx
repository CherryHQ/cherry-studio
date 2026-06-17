import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, MouseEventHandler, PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ArtifactPaneToggleButton from '../ArtifactPaneToggleButton'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    onPress,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      onPress?: MouseEventHandler<HTMLButtonElement>
    }
  >) => (
    <button type="button" {...props} onClick={onPress ?? props.onClick}>
      {children}
    </button>
  ),
  Tooltip: ({ children, content }: PropsWithChildren<{ content: string }>) => (
    <div data-testid="artifact-tooltip" data-content={content}>
      {children}
    </div>
  )
}))

vi.mock('i18next', () => ({
  t: (key: string) => key
}))

describe('ArtifactPaneToggleButton', () => {
  it('renders the preview tooltip and toggles through explicit props', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<ArtifactPaneToggleButton open={false} onToggle={onToggle} />)

    expect(screen.getByTestId('artifact-tooltip')).toHaveAttribute('data-content', 'agent.preview_pane.toggle')

    const toggle = screen.getByLabelText('agent.preview_pane.toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('data-state', 'closed')
    expect(toggle).not.toHaveAttribute('data-active')

    fireEvent.click(toggle)

    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<ArtifactPaneToggleButton open={true} onToggle={onToggle} />)

    expect(screen.getByLabelText('agent.preview_pane.toggle')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('agent.preview_pane.toggle')).toHaveAttribute('data-state', 'open')
    expect(screen.getByLabelText('agent.preview_pane.toggle')).toHaveAttribute('data-active', 'true')
  })
})
