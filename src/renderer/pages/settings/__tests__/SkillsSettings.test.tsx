import type { ResourceCatalogViewProps } from '@renderer/components/resourceCatalog/catalog/ResourceCatalogView'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

const resourceCatalogViewMock = vi.hoisted(() => vi.fn())
const navigateMock = vi.hoisted(() => vi.fn())
const searchMock = vi.hoisted(() => ({ id: 'skill-1' as string | undefined }))

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: (props: ResourceCatalogViewProps) => {
    resourceCatalogViewMock(props)
    const installed = [
      { name: 'System import', scope: 'system', source: 'system', sourceUrl: null },
      { name: 'Builtin skill', scope: 'builtin', source: 'builtin', sourceUrl: null },
      { name: 'Local system import', scope: 'system', source: 'local', sourceUrl: null },
      { name: 'Unknown origin', scope: 'local', source: 'local', sourceUrl: null },
      { name: 'Online import', scope: 'system', source: 'marketplace', sourceUrl: 'https://example.com/skill' }
    ]
    return (
      <>
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
  useSearch: () => searchMock,
  useNavigate: () => navigateMock
}))

describe('SkillsSettings', () => {
  it('filters the supplied catalog by physical scope rather than import provenance', async () => {
    const user = userEvent.setup()
    render(<SkillsSettings />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['全部', '系统', '内置'])
    expect(screen.getAllByRole('listitem')).toHaveLength(5)

    await user.click(screen.getByRole('tab', { name: '系统' }))
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'System import',
      'Local system import',
      'Online import'
    ])

    await user.click(screen.getByRole('tab', { name: '内置' }))
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Builtin skill'])

    await user.click(screen.getByRole('tab', { name: '全部' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('keeps the selected Skill synchronized with the route', () => {
    render(<SkillsSettings />)

    const props = resourceCatalogViewMock.mock.calls.at(-1)?.[0] as ResourceCatalogViewProps
    expect(props.selectedSkillId).toBe('skill-1')

    props.onSelectedSkillIdChange?.(undefined)
    const updateSearch = navigateMock.mock.calls.at(-1)?.[0].search as (previous: { id?: string }) => { id?: string }
    expect(updateSearch({ id: 'skill-1' })).toEqual({ id: undefined })
  })
})
