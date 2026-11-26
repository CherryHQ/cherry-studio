import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { SkillService } from '@main/ai/skills/SkillService'
import { isWin } from '@main/core/platform'

import { retargetSkillExports } from '../skillExports'

describe('skill export ownership after userData relocation', () => {
  const dbh = setupTestDatabase()
  let root: string
  let profile: string
  let exports: string
  let getPathSpy: { mockRestore(): void }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'skill-export-relocation-'))
    profile = path.join(root, 'source')
    exports = path.join(root, 'home', '.agents', 'skills')
    getPathSpy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const roots: Record<string, string> = {
        'app.userdata': profile,
        'feature.agents.skills': path.join(profile, 'Data', 'Skills'),
        'feature.agents.claude.skills': path.join(profile, 'Data', 'Agents', '.claude', 'skills'),
        'external.agents.skills': exports
      }
      const resolved = roots[key] ?? path.join(root, key)
      return filename ? path.join(resolved, filename) : resolved
    })
  })

  afterEach(async () => {
    getPathSpy.mockRestore()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('can disable and re-enable exports from the copied profile while the source profile remains', async () => {
    await application.get('PreferenceService').set('agent.skills.external_export.enabled', true)
    const id = '11111111-1111-4111-8111-111111111111'
    await dbh.db.insert(agentGlobalSkillTable).values({
      id,
      name: 'owned',
      folderName: 'owned',
      source: 'local',
      contentHash: 'hash'
    })
    const library = path.join(application.getPath('feature.agents.skills'), 'owned')
    await fs.mkdir(library, { recursive: true })
    await fs.writeFile(path.join(library, 'SKILL.md'), '# copied instructions')
    const service = new SkillService()
    await service.linkMirror('owned')
    const original = profile
    const copied = path.join(root, 'target')
    await fs.cp(original, copied, { recursive: true, dereference: true })
    await retargetSkillExports(original, copied)
    profile = copied
    await fs.writeFile(path.join(library, 'SKILL.md'), '# retained old profile')

    await expect(service.setMirrorEnabled(id, false)).resolves.toMatchObject({ mirrorEnabled: false })
    await expect(fs.lstat(path.join(exports, 'owned'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(library, 'SKILL.md'), 'utf8')).resolves.toBe('# retained old profile')
    await expect(service.setMirrorEnabled(id, true)).resolves.toMatchObject({ mirrorEnabled: true })
    await expect(fs.readFile(path.join(exports, 'owned', 'SKILL.md'), 'utf8')).resolves.toBe('# copied instructions')
    expect(agentGlobalSkillService.getById(id)?.mirrorEnabled).toBe(true)
  })
  it('removes a retargeted runtime-only builtin on reconcile while retaining profile and user entries', async () => {
    await application.get('PreferenceService').set('agent.skills.external_export.enabled', true)
    const service = new SkillService()
    const libraryRoot = application.getPath('feature.agents.skills')
    for (const name of ['cherry-browser', 'find-skills']) {
      const library = path.join(libraryRoot, name)
      await fs.mkdir(library, { recursive: true })
      await fs.writeFile(path.join(library, 'SKILL.md'), '# trusted builtin')
      agentGlobalSkillService.insert({
        name,
        folderName: name,
        source: 'builtin',
        mirrorEnabled: true,
        contentHash: await service['computeBuiltinDirectoryHash'](library)
      })
      await service.linkMirror(name)
    }
    await fs.symlink(
      path.join(application.getPath('feature.agents.claude.skills'), 'cherry-browser'),
      path.join(exports, 'cherry-browser'),
      isWin ? 'junction' : 'dir'
    )
    await fs.writeFile(path.join(exports, 'user-file'), 'keep file')
    await fs.mkdir(path.join(exports, 'user-directory'))
    await fs.writeFile(path.join(exports, 'user-directory', 'keep'), 'keep directory')
    await fs.symlink(root, path.join(exports, 'user-link'), isWin ? 'junction' : 'dir')
    const original = profile
    const copied = path.join(root, 'target')
    await fs.cp(original, copied, { recursive: true, dereference: true })
    await retargetSkillExports(original, copied)
    profile = copied
    expect(path.resolve(await fs.readlink(path.join(exports, 'cherry-browser')))).toBe(
      path.resolve(application.getPath('feature.agents.claude.skills'), 'cherry-browser')
    )
    await service.reconcileSkills()
    await expect(fs.lstat(path.join(exports, 'cherry-browser'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      await fs.readFile(
        path.join(application.getPath('feature.agents.claude.skills'), 'cherry-browser', 'SKILL.md'),
        'utf8'
      )
    ).toBe('# trusted builtin')
    const general = agentGlobalSkillService.getByFolderName('find-skills')!
    await service.setMirrorEnabled(general.id, false)
    await expect(fs.lstat(path.join(exports, 'find-skills'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.setMirrorEnabled(general.id, true)
    expect(await fs.readFile(path.join(exports, 'find-skills', 'SKILL.md'), 'utf8')).toBe('# trusted builtin')
    expect(await fs.readFile(path.join(libraryRoot, 'cherry-browser', 'SKILL.md'), 'utf8')).toBe('# trusted builtin')
    expect(await fs.readFile(path.join(exports, 'user-file'), 'utf8')).toBe('keep file')
    expect(await fs.readFile(path.join(exports, 'user-directory', 'keep'), 'utf8')).toBe('keep directory')
    expect(path.resolve(await fs.readlink(path.join(exports, 'user-link')))).toBe(path.resolve(root))
  })
})
