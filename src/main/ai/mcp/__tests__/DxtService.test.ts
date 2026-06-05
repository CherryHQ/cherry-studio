import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { assertZipEntriesWithin, buildResolvedEnv, ensurePathWithin, validateArgs, validateCommand } = await import(
  '../DxtService'
)

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

// C4 (mcp-services-1): node-stream-zip writes each entry at path.join(baseDir, name)
// with no containment check, so a DXT archive crafted with a `../` entry could
// overwrite files outside the extraction dir. The guard must reject before extraction.
describe('assertZipEntriesWithin', () => {
  const baseDir = path.join('/', 'tmp', 'dxt_extract')

  // Skip on Windows — path separator / resolution semantics differ.
  const testFn = process.platform === 'win32' ? it.skip : it

  testFn('accepts entries nested inside the base dir', () => {
    expect(() => assertZipEntriesWithin(['manifest.json', 'server/index.js', 'assets/icon.png'], baseDir)).not.toThrow()
  })

  testFn('rejects a parent-traversal entry', () => {
    expect(() => assertZipEntriesWithin(['../escape.txt'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects a deep traversal entry mixed with safe entries', () => {
    expect(() => assertZipEntriesWithin(['manifest.json', '../../../etc/cron.d/evil'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects an absolute-path entry', () => {
    expect(() => assertZipEntriesWithin(['/etc/passwd'], baseDir)).toThrow('zip-slip')
  })

  testFn('rejects a sibling-prefix entry that is not actually nested', () => {
    // `/tmp/dxt_extract_evil` shares the base string prefix but is not within the base dir.
    expect(() => assertZipEntriesWithin(['../dxt_extract_evil/x'], baseDir)).toThrow('zip-slip')
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
})
