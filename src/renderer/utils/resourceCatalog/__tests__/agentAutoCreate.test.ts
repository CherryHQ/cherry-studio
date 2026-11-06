import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillSearchResult } from '@shared/types/skill'

const { mockFetchGenerate, mockSearchSkills } = vi.hoisted(() => ({
  mockFetchGenerate: vi.fn(),
  mockSearchSkills: vi.fn()
}))

vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate: mockFetchGenerate }))
vi.mock('@renderer/utils/skillSearch', () => ({ searchSkills: mockSearchSkills }))

import { parseJsonArray, recommendMarketplaceSkills } from '../agentAutoCreate'

function result(name: string, downloads: number): SkillSearchResult {
  return {
    slug: name,
    name,
    description: `${name} skill`,
    author: null,
    stars: 0,
    downloads,
    sourceRegistry: 'skills.sh',
    sourceUrl: null,
    installSource: `skills.sh:${name}`
  }
}

const AGENT = { name: 'Slide Expert', purpose: 'Turn meeting notes into slides', installedNames: [] }

/** Reply to the query call, then to the pick call. */
function replies(queries: string, picks: string) {
  mockFetchGenerate.mockResolvedValueOnce(queries).mockResolvedValueOnce(picks)
}

beforeEach(() => {
  mockFetchGenerate.mockReset()
  mockSearchSkills.mockReset()
})

describe('parseJsonArray', () => {
  it('reads the array out of a chatty reply and ignores anything that is not an array', () => {
    expect(parseJsonArray('Sure! ["pptx", "slides"] should work.')).toEqual(['pptx', 'slides'])
    expect(parseJsonArray('{"queries": "pptx"}')).toEqual([])
    expect(parseJsonArray('[pptx, slides]')).toEqual([])
    expect(parseJsonArray('')).toEqual([])
  })
})

describe('recommendMarketplaceSkills', () => {
  it('returns at most two of the skills the model picks, by their list position', async () => {
    mockSearchSkills.mockResolvedValue([result('pptx', 900), result('slide-design', 500), result('charts', 100)])
    replies('["pptx"]', '[1, 2, 3]')

    const picked = await recommendMarketplaceSkills(AGENT)

    expect(picked.map((skill) => skill.name)).toEqual(['pptx', 'slide-design'])
  })

  it('never suggests a skill whose name is already installed', async () => {
    mockSearchSkills.mockResolvedValue([result('PPTX', 900), result('slide-design', 500)])
    replies('["pptx"]', '[1, 2]')

    const picked = await recommendMarketplaceSkills({ ...AGENT, installedNames: ['pptx'] })

    expect(picked.map((skill) => skill.name)).toEqual(['slide-design'])
  })

  it('merges results across queries and keeps going when one search fails', async () => {
    mockSearchSkills.mockRejectedValueOnce(new Error('registry down')).mockResolvedValueOnce([result('pdf', 10)])
    replies('["pptx", "pdf"]', '[1]')

    const picked = await recommendMarketplaceSkills(AGENT)

    expect(mockSearchSkills).toHaveBeenCalledTimes(2)
    expect(picked.map((skill) => skill.name)).toEqual(['pdf'])
  })

  it('installs nothing when the model returns no usable queries or picks', async () => {
    mockFetchGenerate.mockRejectedValueOnce(new Error('model unavailable'))
    expect(await recommendMarketplaceSkills(AGENT)).toEqual([])
    expect(mockSearchSkills).not.toHaveBeenCalled()

    mockSearchSkills.mockResolvedValue([result('pptx', 900)])
    replies('["pptx"]', 'None of these fit.')
    expect(await recommendMarketplaceSkills(AGENT)).toEqual([])

    replies('["pptx"]', '[7, "1"]')
    expect(await recommendMarketplaceSkills(AGENT)).toEqual([])
  })

  it('rethrows when the caller cancels', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetchGenerate.mockRejectedValue(new DOMException('cancelled', 'AbortError'))

    await expect(recommendMarketplaceSkills({ ...AGENT, signal: controller.signal })).rejects.toThrow()
  })
})
