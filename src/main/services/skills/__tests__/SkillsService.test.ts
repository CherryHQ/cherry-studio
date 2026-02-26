import * as crypto from 'node:crypto'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const getSkillsService = async () => {
  // 避免其它测试文件对 node:fs 的全局 mock 影响本测试
  vi.unmock('node:fs')
  vi.unmock('fs')
  vi.resetModules()
  const mod = await import('../SkillsService')
  return mod.SkillsService
}

const getFs = async () => (await vi.importActual('node:fs')) as any

const makeTempDir = async (prefix: string) => {
  const fs = await getFs()
  const base = process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp'
  const dirPath = path.join(base, `${prefix}${crypto.randomUUID()}`)
  await fs.promises.mkdir(dirPath, { recursive: true })
  return dirPath
}

const writeFile = async (filePath: string, content: string) => {
  const fs = await getFs()
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, content, 'utf-8')
}

const removeDir = async (dirPath: string) => {
  const fs = await getFs()
  const promisesAny = fs.promises as unknown as Record<string, unknown>
  const rm = promisesAny.rm as
    | undefined
    | ((p: string, options: { recursive: boolean; force: boolean }) => Promise<void>)
  if (typeof rm === 'function') {
    await rm(dirPath, { recursive: true, force: true })
    return
  }

  const rmdir = promisesAny.rmdir as undefined | ((p: string, options: { recursive: boolean }) => Promise<void>)
  if (typeof rmdir === 'function') {
    try {
      await rmdir(dirPath, { recursive: true })
    } catch {
      // ignore
    }
    return
  }

  const rmSync = (fs as unknown as Record<string, unknown>).rmSync as
    | undefined
    | ((p: string, options: { recursive: boolean; force: boolean }) => void)
  if (typeof rmSync === 'function') {
    try {
      rmSync(dirPath, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

describe('SkillsService', () => {
  const createdDirs: string[] = []

  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop()
      if (dir) {
        await removeDir(dir)
      }
    }
  })

  it('scans library, imports, and reads skill body without frontmatter', async () => {
    const SkillsService = await getSkillsService()
    const userData = await makeTempDir('cherry-skills-userData-')
    const library = await makeTempDir('cherry-skills-library-')
    createdDirs.push(userData, library)

    const skillDir = path.join(library, 'my-skill')
    const skillMd = path.join(skillDir, 'SKILL.md')
    await writeFile(skillMd, `---\nname: My Skill\ndescription: Demo\n---\n\n这里是技能正文\n第二行\n`)

    const service = SkillsService.create({ userDataPath: userData })

    const libraryList = await service.listLibrary(library)
    expect(libraryList).toHaveLength(1)
    expect(libraryList[0].folderName).toBe('my-skill')
    expect(libraryList[0].metadata.name).toBe('My Skill')

    const installed = await service.importFromLibrary({ libraryPath: library, skillFolderPath: skillDir })
    expect(installed.folderName).toBe('my-skill')

    const installedList = await service.listInstalled()
    expect(installedList).toHaveLength(1)
    expect(installedList[0].folderName).toBe('my-skill')

    const body = await service.readBody('my-skill')
    expect(body).toBe('这里是技能正文\n第二行')
  })

  it('overwrites on re-import and keeps updated body', async () => {
    const SkillsService = await getSkillsService()
    const userData = await makeTempDir('cherry-skills-userData-')
    const library = await makeTempDir('cherry-skills-library-')
    createdDirs.push(userData, library)

    const skillDir = path.join(library, 'my-skill')
    const skillMd = path.join(skillDir, 'SKILL.md')

    await writeFile(skillMd, `---\nname: My Skill\n---\n\nv1\n`)

    const service = SkillsService.create({ userDataPath: userData })
    await service.importFromLibrary({ libraryPath: library, skillFolderPath: skillDir })
    expect(await service.readBody('my-skill')).toBe('v1')

    await writeFile(skillMd, `---\nname: My Skill\n---\n\nv2\n`)
    await service.importFromLibrary({ libraryPath: library, skillFolderPath: skillDir })
    expect(await service.readBody('my-skill')).toBe('v2')
  })

  it('rejects importing a skill outside the library path', async () => {
    const SkillsService = await getSkillsService()
    const userData = await makeTempDir('cherry-skills-userData-')
    const library = await makeTempDir('cherry-skills-library-')
    const outside = await makeTempDir('cherry-skills-outside-')
    createdDirs.push(userData, library, outside)

    const skillDir = path.join(outside, 'bad-skill')
    await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: Bad\n---\n\nx\n`)

    const service = SkillsService.create({ userDataPath: userData })

    await expect(service.importFromLibrary({ libraryPath: library, skillFolderPath: skillDir })).rejects.toMatchObject({
      type: 'INVALID_METADATA'
    })
  })
})
