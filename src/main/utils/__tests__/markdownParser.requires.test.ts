import * as fs from 'fs'
import { resolve as resolvePath } from 'node:path'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseSkillMetadata } from '../markdownParser'

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('../fileOperations', () => ({
  getDirectorySize: vi.fn().mockResolvedValue(123)
}))

/**
 * `requires` frontmatter parsing for the skill prerequisite preflight (Agent Note:
 * skill-dependency-preflight-and-isolation, spec AC7 regression base).
 */
describe('parseSkillMetadata requires', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 42 } as fs.Stats)
  })

  function mockSkillMd(frontmatter: string) {
    vi.mocked(fs.promises.readFile).mockResolvedValue(`---\n${frontmatter}\n---\n\nBody`)
  }

  it('parses the four recognized requires fields', async () => {
    mockSkillMd('name: pdf-skill\nrequires:\n  bins: [pandoc]\n  python: ">=3.10"\n  packages:\n    pip: [pypdf==5.1.0]\n  platforms: [darwin, win32]')

    const metadata = await parseSkillMetadata(resolvePath('/abs/pdf-skill'), 'skills/pdf-skill', 'skills')

    expect(metadata.requires).toEqual({
      bins: ['pandoc'],
      python: '>=3.10',
      packages: { pip: ['pypdf==5.1.0'] },
      platforms: ['darwin', 'win32']
    })
  })

  it('leaves requires undefined when the key is absent, preserving current behavior', async () => {
    mockSkillMd('name: plain-skill\ndescription: no prerequisites')

    const metadata = await parseSkillMetadata(resolvePath('/abs/plain-skill'), 'skills/plain-skill', 'skills')

    expect(metadata.requires).toBeUndefined()
  })

  it('warns and ignores unrecognized requires fields', async () => {
    mockSkillMd('name: odd-skill\nrequires:\n  bins: [pandoc]\n  docker: true\n  requires: nested')

    const metadata = await parseSkillMetadata(resolvePath('/abs/odd-skill'), 'skills/odd-skill', 'skills')

    expect(metadata.requires).toEqual({ bins: ['pandoc'] })
    expect(mockMainLoggerService.withContext().warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognized fields'),
      expect.objectContaining({ unknownFields: expect.arrayContaining(['docker', 'requires']) })
    )
  })

  it('warns and ignores unrecognized package managers', async () => {
    mockSkillMd('name: npm-skill\nrequires:\n  packages:\n    npm: [left-pad]\n    pip: [pypdf]')

    const metadata = await parseSkillMetadata(resolvePath('/abs/npm-skill'), 'skills/npm-skill', 'skills')

    expect(metadata.requires).toEqual({ packages: { pip: ['pypdf'] } })
    expect(mockMainLoggerService.withContext().warn).toHaveBeenCalledWith(
      expect.stringContaining('package managers'),
      expect.objectContaining({ unknownManagers: ['npm'] })
    )
  })

  it('treats a requires mapping with no recognized fields as no declaration', async () => {
    mockSkillMd('name: empty-skill\nrequires:\n  docker: true')

    const metadata = await parseSkillMetadata(resolvePath('/abs/empty-skill'), 'skills/empty-skill', 'skills')

    expect(metadata.requires).toBeUndefined()
  })

  it('ignores a non-mapping requires value', async () => {
    mockSkillMd('name: scalar-skill\nrequires: pandoc')

    const metadata = await parseSkillMetadata(resolvePath('/abs/scalar-skill'), 'skills/scalar-skill', 'skills')

    expect(metadata.requires).toBeUndefined()
  })

  it('accepts a comma-separated bins string like other frontmatter lists', async () => {
    mockSkillMd('name: csv-skill\nrequires:\n  bins: pandoc, ffmpeg')

    const metadata = await parseSkillMetadata(resolvePath('/abs/csv-skill'), 'skills/csv-skill', 'skills')

    expect(metadata.requires).toEqual({ bins: ['pandoc', 'ffmpeg'] })
  })
})
