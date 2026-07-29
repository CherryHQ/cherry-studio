import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: { resourceType: string }) => {
    resourceCatalogViewMock(props)
    return <div data-testid="resource-catalog" />
  }
}))

describe('SkillsSettings', () => {
  it('renders the global Skill catalog', () => {
    render(<SkillsSettings />)

    expect(screen.getByTestId('resource-catalog')).toBeInTheDocument()
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'skill' }))
  })
})
