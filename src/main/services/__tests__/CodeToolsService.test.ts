import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('@main/constant', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@main/utils', () => ({
  removeEnvProxy: vi.fn()
}))

vi.mock('@main/utils/ipService', () => ({
  isUserInChina: vi.fn().mockResolvedValue(false)
}))

vi.mock('@main/utils/process', () => ({
  getBinaryName: vi.fn().mockResolvedValue('bun')
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn()
}))

vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ stdout: '' }))
}))

vi.mock('semver', () => ({
  default: { coerce: vi.fn(), gte: vi.fn().mockReturnValue(false) }
}))

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn()
}))

async function loadModules() {
  const { BaseService } = await import('@main/core/lifecycle')
  const { CodeToolsService, codeToolsService } = await import('../CodeToolsService.v2')
  return { BaseService, CodeToolsService, codeToolsService }
}

describe('CodeToolsService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('should extend BaseService', async () => {
    const { BaseService, codeToolsService } = await loadModules()
    expect(codeToolsService).toBeInstanceOf(BaseService)
  })

  it('should have onInit that preloads terminals', async () => {
    const { codeToolsService } = await loadModules()
    await expect(codeToolsService._doInit()).resolves.toBeUndefined()
    expect(codeToolsService.isReady).toBe(true)
  })

  it('should clean up timers on stop', async () => {
    const { codeToolsService } = await loadModules()
    await codeToolsService._doInit()
    await expect(codeToolsService._doStop()).resolves.toBeUndefined()
    expect(codeToolsService.isStopped).toBe(true)
  })

  it('should prevent double instantiation', async () => {
    const { CodeToolsService } = await loadModules()
    // The module already created one instance (codeToolsService),
    // so creating another should throw
    expect(() => new CodeToolsService()).toThrow(/already been instantiated/)
  })
})
