import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  notify: vi.fn(),
  inspect: vi.fn(),
  spawn: vi.fn(),
  kill: vi.fn(),
  mkdir: vi.fn(),
  appendFile: vi.fn()
}))
vi.mock('@application', () => ({
  application: { getPath: (key: string) => (key.endsWith('.setup') ? '/app/SkillEnvironments' : '/app/Skills') }
}))
vi.mock('@data/services/AgentGlobalSkillService', () => ({
  agentGlobalSkillService: { getById: mocks.getById, update: mocks.update, notifySkillProjectionChange: mocks.notify }
}))
vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir, appendFile: mocks.appendFile }))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: async () => ({
    PATH: '/bin',
    PYTHONPATH: '/task',
    PIP_TARGET: '/task',
    VIRTUAL_ENV: '/task',
    KEEP: 'yes'
  })
}))
vi.mock('@main/utils/processRunner', () => ({
  crossPlatformSpawn: mocks.spawn,
  killProcessTree: mocks.kill,
  terminateProcessTree: mocks.kill
}))
vi.mock('../skillEnvironment', () => ({
  inspectSkillEnvironment: mocks.inspect,
  validateSetupRequirements: (requires: { packages?: { pip?: string[] } }) => requires?.packages?.pip ?? [],
  managedSkillPython: (directory: string) => `${directory}/venv/bin/python`
}))

import { SkillSetupService } from '../SkillSetupService'

function inspection(overrides = {}) {
  return {
    requires: { packages: { pip: ['pypdf==5.1.0'] } },
    state: 'setup_required',
    missing: ['pip pypdf==5.1.0'],
    fingerprint: 'before',
    snapshot: { python: { path: '/bin/python3', version: '3.12.0' }, skillContentHash: 'skill-content' },
    ...overrides
  }
}
let row: any
beforeEach(() => {
  vi.clearAllMocks()
  row = { id: 'skill-1', folderName: 'example' }
  mocks.getById.mockImplementation((id) => (id === row?.id ? row : null))
  mocks.update.mockImplementation((_id, patch) => Object.assign(row, patch))
  mocks.inspect.mockImplementation(async (_directory, environment) =>
    inspection(environment ? { state: 'ready', missing: [], fingerprint: 'after' } : {})
  )
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.appendFile.mockResolvedValue(undefined)
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 1000 })
    queueMicrotask(() => child.emit('close', 0))
    return child
  })
})
afterEach(() => vi.useRealTimers())

