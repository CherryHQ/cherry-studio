import * as fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeSureDirExists } from '../index'

// Mock fs module
vi.mock('node:fs')

describe('makeSureDirExists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('directory exists', () => {
    it('should return success when directory already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const result = makeSureDirExists('/existing/path')

      expect(result).toEqual({ success: true })
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })
  })

  describe('directory does not exist', () => {
    it('should create directory and return success', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined)

      const result = makeSureDirExists('/new/path')

      expect(result).toEqual({ success: true })
      expect(fs.mkdirSync).toHaveBeenCalledWith('/new/path', { recursive: true })
    })
  })

  describe('permission denied', () => {
    it('should return error with friendly message for EACCES', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const error = new Error('Permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw error
      })

      const result = makeSureDirExists('/protected/path')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error?.message).toContain('Permission denied')
      expect(result.error?.message).toContain('/protected/path')
      expect(result.error?.message).toContain('administrator')
    })

    it('should return error with friendly message for EPERM', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const error = new Error('Operation not permitted') as NodeJS.ErrnoException
      error.code = 'EPERM'
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw error
      })

      const result = makeSureDirExists('/protected/path')

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error?.message).toContain('Permission denied')
    })
  })

  describe('other errors', () => {
    it('should return the original error for non-permission errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const error = new Error('Disk full')
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw error
      })

      const result = makeSureDirExists('/some/path')

      expect(result.success).toBe(false)
      expect(result.error).toBe(error)
    })
  })
})
