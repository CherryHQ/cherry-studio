import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())
const navigateMock = vi.hoisted(() => vi.fn())
const searchMock = vi.hoisted(() => ({ id: 'skill-1' as string | undefined }))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: {
    resourceType: string
    selectedSkillId?: string
    onSelectedSkillIdChange?: (skillId: string | undefined) => void
  }) => {
    resourceCatalogViewMock(props)
    return <div data-testid="resource-catalog" />
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => searchMock,
  useNavigate: () => navigateMock
}))

describe('SkillsSettings', () => {
  it('renders the global Skill catalog', () => {
    render(<SkillsSettings />)

    const resourceCatalog = screen.getByTestId('resource-catalog')
    expect(resourceCatalog).toBeInTheDocument()
    expect(resourceCatalog.parentElement?.parentElement).toHaveClass('pt-4')
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'skill', variant: 'settings', selectedSkillId: 'skill-1' })
    )
    expect(resourceCatalogViewMock.mock.calls[0]?.[0]).not.toHaveProperty('description')

    resourceCatalogViewMock.mock.calls[0]?.[0].onSelectedSkillIdChange?.(undefined)
    const updateSearch = navigateMock.mock.calls[0]?.[0].search as (previous: { id?: string }) => { id?: string }
    expect(updateSearch({ id: 'skill-1' })).toEqual({ id: undefined })
  })
})
