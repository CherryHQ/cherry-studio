import { describe, expect, it } from 'vitest'

import { searchSkillMarketplaces } from '@shared/utils/skillMarketplace'

import { loadClaudePluginsSkills } from '../skillSearch'

// Shape verified against GET /api/skills?q=pdf&limit=2&offset=0 on 2026-11-06.
const pdf = {
  id: '63d64579-47a6-4a5a-9457-ae16e08b7d1d',
  name: 'pdf',
  namespace: '@anthropics/skills/pdf',
  sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
  metadata: { repoOwner: 'anthropics', repoName: 'skills', directoryPath: 'skills/pdf' }
}

describe('claude-plugins.dev independent skills', () => {
  it('browses without a search term and advances past entries that cannot be installed', async () => {
    const page = await loadClaudePluginsSkills(
      2,
      async (url) => {
        expect(url).toBe('https://claude-plugins.dev/api/skills?limit=2&offset=2')
        return { skills: [{ ...pdf, metadata: null }, pdf], offset: 2, limit: 2, total: 5 }
      },
      2
    )
    expect(page).toMatchObject({ hasMore: true, nextOffset: 4 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      name: 'pdf',
      sourceRegistry: 'claude-plugins.dev',
      installSource: 'claude-plugins:anthropics/skills/skills/pdf'
    })
  })

  it('stops on the final page and preserves the exact skill directory in search', async () => {
    const response = { skills: [pdf], offset: 0, limit: 20, total: 1 }
    expect(await loadClaudePluginsSkills(0, async () => response)).toMatchObject({ hasMore: false, nextOffset: 1 })
    const results = await searchSkillMarketplaces(
      'pdf',
      async (url) => {
        expect(url).toBe('https://claude-plugins.dev/api/skills?q=pdf&limit=20')
        return response
      },
      undefined,
      'claude-plugins.dev'
    )
    expect(results.map((item) => item.installSource)).toEqual(['claude-plugins:anthropics/skills/skills/pdf'])
  })

  it.each([
    { skills: [pdf], offset: 1, limit: 20, total: 2 },
    { skills: [], offset: 0, limit: 20, total: 2 },
    { skills: [pdf], offset: 0, limit: 20 },
    { skills: [pdf], offset: 0, limit: 20, total: -1 }
  ])('rejects a broken pagination response instead of looping', async (response) => {
    await expect(loadClaudePluginsSkills(0, async () => response)).rejects.toThrow('pagination')
  })

  it('rejects invalid offsets before any network request', async () => {
    await expect(
      loadClaudePluginsSkills(-1, async () => {
        throw new Error('unexpected network')
      })
    ).rejects.toThrow('pagination')
  })
})
