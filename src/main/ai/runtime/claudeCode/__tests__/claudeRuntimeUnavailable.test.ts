import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { regionService } from '@main/services/RegionService'

import { serializeError } from '../../../utils/serializeError'
import { claudeCodeBinaryManifest } from '../binaryManifest'
import { ClaudeCodeBinaryService, ClaudeCodeRuntimeUnavailableError, isInsideAppAsar } from '../ClaudeCodeBinaryService'
import {
  createClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessExitError,
  recordClaudeCodeSpawnError
} from '../processExitDiagnostics'

vi.mock('../binaryManifest', () => ({ claudeCodeBinaryManifest: { version: '1.2.3', packages: {} } }))
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina: vi.fn() } }))

let root: string
let service: ClaudeCodeBinaryService

beforeEach(async () => {
  BaseService.resetInstances()
  root = await mkdtemp(path.join(os.tmpdir(), 'claude-missing-'))
  vi.mocked(application.getPath).mockReturnValue(root)
  vi.mocked(regionService.isInChina).mockResolvedValue(false)
  service = new ClaudeCodeBinaryService()
})

afterEach(async () => {
  await service._doStop()
  await rm(root, { recursive: true, force: true })
})

describe('Claude Code missing-runtime fail-fast (#21898)', () => {
  it('refuses to start the SDK with a typed actionable error that names no filesystem path to the renderer', () => {
    let thrown: unknown
    try {
      service.requireExecutable()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ClaudeCodeRuntimeUnavailableError)
    const typed = thrown as ClaudeCodeRuntimeUnavailableError
    expect(typed.name).toBe('ClaudeCodeRuntimeUnavailableError')
    expect(typed.i18nKey).toBe('claude_code_runtime_missing')
    expect(typed.detailI18nKey).toBe('claude_code_runtime_missing_detail')
    expect(typed.executable).toContain('1.2.3')
    expect(typed.executable).not.toContain('app.asar')

    const serialized = serializeError(typed)
    expect(serialized.i18nKey).toBe('claude_code_runtime_missing')
    expect(serialized.detailI18nKey).toBe('claude_code_runtime_missing_detail')
    expect(JSON.stringify(serialized)).not.toContain(typed.executable)
  })

  it('resolves the runtime under userData, never inside the application image', () => {
    const executable = service.getExecutablePath()
    expect(executable).toContain('1.2.3')
    expect(executable).not.toContain('app.asar')
    expect(executable).not.toContain('app.asar.unpacked')
  })

  it('rejects an app.asar-resolved executable instead of handing it to the SDK', () => {
    vi.mocked(application.getPath).mockReturnValue(path.join('C:', 'Program Files', 'app.asar.unpacked', 'data'))
    BaseService.resetInstances()
    const stale = new ClaudeCodeBinaryService()
    expect(() => stale.requireExecutable()).toThrowError(ClaudeCodeRuntimeUnavailableError)
    BaseService.resetInstances()
  })

  it('matches only real app.asar path segments, not sibling directories', () => {
    expect(isInsideAppAsar(path.join('C:', 'data', 'app.asar', 'file'))).toBe(true)
    expect(isInsideAppAsar(path.join('C:', 'data', 'app.asar.unpacked', 'file'))).toBe(true)
    expect(isInsideAppAsar(path.join('C:', 'data', 'app.asar-backups', 'claude'))).toBe(false)
    expect(isInsideAppAsar(path.join('C:', 'data', 'my-app.asar-files', 'claude'))).toBe(false)
  })

  it('maps an unsupported platform to dedicated recovery copy', () => {
    claudeCodeBinaryManifest.packages = {}
    const status = service.ensure()
    expect(status).toMatchObject({ phase: 'error', error: 'unsupported' })
    try {
      service.requireExecutable()
      expect.unreachable()
    } catch (error) {
      const typed = error as ClaudeCodeRuntimeUnavailableError
      expect(typed.i18nKey).toBe('claude_code_runtime_unsupported')
      expect(typed.detailI18nKey).toBe('claude_code_runtime_unsupported_detail')
    }
  })
})

describe('Claude Code spawn-failure diagnostics (#21898)', () => {
  it('records the resolved executable and errno while keeping them out of the renderer payload', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('spawn-ref')
    diagnostics.executable = '/safe/toolchain/claude'
    const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    recordClaudeCodeSpawnError(diagnostics, spawnError)

    expect(diagnostics.spawnFailed).toBe(true)
    expect(diagnostics.spawnErrorCode).toBe('ENOENT')
    expect(diagnostics.terminalReason).toContain('/safe/toolchain/claude')
    expect(diagnostics.terminalReason).toContain('ENOENT')

    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('boom'), diagnostics))
    expect(serialized).toMatchObject({
      name: 'ClaudeCodeProcessExitError',
      message: 'Claude Code process failed to start',
      i18nKey: 'claude_code_spawn_failed',
      detailI18nKey: 'claude_code_spawn_failed_detail',
      diagnosticReference: 'spawn-ref'
    })
    expect(serialized.claudeCodeExitCategory).toBeDefined()
    expect(JSON.stringify(serialized)).not.toContain('/safe/toolchain/claude')
  })

  it('does not mark ordinary exits as spawn failures', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('exit-ref')
    diagnostics.exitCode = 1
    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('boom'), diagnostics))
    expect(serialized).not.toHaveProperty('i18nKey')
  })
})
