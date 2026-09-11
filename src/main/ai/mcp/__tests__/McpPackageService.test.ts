import { BaseService } from '@main/core/lifecycle'
import { MAX_MCP_PACKAGE_BYTES } from '@shared/types/mcp'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { application } = await import('@application')

const {
  buildResolvedEnv,
  copyPackageWithinLimit,
  ensurePathWithin,
  McpPackageService,
  validateArgs,
  validateCommand,
  validatePackageUploadSource
} = await import('../McpPackageService')

describe('ensurePathWithin', () => {
  // Use path.join to construct cross-platform compatible paths
  const baseDir = path.join('/', 'home', 'user', 'mcp')

  describe('valid paths', () => {
    // Skip these tests on Windows as path behavior differs significantly
    const testFn = process.platform === 'win32' ? it.skip : it

    testFn('should accept direct child paths', () => {
      const target1 = path.join('/', 'home', 'user', 'mcp', 'server-test')
      const target2 = path.join('/', 'home', 'user', 'mcp', 'my-server')
      expect(ensurePathWithin(baseDir, target1)).toBe(path.resolve(target1))
      expect(ensurePathWithin(baseDir, target2)).toBe(path.resolve(target2))
    })

    testFn('should accept paths with unicode characters', () => {
      const target1 = path.join('/', 'home', 'user', 'mcp', '服务器')
      const target2 = path.join('/', 'home', 'user', 'mcp', 'サーバー')
      expect(ensurePathWithin(baseDir, target1)).toBe(path.resolve(target1))
      expect(ensurePathWithin(baseDir, target2)).toBe(path.resolve(target2))
    })
  })

  describe('path traversal prevention', () => {
    it('should reject paths that escape base directory', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', '..', '..', '..', 'etc'))).toThrow(
        'Path traversal detected'
      )
      expect(() => ensurePathWithin(baseDir, '/etc/passwd')).toThrow('Path traversal detected')
      expect(() => ensurePathWithin(baseDir, '/home/user')).toThrow('Path traversal detected')
    })

    it('should reject subdirectories', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', 'sub', 'dir'))).toThrow(
        'Path traversal detected'
      )
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', 'a', 'b', 'c'))).toThrow(
        'Path traversal detected'
      )
    })

    it('should reject Windows-style path traversal', () => {
      const winBase = 'C:\\Users\\user\\mcp'
      expect(() => ensurePathWithin(winBase, 'C:\\Users\\user\\mcp\\..\\..\\Windows\\System32')).toThrow(
        'Path traversal detected'
      )
    })

    it('should reject null byte attacks', () => {
      const maliciousPath = path.join(baseDir, 'server\x00/../../../etc/passwd')
      expect(() => ensurePathWithin(baseDir, maliciousPath)).toThrow('Path traversal detected')
    })

    it('should handle encoded traversal attempts', () => {
      expect(() => ensurePathWithin(baseDir, path.join('/', 'home', 'user', 'mcp', '..', 'escape'))).toThrow(
        'Path traversal detected'
      )
    })
  })

  describe('edge cases', () => {
    it('should reject base directory itself', () => {
      expect(() => ensurePathWithin(baseDir, baseDir)).toThrow('Path traversal detected')
    })

    // Skip this test on Windows
    const testFn = process.platform === 'win32' ? it.skip : it

    testFn('should handle relative path construction', () => {
      const target = path.join(baseDir, 'server-name')
      expect(ensurePathWithin(baseDir, target)).toBe(path.resolve(target))
    })
  })
})

