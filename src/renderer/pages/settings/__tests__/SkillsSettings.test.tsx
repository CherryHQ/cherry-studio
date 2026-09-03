import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const { launchSkillMock, navigateMock, resourceCatalogViewMock } = vi.hoisted(() => ({
  launchSkillMock: vi.fn(),
  navigateMock: vi.fn(),
  resourceCatalogViewMock: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('@renderer/hooks/useSkillLauncher', () => ({
  useSkillLauncher: () => launchSkillMock
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: { resourceType: string }) => {
    resourceCatalogViewMock(props)
    return <div data-testid="resource-catalog" />
  }
}))

describe('SkillsSettings', () => {
  it('renders the global Skill catalog', () => {
    render(<SkillsSettings />)

    const resourceCatalog = screen.getByTestId('resource-catalog')
    expect(resourceCatalog).toBeInTheDocument()
    expect(resourceCatalog.parentElement?.parentElement).toHaveClass('pt-4')
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        onLaunchSkill: launchSkillMock,
        onOpenSkill: expect.any(Function),
        resourceType: 'skill',
        variant: 'settings'
      })
    )
    expect(resourceCatalogViewMock.mock.calls[0]?.[0]).not.toHaveProperty('description')

    resourceCatalogViewMock.mock.calls[0]?.[0].onOpenSkill({ id: 'skill-1' })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/skills/$skillId', params: { skillId: 'skill-1' } })
  })
})
