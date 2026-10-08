import { createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/pages/settings/SkillsSettings', () => ({ SkillsSettings: () => null }))
vi.mock('@renderer/pages/settings/SkillDetails/SkillDetails', () => ({ SkillDetails: () => null }))

import { Route as SkillDetailsRoute } from '../skills.$skillId'
import { Route as SkillsIndexRoute } from '../skills.index'

describe.each([
  { name: 'list', path: '/settings/skills', validateSearch: SkillsIndexRoute.options.validateSearch },
  { name: 'detail', path: '/settings/skills/skill-1', validateSearch: SkillDetailsRoute.options.validateSearch }
])('skill $name route search', ({ path, validateSearch }) => {
  async function readSearch(query: string) {
    const root = createRootRoute()
    const route = createRoute({ getParentRoute: () => root, path, validateSearch })
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: [`${path}${query}`] })
    })
    await router.load()
    return router.state.matches.at(-1)?.search
  }

  it.each(['invalid', '42', '%5B%5D'])('falls back to all for an invalid scope: %s', async (scope) => {
    expect(await readSearch(`?scope=${scope}`)).toMatchObject({ scope: 'all' })
  })

  it.each(['all', 'system', 'builtin'])('preserves the selected scope: %s', async (scope) => {
    expect(await readSearch(`?scope=${scope}`)).toMatchObject({ scope })
  })
})
