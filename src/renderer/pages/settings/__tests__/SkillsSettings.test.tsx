import type { ResourceCatalogViewProps } from '@renderer/components/resourceCatalog/catalog/ResourceCatalogView'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.all': 'All',
        'settings.skills.enabledOnly': 'Enabled Skills Only',
        'settings.skills.tabs.builtin': 'Built in',
        'settings.skills.tabs.system': 'System',
        'settings.skills.title': 'Skills'
      })[key] ?? key
  })
}))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: ResourceCatalogViewProps) => {
    resourceCatalogViewMock(props)
    const installed = [
      { isGlobalEnabled: true, name: 'System import', scope: 'system', source: 'system', sourceUrl: null },
      { isGlobalEnabled: true, name: 'Builtin skill', scope: 'builtin', source: 'builtin', sourceUrl: null },
      { isGlobalEnabled: false, name: 'Local system import', scope: 'system', source: 'local', sourceUrl: null },
      { isGlobalEnabled: false, name: 'Unknown origin', scope: 'local', source: 'local', sourceUrl: null },
      {
        isGlobalEnabled: true,
        name: 'Online import',
        scope: 'system',
        source: 'marketplace',
        sourceUrl: 'https://example.com/skill'
      }
    ]
    return (
      <>
        {props.toolbarLeading}
        {props.toolbarFooter}
        <ul aria-label="Installed skills">
          {installed.map((skill) => {
            const resource = { id: skill.name, type: 'skill', raw: skill } as ResourceItem
            return (!props.filterResource || props.filterResource(resource)) && <li key={skill.name}>{skill.name}</li>
          })}
        </ul>
      </>
    )
  }
}))

describe('SkillsSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    resourceCatalogViewMock.mockClear()
  })

  it('filters the supplied catalog by physical scope rather than import provenance', async () => {
    const user = userEvent.setup()
    render(<SkillsSettings />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All', 'System', 'Built in'])
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    await user.click(screen.getByRole('tab', { name: 'System' }))
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Local system import',
      'Online import'
    ])

    await user.click(screen.getByRole('tab', { name: 'Built in' }))
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Builtin skill'])

    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
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

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Builtin skill',
      'Online import'
    ])
  })
})
