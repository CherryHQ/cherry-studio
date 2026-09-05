import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.skills.enabledOnly': 'Enabled Skills Only',
        'settings.skills.title': 'Skills'
      })[key] ?? key
  })
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: {
    resourceType: string
    resourceFilter?: (resource: ResourceItem) => boolean
    toolbarLeading?: ReactNode
  }) => {
    resourceCatalogViewMock(props)
    return <div data-testid="resource-catalog">{props.toolbarLeading}</div>
  }
}))

function createSkillResource(isGlobalEnabled: boolean): Extract<ResourceItem, { type: 'skill' }> {
  return {
    id: isGlobalEnabled ? 'enabled-skill' : 'disabled-skill',
    type: 'skill',
    name: isGlobalEnabled ? 'Enabled skill' : 'Disabled skill',
    description: '',
    avatar: 'S',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    raw: {
      id: isGlobalEnabled ? 'enabled-skill' : 'disabled-skill',
      name: isGlobalEnabled ? 'Enabled skill' : 'Disabled skill',
      description: '',
      folderName: 'skill',
      source: 'local',
      sourceUrl: null,
      namespace: null,
      author: null,
      version: null,
      sourceTags: [],
      contentHash: 'hash',
      isGlobalEnabled,
      isEnabled: isGlobalEnabled,
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z'
    }
  }
}

describe('SkillsSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
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

  it('stores the enabled-only preference and restores it after reopening settings', async () => {
    const user = userEvent.setup()
    const firstView = render(<SkillsSettings />)

    await user.click(screen.getByRole('switch', { name: 'Enabled Skills Only' }))

    expect(MockUseCacheUtils.getPersistCacheValue('settings.skills.enabled_only')).toBe(true)

    firstView.unmount()
    render(<SkillsSettings />)

    expect(screen.getByRole('switch', { name: 'Enabled Skills Only' })).toBeChecked()
  })

  it('keeps globally enabled Skills when the enabled-only filter is active', () => {
    MockUseCacheUtils.setPersistCacheValue('settings.skills.enabled_only', true)
    render(<SkillsSettings />)

    const filter = resourceCatalogViewMock.mock.calls[0]?.[0].resourceFilter
    expect(filter(createSkillResource(true))).toBe(true)
    expect(filter(createSkillResource(false))).toBe(false)
  })
})
