import { describe, expect, it } from 'vitest'

import { sanitizeName, validateArgs, validateCommand } from '../DxtService'

describe('sanitizeName', () => {
  describe('basic sanitization', () => {
    it('should return valid names unchanged', () => {
      expect(sanitizeName('my-server')).toBe('my-server')
      expect(sanitizeName('my_server')).toBe('my_server')
      expect(sanitizeName('myServer123')).toBe('myServer123')
      expect(sanitizeName('server.name')).toBe('server.name')
    })

    it('should replace forward slashes with hyphens', () => {
      expect(sanitizeName('anthropic/sequential-thinking')).toBe('anthropic-sequential-thinking')
      expect(sanitizeName('org/repo/name')).toBe('org-repo-name')
    })

    it('should replace backslashes with hyphens', () => {
      expect(sanitizeName('path\\to\\server')).toBe('path-to-server')
      expect(sanitizeName('name\\\\double')).toBe('name-double')
    })
  })

  describe('path traversal prevention', () => {
    it('should neutralize directory traversal with backslash', () => {
      // Windows-style path traversal attack
      const malicious =
        '..\\..\\..\\Users\\victim\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\malware'
      const result = sanitizeName(malicious)
      expect(result).not.toContain('..')
      expect(result).not.toContain('\\')
      expect(result).not.toContain('/')
    })

    it('should neutralize directory traversal with forward slash', () => {
      // Unix-style path traversal attack
      const malicious = '../../../etc/passwd'
      const result = sanitizeName(malicious)
      expect(result).not.toContain('..')
      expect(result).not.toContain('/')
    })

    it('should neutralize mixed path traversal', () => {
      const malicious = '..\\../mixed/..\\attack'
      const result = sanitizeName(malicious)
      expect(result).not.toContain('..')
      expect(result).not.toContain('\\')
      expect(result).not.toContain('/')
    })

    it('should handle multiple consecutive dots', () => {
      expect(sanitizeName('name...with....dots')).toBe('name.with.dots')
      expect(sanitizeName('..hidden')).toBe('hidden')
      expect(sanitizeName('name..')).toBe('name')
    })
  })

  describe('Windows-specific dangerous characters', () => {
    it('should remove colons (drive letter separator)', () => {
      expect(sanitizeName('C:\\Windows\\System32')).toBe('C-Windows-System32')
      expect(sanitizeName('name:value')).toBe('name-value')
    })

    it('should remove other Windows forbidden characters', () => {
      expect(sanitizeName('name<script>')).toBe('name-script')
      expect(sanitizeName('file|pipe')).toBe('file-pipe')
      expect(sanitizeName('query?param')).toBe('query-param')
      expect(sanitizeName('wild*card')).toBe('wild-card')
      expect(sanitizeName('"quoted"')).toBe('quoted')
    })
  })

  describe('null byte injection', () => {
    it('should remove null bytes', () => {
      expect(sanitizeName('name\x00.exe')).toBe('name.exe')
      expect(sanitizeName('server\0name')).toBe('servername')
    })
  })

  describe('edge cases', () => {
    it('should throw on empty string', () => {
      expect(() => sanitizeName('')).toThrow('Invalid name: name must be a non-empty string')
    })

    it('should throw on non-string input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => sanitizeName(null)).toThrow('Invalid name: name must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => sanitizeName(undefined)).toThrow('Invalid name: name must be a non-empty string')
      // @ts-expect-error - testing runtime behavior
      expect(() => sanitizeName(123)).toThrow('Invalid name: name must be a non-empty string')
    })

    it('should throw when result is empty after sanitization', () => {
      expect(() => sanitizeName('...')).toThrow('Invalid name: name contains only invalid characters')
      expect(() => sanitizeName('///')).toThrow('Invalid name: name contains only invalid characters')
      expect(() => sanitizeName('\\\\\\')).toThrow('Invalid name: name contains only invalid characters')
    })

    it('should handle leading/trailing spaces and dots', () => {
      expect(sanitizeName('  name  ')).toBe('name')
      expect(sanitizeName('..name..')).toBe('name')
      expect(sanitizeName('.hidden')).toBe('hidden')
    })

    it('should collapse multiple consecutive hyphens', () => {
      expect(sanitizeName('a--b---c')).toBe('a-b-c')
      expect(sanitizeName('path///to///name')).toBe('path-to-name')
    })

    it('should remove leading/trailing hyphens', () => {
      expect(sanitizeName('-name-')).toBe('name')
      expect(sanitizeName('---name---')).toBe('name')
    })
  })

  describe('real-world attack scenarios', () => {
    it('should prevent Windows startup folder injection', () => {
      const attack =
        '..\\..\\..\\Users\\Public\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\evil'
      const result = sanitizeName(attack)
      expect(result).not.toContain('..')
      expect(result).not.toContain('\\')
      // Result should be a flat, safe name (may contain spaces from original path)
      expect(result).toMatch(/^[a-zA-Z0-9._ -]+$/)
    })

    it('should prevent system32 injection', () => {
      const attack = '..\\..\\Windows\\System32\\config\\SAM'
      const result = sanitizeName(attack)
      expect(result).not.toContain('..')
      expect(result).not.toContain('\\')
    })

    it('should prevent Unix etc injection', () => {
      const attack = '../../../etc/shadow'
      const result = sanitizeName(attack)
      expect(result).not.toContain('..')
      expect(result).not.toContain('/')
    })

    it('should prevent home directory escape', () => {
      const attack = '..\\..\\..\\..\\..\\..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts'
      const result = sanitizeName(attack)
      expect(result).not.toContain('..')
      expect(result).not.toContain('\\')
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
