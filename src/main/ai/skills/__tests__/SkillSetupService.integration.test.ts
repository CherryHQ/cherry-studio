import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', row: undefined as any }))
vi.mock('@application', () => ({
  application: { getPath: (key: string) => path.join(fixture.root, key.endsWith('.setup') ? 'environments' : 'skills') }
}))
vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: {
    getById: () => fixture.row,
    update: (_id: string, patch: object) => Object.assign(fixture.row, patch),
    notifySkillProjectionChange: vi.fn()
  }
}))
vi.mock('@main/utils/commandResolver', () => ({
  findExecutableInEnv: async (name: string) => (name === 'python3' ? '/usr/bin/python3' : null)
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: async () => ({
    ...process.env,
    PIP_TARGET: path.join(fixture.root, 'task'),
    PYTHONPATH: path.join(fixture.root, 'task')
  })
}))

import { SkillSetupService } from '../SkillSetupService'

afterEach(async () => {
  if (fixture.root) await rm(fixture.root, { recursive: true, force: true })
})

describe.skipIf(process.platform !== 'linux')('approved setup main-process integration', () => {
  it('runs the exact approved venv and pip commands under app storage, keeps task cwd empty, persists readiness and logs', async () => {
    fixture.root = await mkdtemp(path.join(os.tmpdir(), 'skill-setup-integration-'))
    const directory = path.join(fixture.root, 'skills', 'example')
    await mkdir(directory, { recursive: true })
    await mkdir(path.join(fixture.root, 'task'))
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: example\nrequires:\n  python: ">=3.10"\n  packages:\n    pip: [pip]\n---\nTest only\n'
    )
    fixture.row = { id: 'skill-1', folderName: 'example' }
    const service = new SkillSetupService()
    expect((await service.preflight('skill-1')).state).toBe('setup_required')
    expect(await readdir(fixture.root)).not.toContain('environments')
    const plan = await service.prepare('skill-1')
    expect(await readdir(fixture.root)).not.toContain('environments')
    // pip is bundled by venv, so this checks the real installer without downloading a package.
    const result = await service.approve('skill-1', plan.approvalId)
    expect(result.state, result.error).toBe('ready')
    const log = await readFile(result.logPath!, 'utf8')
    for (const command of plan.commands) expect(log).toContain(JSON.stringify(command))
    expect(log).toContain('Requirement already satisfied: pip')
    expect(await readdir(path.join(fixture.root, 'task'))).toEqual([])
    expect(await readdir(plan.directory)).toEqual(expect.arrayContaining(['venv', 'tmp', 'setup.log']))
    expect((await service.assertReady('skill-1')).state).toBe('ready')
    expect(fixture.row.readiness.pythonPath).toBe(result.pythonPath)
    await expect(service.approve('skill-1', plan.approvalId)).rejects.toThrow('expired')
  }, 40_000)
})