describe('validateCommand', () => {
  describe('valid commands', () => {
    it('should accept simple command names', () => {
      expect(validateCommand('node')).toBe('node')
      expect(validateCommand('python')).toBe('python')
      expect(validateCommand('npx')).toBe('npx')
      expect(validateCommand('uvx')).toBe('uvx')
    })

    it('should accept absolute paths', () => {
      expect(validateCommand('/usr/bin/node')).toBe('/usr/bin/node')
      expect(validateCommand('/usr/local/bin/python3')).toBe('/usr/local/bin/python3')
      expect(validateCommand('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe')
    })

    it('should accept relative paths starting with ./', () => {
      expect(validateCommand('./node_modules/.bin/tsc')).toBe('./node_modules/.bin/tsc')
      expect(validateCommand('.\\scripts\\run.bat')).toBe('.\\scripts\\run.bat')
    })

    it('should trim whitespace', () => {
      expect(validateCommand('  node  ')).toBe('node')
      expect(validateCommand('\tpython\n')).toBe('python')
    })
  })

  describe('path traversal prevention', () => {
    it('should reject commands with path traversal (Unix style)', () => {
      expect(() => validateCommand('../../../bin/sh')).toThrow('path traversal detected')
      expect(() => validateCommand('../../etc/passwd')).toThrow('path traversal detected')
      expect(() => validateCommand('/usr/../../../bin/sh')).toThrow('path traversal detected')
    })

    it('should reject commands with path traversal (Windows style)', () => {
      expect(() => validateCommand('..\\..\\..\\Windows\\System32\\cmd.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('..\\..\\Windows\\System32\\calc.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('C:\\..\\..\\Windows\\System32\\cmd.exe')).toThrow('path traversal detected')
    })

    it('should reject just ".."', () => {
      expect(() => validateCommand('..')).toThrow('path traversal detected')
    })

    it('should reject mixed style path traversal', () => {
      expect(() => validateCommand('../..\\mixed/..\\attack')).toThrow('path traversal detected')
    })
  })

  describe('null byte injection', () => {
    it('should reject commands with null bytes', () => {
      expect(() => validateCommand('node\x00.exe')).toThrow('null byte detected')
      expect(() => validateCommand('python\0')).toThrow('null byte detected')
    })
  })

  describe('edge cases', () => {
    it('should reject empty strings', () => {
      expect(() => validateCommand('')).toThrow('command must be a non-empty string')
      expect(() => validateCommand('   ')).toThrow('command cannot be empty')
    })

    it('should reject non-string input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(null)).toThrow('command must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(undefined)).toThrow('command must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateCommand(123)).toThrow('command must be a non-empty string')
    })
  })

  describe('real-world attack scenarios', () => {
    it('should prevent Windows system32 command injection', () => {
      expect(() => validateCommand('../../../../Windows/System32/cmd.exe')).toThrow('path traversal detected')
      expect(() => validateCommand('..\\..\\..\\..\\Windows\\System32\\powershell.exe')).toThrow(
        'path traversal detected'
      )
    })

    it('should prevent Unix bin injection', () => {
      expect(() => validateCommand('../../../../bin/bash')).toThrow('path traversal detected')
      expect(() => validateCommand('../../../usr/bin/curl')).toThrow('path traversal detected')
    })
  })
})

describe('validateArgs', () => {
  describe('valid arguments', () => {
    it('should accept normal arguments', () => {
      expect(validateArgs(['--version'])).toEqual(['--version'])
      expect(validateArgs(['-y', '@anthropic/mcp-server'])).toEqual(['-y', '@anthropic/mcp-server'])
      expect(validateArgs(['install', 'package-name'])).toEqual(['install', 'package-name'])
    })

    it('should accept arguments with safe paths', () => {
      expect(validateArgs(['./src/index.ts'])).toEqual(['./src/index.ts'])
      expect(validateArgs(['/absolute/path/file.js'])).toEqual(['/absolute/path/file.js'])
    })

    it('should accept empty array', () => {
      expect(validateArgs([])).toEqual([])
    })
  })

  describe('path traversal prevention', () => {
    it('should reject arguments with path traversal', () => {
      expect(() => validateArgs(['../../../etc/passwd'])).toThrow('path traversal detected')
      expect(() => validateArgs(['--config', '../../secrets.json'])).toThrow('path traversal detected')
      expect(() => validateArgs(['..\\..\\Windows\\System32\\config'])).toThrow('path traversal detected')
    })

    it('should only check path-like arguments', () => {
      // Arguments without path separators should pass even with dots
      expect(validateArgs(['..version'])).toEqual(['..version'])
      expect(validateArgs(['test..name'])).toEqual(['test..name'])
    })
  })

  describe('null byte injection', () => {
    it('should reject arguments with null bytes', () => {
      expect(() => validateArgs(['file\x00.txt'])).toThrow('null byte detected')
      expect(() => validateArgs(['--config', 'path\0name'])).toThrow('null byte detected')
    })
  })

  describe('edge cases', () => {
    it('should reject non-array input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs('not an array')).toThrow('must be an array')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs(null)).toThrow('must be an array')
    })

    it('should reject non-string elements', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs([123])).toThrow('must be a string')
      // @ts-expect-error - testing runtime behavior
      expect(() => validateArgs(['valid', null])).toThrow('must be a string')
    })
  })
})

