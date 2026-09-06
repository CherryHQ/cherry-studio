import type { ResourceCatalogViewProps } from '@renderer/components/resourceCatalog/catalog/ResourceCatalogView'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SkillsSettings } from '../SkillsSettings'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

vi.mock('@renderer/components/resourceCatalog/catalog', () => ({
  ResourceCatalogView: ({ toolbarFooter, filterResource }: ResourceCatalogViewProps) => {
    const installed = [
      { name: 'System import', scope: 'system', source: 'system', sourceUrl: null },
      { name: 'Builtin skill', scope: 'builtin', source: 'builtin', sourceUrl: null },
      { name: 'Local system import', scope: 'system', source: 'local', sourceUrl: null },
      { name: 'Unknown origin', scope: 'local', source: 'local', sourceUrl: null },
      { name: 'Online import', scope: 'system', source: 'marketplace', sourceUrl: 'https://example.com/skill' }
    ]
    return (
      <>
        {toolbarFooter}
        <ul aria-label="Installed skills">
          {installed.map((skill) => {
            const resource = { id: skill.name, type: 'skill', raw: skill } as ResourceItem
            return filterResource?.(resource) && <li key={skill.name}>{skill.name}</li>
          })}
        </ul>
      </>
    )
  }
}))

describe('SkillsSettings source tabs', () => {
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
})
