import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CustomCliValidationError,
  requireValidCustomCli,
  validateCustomCliExecutable,
  validateCustomCliPathForm
} from '../customCliExecutable'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-cli-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function writeExecutable(name: string, mode = 0o755): string {
  const filePath = path.join(tempDir, name)
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n')
  fs.chmodSync(filePath, mode)
  return filePath
}

describe('validateCustomCliPathForm', () => {
  it('rejects an empty path as missing', () => {
    expect(validateCustomCliPathForm('', 'linux')).toEqual({ ok: false, code: 'missing' })
  })

  it('rejects a relative POSIX path as missing', () => {
    expect(validateCustomCliPathForm('bin/oh-my-pi', 'linux')).toEqual({ ok: false, code: 'missing' })
  })

  it('rejects a relative Windows path as missing', () => {
    expect(validateCustomCliPathForm('tools\\oh-my-pi.exe', 'win32')).toEqual({ ok: false, code: 'missing' })
  })

  it('accepts an absolute POSIX path and normalizes it', () => {
    expect(validateCustomCliPathForm('/usr/local/bin/../bin/oh-my-pi', 'linux')).toEqual({
      ok: true,
      resolvedPath: '/usr/local/bin/oh-my-pi'
    })
  })

  it('accepts a Windows path with spaces in the executable location', () => {
    expect(validateCustomCliPathForm('C:\\Program Files\\oh-my-pi\\oh-my-pi.exe', 'win32')).toEqual({
      ok: true,
      resolvedPath: 'C:\\Program Files\\oh-my-pi\\oh-my-pi.exe'
    })
  })

  it('accepts .exe and .com on Windows, case-insensitively', () => {
    expect(validateCustomCliPathForm('C:\\tools\\pi.EXE', 'win32')).toEqual({ ok: true, resolvedPath: 'C:\\tools\\pi.EXE' })
    expect(validateCustomCliPathForm('C:\\tools\\pi.com', 'win32')).toEqual({ ok: true, resolvedPath: 'C:\\tools\\pi.com' })
  })

  it.each(['.cmd', '.bat', '.ps1', '.sh', ''])('rejects a Windows %s wrapper as unsupported_extension', (ext) => {
    const result = validateCustomCliPathForm(`C:\\tools\\pi${ext}`, 'win32')
    expect(result).toEqual({ ok: false, code: 'unsupported_extension' })
  })

  it('does not apply the Windows extension gate on POSIX', () => {
    expect(validateCustomCliPathForm('/usr/local/bin/oh-my-pi', 'linux')).toEqual({
      ok: true,
      resolvedPath: '/usr/local/bin/oh-my-pi'
    })
  })
})

describe('validateCustomCliExecutable', () => {
  it('accepts an executable regular file', () => {
    const filePath = writeExecutable('oh-my-pi')
    expect(validateCustomCliExecutable(filePath, 'linux')).toEqual({ ok: true, resolvedPath: filePath })
  })

  it('reports a missing path', () => {
    expect(validateCustomCliExecutable(path.join(tempDir, 'gone'), 'linux')).toEqual({ ok: false, code: 'missing' })
  })

  it('reports a directory as not_file', () => {
    expect(validateCustomCliExecutable(tempDir, 'linux')).toEqual({ ok: false, code: 'not_file' })
  })

  it('reports a non-executable file as not_executable', () => {
    const filePath = writeExecutable('not-runnable', 0o644)
    expect(validateCustomCliExecutable(filePath, 'linux')).toEqual({ ok: false, code: 'not_executable' })
  })

  it('reports a moved-away executable as missing on the next validation (AC4)', () => {
    const filePath = writeExecutable('oh-my-pi')
    expect(validateCustomCliExecutable(filePath, 'linux').ok).toBe(true)
    fs.rmSync(filePath)
    expect(validateCustomCliExecutable(filePath, 'linux')).toEqual({ ok: false, code: 'missing' })
  })
})

describe('requireValidCustomCli', () => {
  it('returns the resolved path and the exact stored argument vector (AC3)', () => {
    const filePath = writeExecutable('oh-my-pi')
    const args = ['--name', 'a value with spaces', 'quote "inside"', 'back\\slash', 'C:\\Program Files\\pi']
    expect(requireValidCustomCli({ executable: filePath, args }, 'linux')).toEqual({ resolvedPath: filePath, args })
  })

  it('throws a typed error carrying the code and never resolves a path', () => {
    const attempt = () => requireValidCustomCli({ executable: path.join(tempDir, 'gone'), args: [] }, 'linux')
    expect(attempt).toThrowError(CustomCliValidationError)
    try {
      attempt()
    } catch (error) {
      expect((error as CustomCliValidationError).code).toBe('missing')
      expect((error as CustomCliValidationError).executable).toContain('gone')
    }
  })
})