describe('buildResolvedEnv', () => {
  const extractDir = path.join('/', 'tmp', 'dxt')

  it('substitutes variables and returns a new object without mutating the input', () => {
    const input = { API_KEY: 'secret', ROOT: '${__dirname}' }
    const result = buildResolvedEnv(input, extractDir)

    expect(result).toEqual({ API_KEY: 'secret', ROOT: extractDir })
    // Input must not be mutated.
    expect(input.ROOT).toBe('${__dirname}')
    expect(result).not.toBe(input)
  })

  it('resolves ${HOME}/${DESKTOP}/${DOCUMENTS}/${DOWNLOADS} via central paths', () => {
    const input = {
      HOME: '${HOME}',
      DESKTOP: '${DESKTOP}',
      DOCUMENTS: '${DOCUMENTS}',
      DOWNLOADS: '${DOWNLOADS}'
    }
    const result = buildResolvedEnv(input, extractDir)

    // The mocked application.getPath returns "/mock/<key>" deterministically.
    expect(result).toEqual({
      HOME: '/mock/sys.home',
      DESKTOP: '/mock/sys.desktop',
      DOCUMENTS: '/mock/sys.documents',
      DOWNLOADS: '/mock/sys.downloads'
    })
  })

  it('rejects null bytes in env values', () => {
    expect(() => buildResolvedEnv({ TOKEN: 'abc\0def' }, extractDir)).toThrow('null byte detected')
  })

  it('rejects null bytes in env keys', () => {
    expect(() => buildResolvedEnv({ ['BAD\0KEY']: 'value' }, extractDir)).toThrow('null byte detected')
  })

  it('denylists process-affecting environment variables', () => {
    expect(() => buildResolvedEnv({ NODE_OPTIONS: '--require ./evil.js' }, extractDir)).toThrow('is not allowed')
    expect(() => buildResolvedEnv({ LD_PRELOAD: '/tmp/evil.so' }, extractDir)).toThrow('is not allowed')
    expect(() => buildResolvedEnv({ DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' }, extractDir)).toThrow('is not allowed')
  })

  it('denylists process-affecting environment variables case-insensitively', () => {
    expect(() => buildResolvedEnv({ node_options: '--require ./evil.js' }, extractDir)).toThrow('is not allowed')
    expect(() => buildResolvedEnv({ ld_preload: '/tmp/evil.so' }, extractDir)).toThrow('is not allowed')
    expect(() => buildResolvedEnv({ dyld_insert_libraries: '/tmp/evil.dylib' }, extractDir)).toThrow('is not allowed')
  })
})

describe('validatePackageUploadSource', () => {
  it('accepts a package exactly at the main-process byte limit', () => {
    expect(validatePackageUploadSource(path.resolve('server.mcpb'), MAX_MCP_PACKAGE_BYTES, 'mcpb')).toBe('server.mcpb')
  })

  it('rejects the first byte beyond the main-process limit', () => {
    expect(() => validatePackageUploadSource(path.resolve('server.dxt'), MAX_MCP_PACKAGE_BYTES + 1, 'dxt')).toThrow(
      'size limit'
    )
  })

  it('rejects relative paths, wrong extensions, and empty files', () => {
    expect(() => validatePackageUploadSource('server.dxt', 1, 'dxt')).toThrow('absolute file path')
    expect(() => validatePackageUploadSource(path.resolve('server.zip'), 1, 'dxt')).toThrow('expected a .dxt')
    expect(() => validatePackageUploadSource(path.resolve('server.dxt'), 0, 'dxt')).toThrow('cannot be empty')
  })
})

describe('copyPackageWithinLimit', () => {
  it('copies a package without buffering it and rejects the first byte beyond the limit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-package-copy-'))
    const source = path.join(root, 'source.dxt')
    const accepted = path.join(root, 'accepted.dxt')
    const rejected = path.join(root, 'rejected.dxt')
    fs.writeFileSync(source, Buffer.from([1, 2, 3, 4]))

    try {
      await copyPackageWithinLimit(source, accepted, 4)
      expect(fs.readFileSync(accepted)).toEqual(Buffer.from([1, 2, 3, 4]))

      await expect(copyPackageWithinLimit(source, rejected, 3)).rejects.toThrow('size limit')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('McpPackageService package upload staging', () => {
  it('returns the structured upload result when staging cleanup fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-package-upload-'))
    const source = path.join(root, 'server.dxt')
    fs.writeFileSync(source, 'package')
    const getPath = vi.mocked(application.getPath)
    const defaultGetPath = (key: string, filename?: string): string =>
      filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    getPath.mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.dxt.uploads.temp') {
        return filename ? path.join(root, 'uploads', filename) : path.join(root, 'uploads')
      }
      return defaultGetPath(key, filename)
    })

    const service = new McpPackageService()
    const expected = { success: false, error: 'invalid manifest' }
    const uploadPackage = vi.spyOn(service as any, 'uploadPackage').mockResolvedValue(expected)
    const remove = vi.spyOn(fs.promises, 'rm').mockRejectedValueOnce(new Error('cleanup denied'))

    try {
      await expect(service.uploadDxt(source)).resolves.toEqual(expected)
      expect(uploadPackage).toHaveBeenCalledWith(expect.stringMatching(/temp_file_.*_server\.dxt$/), 'dxt')
    } finally {
      remove.mockRestore()
      uploadPackage.mockRestore()
      BaseService.resetInstances()
      getPath.mockImplementation(defaultGetPath)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('McpPackageService package directory replacement', () => {
  it('stages the new package before swapping it into the final directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-package-'))
    const finalDir = path.join(root, 'server-demo')
    const sourceDir = path.join(root, 'source')
    const getPath = vi.mocked(application.getPath)
    const defaultGetPath = (key: string, filename?: string): string =>
      filename ? `/mock/${key}/${filename}` : `/mock/${key}`

    getPath.mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.mcp') {
        return filename ? path.join(root, filename) : root
      }
      return defaultGetPath(key, filename)
    })

    fs.mkdirSync(finalDir)
    fs.writeFileSync(path.join(finalDir, 'version.txt'), 'old')
    fs.mkdirSync(sourceDir)
    fs.writeFileSync(path.join(sourceDir, 'version.txt'), 'new')

    try {
      const service = new McpPackageService()

      await (service as any).replacePackageDirectory(sourceDir, finalDir, 'server-demo')

      expect(fs.readFileSync(path.join(finalDir, 'version.txt'), 'utf-8')).toBe('new')
      expect(fs.readdirSync(root).filter((entry) => entry.includes('.staged-') || entry.includes('.backup-'))).toEqual(
        []
      )
    } finally {
      getPath.mockImplementation(defaultGetPath)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
