import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@main/ai/skills/SkillService', () => ({ skillService: { list: mocks.list } }))

const { buildSkillCatalogSection, resolveEnabledSkillCatalog } = await import('./skillCatalog')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveEnabledSkillCatalog', () => {
  it('returns only enabled skills, reduced to catalog metadata', async () => {
    mocks.list.mockResolvedValue([
      { name: 'PDF', description: 'Extract PDFs', folderName: 'pdf', isEnabled: true, contentHash: 'h1' },
      { name: 'Off', description: null, folderName: 'off', isEnabled: false, contentHash: 'h2' }
    ])

    const catalog = await resolveEnabledSkillCatalog('agent-1')

    expect(mocks.list).toHaveBeenCalledWith({ agentId: 'agent-1' })
    expect(catalog).toEqual([{ name: 'PDF', description: 'Extract PDFs', folderName: 'pdf' }])
  })
})

describe('buildSkillCatalogSection', () => {
  it('returns undefined for an empty catalog', () => {
    expect(buildSkillCatalogSection([])).toBeUndefined()
  })

  it('lists each skill and points the model at the skill tool', () => {
    const section = buildSkillCatalogSection([
      { name: 'PDF', description: 'Extract PDFs', folderName: 'pdf' },
      { name: 'Bare', description: null, folderName: 'bare' }
    ])

    expect(section).toContain('- PDF: Extract PDFs')
    expect(section).toContain('- Bare')
    expect(section).toContain('`skill` tool')
  })
})
