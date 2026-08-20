import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())
const persistCacheState = vi.hoisted(() => ({ enabledOnly: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.skills.enabledOnly': 'Enabled Skills Only',
        'settings.skills.title': 'Skills'
      })[key] ?? key
  })
}))

vi.mock('@data/hooks/useCache', async () => {
  const React = await import('react')

  return {
    usePersistCache: () => {
      const [value, setValue] = React.useState(persistCacheState.enabledOnly)
      const update = (next: boolean) => {
        persistCacheState.enabledOnly = next
        setValue(next)
      }
      return [value, update]
    }
  }
})

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: {
    resourceType: string
    resourceFilter?: (resource: { type: 'skill'; raw: { isGlobalEnabled: boolean } }) => boolean
    toolbarLeading?: ReactNode
  }) => {
    resourceCatalogViewMock(props)
    const resources = [
      { type: 'skill' as const, name: 'Enabled skill', raw: { isGlobalEnabled: true } },
      { type: 'skill' as const, name: 'Disabled skill', raw: { isGlobalEnabled: false } }
    ].filter((resource) => props.resourceFilter?.(resource) ?? true)

    return (
      <div data-testid="resource-catalog">
        {props.toolbarLeading}
        {resources.map((resource) => (
          <div key={resource.name}>{resource.name}</div>
        ))}
      </div>
    )
  }
}))

describe('SkillsSettings', () => {
  beforeEach(() => {
    persistCacheState.enabledOnly = false
    resourceCatalogViewMock.mockClear()
  })

  it('renders the global Skill catalog', () => {
    render(<SkillsSettings />)

    const resourceCatalog = screen.getByTestId('resource-catalog')
    expect(resourceCatalog).toBeInTheDocument()
    expect(resourceCatalog.parentElement?.parentElement).toHaveClass('pt-4')
    expect(resourceCatalogViewMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'skill', variant: 'settings' })
    )
    expect(resourceCatalogViewMock.mock.calls[0]?.[0]).not.toHaveProperty('description')
  })

  it('filters to globally enabled Skills and restores the filter after reopening settings', async () => {
    const user = userEvent.setup()
    const firstView = render(<SkillsSettings />)

    expect(screen.getByText('Enabled skill')).toBeInTheDocument()
    expect(screen.getByText('Disabled skill')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Enabled Skills Only' }))

    expect(screen.getByText('Enabled skill')).toBeInTheDocument()
    expect(screen.queryByText('Disabled skill')).not.toBeInTheDocument()

    firstView.unmount()
    render(<SkillsSettings />)

    expect(screen.getByRole('switch', { name: 'Enabled Skills Only' })).toBeChecked()
    expect(screen.queryByText('Disabled skill')).not.toBeInTheDocument()
  })
})
