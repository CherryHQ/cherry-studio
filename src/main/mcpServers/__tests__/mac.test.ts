import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process.spawn with typed callback storage
const mockStdout: { on: ReturnType<typeof vi.fn>; _dataCallback?: (data: Buffer) => void } = {
  on: vi.fn()
}
const mockStderr: { on: ReturnType<typeof vi.fn>; _dataCallback?: (data: Buffer) => void } = {
  on: vi.fn()
}
const mockStdin = {
  write: vi.fn(),
  end: vi.fn()
}
const mockProcess: {
  stdout: typeof mockStdout
  stderr: typeof mockStderr
  stdin: typeof mockStdin
  on: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  _closeCallback?: (code: number) => void
  _errorCallback?: (err: Error) => void
} = {
  stdout: mockStdout,
  stderr: mockStderr,
  stdin: mockStdin,
  on: vi.fn(),
  kill: vi.fn()
}

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProcess)
}))

import { spawn } from 'child_process'

import {
  MAX_INPUT_LENGTHS,
  MAX_RESULTS,
  runAppleScript,
  sanitizeAppleScriptString,
  TIMEOUT_MS,
  validateInput
} from '../mac/applescript'

describe('Mac MCP - AppleScript Utilities', () => {
  describe('sanitizeAppleScriptString', () => {
    it('should escape backslashes', () => {
      expect(sanitizeAppleScriptString('path\\to\\file')).toBe('path\\\\to\\\\file')
    })

    it('should escape double quotes', () => {
      expect(sanitizeAppleScriptString('say "hello"')).toBe('say \\"hello\\"')
    })

    it('should escape newlines', () => {
      expect(sanitizeAppleScriptString('line1\nline2')).toBe('line1\\nline2')
    })

    it('should escape carriage returns', () => {
      expect(sanitizeAppleScriptString('line1\rline2')).toBe('line1\\rline2')
    })

    it('should remove null bytes', () => {
      expect(sanitizeAppleScriptString('text\0with\0nulls')).toBe('textwithnulls')
    })

    it('should handle combined special characters', () => {
      expect(sanitizeAppleScriptString('path\\to\\"file\nwith\rnull\0')).toBe('path\\\\to\\\\\\"file\\nwith\\rnull')
    })

    it('should handle empty string', () => {
      expect(sanitizeAppleScriptString('')).toBe('')
    })

    it('should handle normal text unchanged', () => {
      expect(sanitizeAppleScriptString('Hello World')).toBe('Hello World')
    })
  })

  describe('validateInput', () => {
    it('should throw error for empty input', () => {
      expect(() => validateInput('', 100, 'Test field')).toThrow('Test field cannot be empty')
    })

    it('should throw error for whitespace-only input', () => {
      expect(() => validateInput('   ', 100, 'Test field')).toThrow('Test field cannot be empty')
    })

    it('should throw error for input exceeding max length', () => {
      const longInput = 'a'.repeat(101)
      expect(() => validateInput(longInput, 100, 'Test field')).toThrow('Test field exceeds maximum length of 100')
    })

    it('should accept valid input within limits', () => {
      expect(() => validateInput('valid input', 100, 'Test field')).not.toThrow()
    })

    it('should detect "do shell script" injection attempt', () => {
      expect(() => validateInput('do shell script "rm -rf /"', 1000, 'Test field')).toThrow(
        'Input contains potentially unsafe commands'
      )
    })

    it('should detect "system events" injection attempt', () => {
      expect(() => validateInput('tell system events to keystroke', 1000, 'Test field')).toThrow(
        'Input contains potentially unsafe commands'
      )
    })

    it('should detect "terminal" injection attempt', () => {
      expect(() => validateInput('tell application "Terminal"', 1000, 'Test field')).toThrow(
        'Input contains potentially unsafe commands'
      )
    })

    it('should be case insensitive for injection detection', () => {
      expect(() => validateInput('DO SHELL SCRIPT', 1000, 'Test field')).toThrow(
        'Input contains potentially unsafe commands'
      )
    })
  })

  describe('Constants', () => {
    it('should have valid MAX_INPUT_LENGTHS', () => {
      expect(MAX_INPUT_LENGTHS.noteTitle).toBe(500)
      expect(MAX_INPUT_LENGTHS.noteContent).toBe(50000)
      expect(MAX_INPUT_LENGTHS.emailSubject).toBe(1000)
      expect(MAX_INPUT_LENGTHS.emailBody).toBe(100000)
      expect(MAX_INPUT_LENGTHS.searchQuery).toBe(500)
      expect(MAX_INPUT_LENGTHS.eventTitle).toBe(500)
      expect(MAX_INPUT_LENGTHS.reminderName).toBe(500)
    })

    it('should have valid TIMEOUT_MS', () => {
      expect(TIMEOUT_MS.list).toBe(15000)
      expect(TIMEOUT_MS.search).toBe(20000)
      expect(TIMEOUT_MS.create).toBe(10000)
      expect(TIMEOUT_MS.open).toBe(5000)
      expect(TIMEOUT_MS.send).toBe(15000)
    })

    it('should have valid MAX_RESULTS', () => {
      expect(MAX_RESULTS.notes).toBe(20)
      expect(MAX_RESULTS.emails).toBe(10)
      expect(MAX_RESULTS.events).toBe(15)
      expect(MAX_RESULTS.reminders).toBe(30)
      expect(MAX_RESULTS.mailboxes).toBe(50)
      expect(MAX_RESULTS.contentPreview).toBe(300)
    })
  })
})