describe('SkillSetupService approval and process boundary', () => {
  it('preflights and persists missing requirements without starting any process or creating setup folders', async () => {
    const service = new SkillSetupService()
    expect((await service.preflight(row.id)).state).toBe('setup_required')
    await expect(service.assertReady(row.id)).rejects.toThrow('pypdf==5.1.0')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith(row.id)
  })
  it('shows exact commands before approval, runs only once in a fresh app-owned directory, and strips setup env', async () => {
    const service = new SkillSetupService()
    const plan = await service.prepare(row.id)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(plan.packages).toEqual(['pypdf==5.1.0'])
    expect(plan.directory).toMatch(/^\/app\/SkillEnvironments\/[^/]+\/[^/]+$/)
    expect((await service.approve(row.id, plan.approvalId)).state).toBe('ready')
    expect(mocks.spawn).toHaveBeenCalledTimes(plan.commands.length)
    for (const [index, call] of mocks.spawn.mock.calls.entries()) {
      expect(call[0]).toBe(plan.commands[index].executable)
      expect(call[1]).toEqual(plan.commands[index].args)
      expect(call[2]).toMatchObject({ cwd: plan.directory, detached: true, env: { PATH: '/bin', KEEP: 'yes' } })
      expect(call[2].env).not.toHaveProperty('PIP_TARGET')
      expect(call[2].env).not.toHaveProperty('PYTHONPATH')
      expect(call[2].env.TMPDIR).toBe(`${plan.directory}/tmp`)
    }
    await expect(service.approve(row.id, plan.approvalId)).rejects.toThrow('expired')
  })
  it('binds approval to the exact skill, expires it, and rejects changed content or dependencies', async () => {
    const service = new SkillSetupService()
    const plan = await service.prepare(row.id)
    await expect(service.approve('another', plan.approvalId)).rejects.toThrow('expired')
    mocks.inspect.mockResolvedValueOnce(inspection({ fingerprint: 'changed' }))
    await expect(service.approve(row.id, plan.approvalId)).rejects.toThrow('changed')
    const next = await service.prepare(row.id)
    vi.spyOn(Date, 'now').mockReturnValueOnce(Date.parse(next.expiresAt) + 1)
    await expect(service.approve(row.id, next.approvalId)).rejects.toThrow('expired')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('records failure with package and log, never silently retries, and creates a new plan for retry', async () => {
    const service = new SkillSetupService()
    mocks.spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
      queueMicrotask(() => child.emit('close', 1))
      return child
    })
    const plan = await service.prepare(row.id)
    const result = await service.approve(row.id, plan.approvalId)
    expect(result).toMatchObject({
      state: 'failed',
      missing: ['pip pypdf==5.1.0'],
      logPath: `${plan.directory}/setup.log`
    })
    expect((await service.preflight(row.id)).state).toBe('failed')
    const retry = await service.prepare(row.id)
    expect(retry.approvalId).not.toBe(plan.approvalId)
    expect(retry.directory).not.toBe(plan.directory)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'timeout'] as const)(
    'terminates a running process on %s and keeps failed state plus logs',
    async (mode) => {
      vi.useFakeTimers()
      let child: EventEmitter
      mocks.spawn.mockImplementation(() => {
        child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 1000 })
        return child
      })
      mocks.kill.mockImplementation(async () => {
        queueMicrotask(() => child.emit('close', null))
      })
      const service = new SkillSetupService(),
        plan = await service.prepare(row.id)
      const running = service.approve(row.id, plan.approvalId)
      await vi.advanceTimersByTimeAsync(0)
      expect(row.readiness.state).toBe('setting_up')
      await expect(service.assertReady(row.id)).rejects.toThrow('setup required')
      if (mode === 'cancel') service.cancel(row.id)
      else await vi.advanceTimersByTimeAsync(300_000)
      const result = await running
      expect(result.state).toBe('failed')
      expect(result.error).toMatch(mode === 'cancel' ? /cancelled/ : /timed out/)
      expect(result.logPath).toBe(`${plan.directory}/setup.log`)
      expect(mocks.kill).toHaveBeenCalled()
      expect((await service.preflight(row.id)).state).toBe('failed')
    }
  )
  it('refuses to mark setup ready if the skill changes during installation', async () => {
    const service = new SkillSetupService(),
      plan = await service.prepare(row.id)
    mocks.inspect
      .mockResolvedValueOnce(inspection())
      .mockResolvedValueOnce(inspection({ state: 'ready', missing: [], snapshot: { skillContentHash: 'changed' } }))
    expect((await service.approve(row.id, plan.approvalId)).error).toMatch(/changed during setup/)
  })
  it('honors cancellation while approval validation is still in flight', async () => {
    const service = new SkillSetupService(),
      plan = await service.prepare(row.id)
    let finishInspection!: (value: ReturnType<typeof inspection>) => void
    mocks.inspect.mockReturnValueOnce(
      new Promise((resolve) => {
        finishInspection = resolve
      })
    )
    const running = service.approve(row.id, plan.approvalId)
    service.cancel(row.id)
    finishInspection(inspection())
    const result = await running
    expect(result).toMatchObject({ state: 'failed', error: 'Setup cancelled' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('converts an interrupted persisted run to failed without rerunning it', async () => {
    row.readiness = { state: 'setting_up', logPath: '/app/old.log' }
    const result = await new SkillSetupService().preflight(row.id)
    expect(result).toMatchObject({ state: 'failed', logPath: '/app/old.log' })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('keeps skills without declarations ready and forbids installer flags when preparing a plan', async () => {
    mocks.inspect.mockResolvedValue(inspection({ requires: undefined, state: 'ready', missing: [] }))
    row.readiness = { state: 'failed' }
    const service = new SkillSetupService()
    expect((await service.preflight(row.id)).state).toBe('ready')
    await expect(service.prepare(row.id)).rejects.toThrow('manual setup')
  })
})
