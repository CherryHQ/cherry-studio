import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  BackToMainWindowIcon,
  CherryPulse,
  CherryShimmer,
  FinderIcon,
  OpenInNewWindowIcon,
  RightSidebarCollapseIcon,
  RightSidebarExpandIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon
} from '..'

describe('renderer icon assets', () => {
  it('exports the Cherry loading marks with accessible labels', () => {
    render(
      <>
        <CherryShimmer size={20} />
        <CherryPulse size={24} />
      </>
    )

    const loadingMarks = screen.getAllByRole('img', { name: 'Cherry Studio loading' })
    expect(loadingMarks).toHaveLength(2)
    expect(loadingMarks[0]).toHaveAttribute('width', '20')
    expect(loadingMarks[1]).toHaveAttribute('height', '24')
  })

  it('renders the Finder icon as an image', () => {
    render(<FinderIcon data-testid="finder-icon" />)

    expect(screen.getByRole('img', { name: 'Finder' })).toHaveAttribute('data-testid', 'finder-icon')
  })

  it('keeps decorative sidebar and window icons hidden from assistive tech', () => {
    const { container } = render(
      <>
        <SidebarCollapseIcon />
        <SidebarExpandIcon />
        <RightSidebarCollapseIcon />
        <RightSidebarExpandIcon />
        <BackToMainWindowIcon size={18} />
        <OpenInNewWindowIcon size={20} />
      </>
    )

    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons).toHaveLength(6)
    expect(icons[4]).toHaveAttribute('width', '18')
    expect(icons[5]).toHaveAttribute('height', '20')
  })
})