describe('Mac MCP - runAppleScript (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock implementations
    mockStdout.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        // Store callback for later use
        mockStdout._dataCallback = callback
      }
    })
    mockStderr.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        mockStderr._dataCallback = callback
      }
    })
    mockProcess.on.mockImplementation((event, callback) => {
      if (event === 'close') {
        mockProcess._closeCallback = callback
      }
      if (event === 'error') {
        mockProcess._errorCallback = callback
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should spawn osascript with stdin', async () => {
    const script = 'tell application "Notes" to get notes'

    // Simulate successful execution
    setTimeout(() => {
      mockStdout._dataCallback?.(Buffer.from('note1, note2'))
      mockProcess._closeCallback?.(0)
    }, 10)

    const result = await runAppleScript(script)

    expect(spawn).toHaveBeenCalledWith('osascript', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    expect(mockStdin.write).toHaveBeenCalledWith(script)
    expect(mockStdin.end).toHaveBeenCalled()
    expect(result).toBe('note1, note2')
  })

  it('should handle AppleScript errors', async () => {
    const script = 'invalid script'

    setTimeout(() => {
      mockStderr._dataCallback?.(Buffer.from('syntax error'))
      mockProcess._closeCallback?.(1)
    }, 10)

    await expect(runAppleScript(script)).rejects.toThrow('AppleScript error: syntax error')
  })

  it('should handle spawn errors', async () => {
    const script = 'test script'

    setTimeout(() => {
      mockProcess._errorCallback?.(new Error('spawn failed'))
    }, 10)

    await expect(runAppleScript(script)).rejects.toThrow('Failed to execute AppleScript: spawn failed')
  })
})

// Integration tests - skipped by default
// These tests require actual macOS with osascript and are meant for manual testing
// To run manually: RUN_MAC_INTEGRATION=1 yarn test:main -- mac.test.ts
describe.skip('Mac MCP - Integration Tests (manual only)', () => {
  // Note: These tests are skipped because:
  // 1. They require unmocking child_process which doesn't work well with vi.mock
  // 2. They require actual macOS with osascript available
  // 3. They may trigger permission dialogs for app access
  //
  // For manual testing, comment out the vi.mock('child_process'...) block above
  // and change describe.skip to describe

  it.todo('should execute simple AppleScript')
  it.todo('should execute multi-line AppleScript')
  it.todo('should handle AppleScript errors with proper message')
})
