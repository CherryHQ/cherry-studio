import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCatalogViewProps } from '@renderer/components/resourceCatalog/catalog/ResourceCatalogView'
import type { ResourceItem } from '@renderer/types/resourceCatalog'

import { SkillsSettings } from '../SkillsSettings'

const { launchSkillMock, navigateMock, resourceCatalogViewMock, routerState } = vi.hoisted(() => ({
  launchSkillMock: vi.fn(),
  navigateMock: vi.fn(),
  resourceCatalogViewMock: vi.fn(),
  routerState: { search: {} }
}))

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

vi.mock('@renderer/hooks/useSkillLauncher', () => ({
  useSkillLauncher: () => launchSkillMock
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
            return props.filterResource?.(resource) && <li key={skill.name}>{skill.name}</li>
          })}
        </ul>
      </>
    )
  }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => routerState.search
}))

describe('SkillsSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    routerState.search = {}
    navigateMock.mockImplementation(
      (options: {
        search?: Record<string, unknown> | ((previous: Record<string, unknown>) => Record<string, unknown>)
      }) => {
        if (typeof options.search === 'function') routerState.search = options.search(routerState.search)
        else if (options.search) routerState.search = options.search
      }
    )
  })

  it('filters the supplied catalog by physical scope and round-trips the tab through the route search', async () => {
    const user = userEvent.setup()
    const view = render(<SkillsSettings />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['全部', '系统', '内置'])
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    await user.click(screen.getByRole('tab', { name: '系统' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/skills', search: { scope: 'system' } })
    view.rerender(<SkillsSettings />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Local system import',
      'Online import'
    ])
    expect(screen.getByRole('tab', { name: '系统' })).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('tab', { name: '内置' }))
    expect(navigateMock).toHaveBeenLastCalledWith({ to: '/settings/skills', search: { scope: 'builtin' } })
    view.rerender(<SkillsSettings />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Builtin skill'])

    await user.click(screen.getByRole('tab', { name: '全部' }))
    expect(navigateMock).toHaveBeenLastCalledWith({ to: '/settings/skills', search: { scope: 'all' } })
    view.rerender(<SkillsSettings />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('restores the active tab from the route search and carries it into the detail route', () => {
    routerState.search = { scope: 'system' }
    render(<SkillsSettings />)

    expect(screen.getByRole('tab', { name: '系统' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Local system import',
      'Online import'
    ])

    const props = resourceCatalogViewMock.mock.calls.at(-1)?.[0] as ResourceCatalogViewProps
    expect(props.onLaunchSkill).toBe(launchSkillMock)
    expect(props.allowColumnToggle).toBe(true)

    props.onOpenSkill?.({ id: 'skill-1' } as Parameters<NonNullable<ResourceCatalogViewProps['onOpenSkill']>>[0])
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/skills/$skillId',
      params: { skillId: 'skill-1' },
      search: { scope: 'system' }
    })
  })

  it('opens the dedicated Skill route and exposes the shared launch action', () => {
    render(<SkillsSettings />)

    const props = resourceCatalogViewMock.mock.calls.at(-1)?.[0] as ResourceCatalogViewProps
    expect(props.onLaunchSkill).toBe(launchSkillMock)
    expect(props.allowColumnToggle).toBe(true)

    props.onOpenSkill?.({ id: 'skill-1' } as Parameters<NonNullable<ResourceCatalogViewProps['onOpenSkill']>>[0])
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/skills/$skillId',
      params: { skillId: 'skill-1' },
      search: { scope: 'all' }
    })
  })

  it('stores the enabled-only preference and restores it after reopening settings', async () => {
    const user = userEvent.setup()
    const firstView = render(<SkillsSettings />)

    await user.click(screen.getByRole('switch', { name: '仅显示已开启技能' }))

    expect(MockUseCacheUtils.getPersistCacheValue('settings.skills.enabled_only')).toBe(true)

    firstView.unmount()
    render(<SkillsSettings />)

    expect(screen.getByRole('switch', { name: '仅显示已开启技能' })).toBeChecked()
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
