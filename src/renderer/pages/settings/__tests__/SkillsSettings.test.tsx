import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceCatalogViewProps } from '@renderer/components/resourceCatalog/catalog/ResourceCatalogView'
import type { ResourceItem } from '@renderer/types/resourceCatalog'

import { SkillsSettings } from '../SkillsSettings'

const { launchSkillMock, navigateMock, resourceCatalogViewMock, routerState, ipcMock, toastMock } = vi.hoisted(() => ({
  ipcMock: vi.fn(),
  toastMock: vi.fn(),
  launchSkillMock: vi.fn(),
  navigateMock: vi.fn(),
  resourceCatalogViewMock: vi.fn(),
  routerState: { search: {} }
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcMock } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: toastMock } }))

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
        {props.headerActions}
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
    MockUsePreferenceUtils.resetMocks()
    ipcMock.mockReset()
    toastMock.mockReset()
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

  it('opens export controls on demand and returns keyboard focus to the entry', async () => {
    const user = userEvent.setup()
    render(<SkillsSettings />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '向外部智能体导出技能' })).not.toBeInTheDocument()
    expect(ipcMock).not.toHaveBeenCalled()
    const help = screen.getByRole('button', { name: '技能设置' })
    help.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveTextContent('~/.agents/skills')
    await user.keyboard('{Escape}')
    expect(help).toHaveFocus()
    await user.click(help)
    await user.click(screen.getByRole('button', { name: '帮助' }))
    expect(screen.getByText(/每个技能的选择仍会保留/)).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(/每个技能的选择仍会保留/)).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(help).toHaveFocus()
    expect(ipcMock).not.toHaveBeenCalled()
  })

  it('saves the export switch and retries only the failed sync', async () => {
    ipcMock.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined)
    render(<SkillsSettings />)
    await userEvent.setup().click(screen.getByRole('button', { name: '技能设置' }))
    const toggle = screen.getByRole('switch', { name: '向外部智能体导出技能' })
    expect(toggle).not.toBeChecked()
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(ipcMock).toHaveBeenCalledWith('skill.reconcile', { externalExportsOnly: true }))
    expect(MockUsePreferenceUtils.getPreferenceValue('agent.skills.external_export.enabled')).toBe(true)
    await waitFor(() => expect(toastMock).toHaveBeenCalled())
    const config = toastMock.mock.calls[0][0]
    expect(config.title).toBe('设置已保存，但目录同步失败。')
    expect(config.action.label).toBe('重试同步')
    await config.action.onClick()
    expect(ipcMock).toHaveBeenCalledTimes(2)
  })

  it('filters by physical scope and round-trips the tab through the route search', async () => {
    const user = userEvent.setup()
    const view = render(<SkillsSettings />)
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
    view.rerender(<SkillsSettings />)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Builtin skill'])

    await user.click(screen.getByRole('tab', { name: '全部' }))
    view.rerender(<SkillsSettings />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('restores the selected scope from the route search and carries it into the detail route', () => {
    routerState.search = { scope: 'system' }
    render(<SkillsSettings />)

    expect(screen.getByRole('tab', { name: '系统' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Local system import',
      'Online import'
    ])

    const props = resourceCatalogViewMock.mock.calls.at(-1)?.[0] as ResourceCatalogViewProps

    props.onOpenSkill?.({ id: 'skill-1' } as Parameters<NonNullable<ResourceCatalogViewProps['onOpenSkill']>>[0])
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/skills/$skillId',
      params: { skillId: 'skill-1' },
      search: { scope: 'system' }
    })
  })

  it('opens the dedicated Skill route', () => {
    render(<SkillsSettings />)

    const props = resourceCatalogViewMock.mock.calls.at(-1)?.[0] as ResourceCatalogViewProps

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

    await user.click(screen.getByRole('button', { name: '筛选技能' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: '仅显示已开启技能' }))

    expect(MockUseCacheUtils.getPersistCacheValue('settings.skills.enabled_only')).toBe(true)

    firstView.unmount()
    render(<SkillsSettings />)

    await user.click(screen.getByRole('button', { name: '筛选技能' }))
    expect(screen.getByRole('menuitemcheckbox', { name: '仅显示已开启技能' })).toBeChecked()
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
