import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pushSkillsToHome } from '../pushSkills'

/**
 * Real temp filesystem, not a mocked `node:fs`: the property under test is that nothing is
 * written to the home directory when the full pack is present. Asserting that against a mock
 * would assert the mock was not called, which is not the same claim.
 */

let home: string
let skillSource: string

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

/** Marks `home` as a machine with the full Prometheus pack installed. */
async function installFullPackMarker(): Promise<void> {
  await fs.mkdir(path.join(home, '.claude', 'skills', 'kbd-process-orchestrator'), { recursive: true })
}

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'push-test-'))
  home = path.join(base, 'home')
  skillSource = path.join(base, 'skills')
  await fs.mkdir(home, { recursive: true })
  await fs.mkdir(path.join(skillSource, 'a-skill'), { recursive: true })
  await fs.writeFile(path.join(skillSource, 'a-skill', 'SKILL.md'), '# A\n')
  await fs.mkdir(path.join(skillSource, 'b-skill'), { recursive: true })
  await fs.writeFile(path.join(skillSource, 'b-skill', 'SKILL.md'), '# B\n')

  const { application } = await import('@application')
  vi.mocked(application.getPath).mockImplementation((key: string) => {
    if (key === 'sys.home') return home
    if (key === 'feature.agents.skills.builtin') return skillSource
    return `/mock/${key}`
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('pushSkillsToHome', () => {
  it('copies every skill into both home skill roots', async () => {
    const state = await pushSkillsToHome()

    expect(state.status).toBe('done')
    expect(state.count).toBe(2)
    for (const root of ['.agents', '.claude']) {
      await expect(fs.readFile(path.join(home, root, 'skills', 'a-skill', 'SKILL.md'), 'utf8')).resolves.toBe('# A\n')
      await expect(fs.readFile(path.join(home, root, 'skills', 'b-skill', 'SKILL.md'), 'utf8')).resolves.toBe('# B\n')
    }
  })

  it('replaces a stale copy from an earlier app version', async () => {
    const target = path.join(home, '.agents', 'skills', 'a-skill')
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'SKILL.md'), 'STALE\n')

    await pushSkillsToHome()

    await expect(fs.readFile(path.join(target, 'SKILL.md'), 'utf8')).resolves.toBe('# A\n')
  })

  it('removes a file the pack no longer ships', async () => {
    const target = path.join(home, '.claude', 'skills', 'a-skill')
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'removed-upstream.md'), 'old\n')

    await pushSkillsToHome()

    await expect(fs.access(path.join(target, 'removed-upstream.md'))).rejects.toThrow()
  })

  it('writes NOTHING when the full pack is detected', async () => {
    await installFullPackMarker()

    const state = await pushSkillsToHome()

    expect(state.status).toBe('refused')
    // The decisive assertion: the app must not copy its own skills over the full pack's.
    await expect(fs.access(path.join(home, '.agents', 'skills', 'a-skill'))).rejects.toThrow()
    await expect(fs.access(path.join(home, '.claude', 'skills', 'a-skill'))).rejects.toThrow()
  })

  it('names the markers that caused a refusal, so it is auditable rather than mysterious', async () => {
    await installFullPackMarker()

    const state = await pushSkillsToHome()

    expect(state.markers?.length).toBeGreaterThan(0)
    expect(state.markers?.join('\n')).toContain('kbd-process-orchestrator')
  })

  it('never creates a symlink', async () => {
    await pushSkillsToHome()

    const entry = await fs.lstat(path.join(home, '.agents', 'skills', 'a-skill'))
    expect(entry.isSymbolicLink()).toBe(false)
    const file = await fs.lstat(path.join(home, '.agents', 'skills', 'a-skill', 'SKILL.md'))
    expect(file.isSymbolicLink()).toBe(false)
  })

  it('reports a failure rather than throwing when the source is missing', async () => {
    await fs.rm(skillSource, { recursive: true, force: true })

    const state = await pushSkillsToHome()

    expect(state.status).toBe('failed')
  })

  it('fails closed when the home directory cannot be read', async () => {
    await fs.rm(home, { recursive: true, force: true })

    // Reporting "no full pack" for an unreadable home would let the push write into a machine
    // it must never touch. Refusing to decide is the safe direction.
    await expect(pushSkillsToHome()).rejects.toThrow(/not a readable directory/)
  })
})
