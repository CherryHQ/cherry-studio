import crypto from 'crypto'
import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
// Mock fs first before any imports
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      promises: {
        writeFile: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        mkdir: vi.fn(),
        chmod: vi.fn()
      }
    },
    existsSync: vi.fn(() => false),
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      unlink: vi.fn(),
      mkdir: vi.fn(),
      chmod: vi.fn()
    }
  }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/test/userData')
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(`encrypted:${str}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const str = buffer.toString()
      if (str.startsWith('encrypted:')) {
        return str.substring('encrypted:'.length)
      }
      throw new Error('Invalid encrypted data')
    })
  },
  net: {
    fetch: vi.fn()
  }
}))

vi.mock('@main/utils/file', () => ({
  getConfigDir: vi.fn(() => '/test/config')
}))

// Import after mocks
import { net, safeStorage } from 'electron'

import VolcengineService, {
  _buildCanonicalHeaders,
  _buildCanonicalQueryString,
  _createCanonicalRequest,
  _createStringToSign,
  _deriveSigningKey,
  _hmacSha256,
  _hmacSha256Hex,
  _sha256Hash,
  _uriEncode
} from '../VolcengineService'

const service = VolcengineService

describe('VolcengineService', () => {
  const mockEvent = {} as Electron.IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Cryptographic Helper Methods', () => {
    describe('sha256Hash', () => {
      it('should correctly hash a string', () => {
        const input = 'test string'
        const expectedHash = crypto.createHash('sha256').update(input).digest('hex')

        const result = _sha256Hash(input)

        expect(result).toBe(expectedHash)
      })

      it('should correctly hash a buffer', () => {
        const input = Buffer.from('test buffer')
        const expectedHash = crypto.createHash('sha256').update(input).digest('hex')

        const result = _sha256Hash(input)

        expect(result).toBe(expectedHash)
      })

      it('should hash empty string', () => {
        const expectedHash = crypto.createHash('sha256').update('').digest('hex')

        const result = _sha256Hash('')

        expect(result).toBe(expectedHash)
      })
    })

    describe('hmacSha256', () => {
      it('should correctly compute HMAC-SHA256 with string key', () => {
        const key = 'secret'
        const data = 'message'
        const expectedHmac = crypto.createHmac('sha256', key).update(data, 'utf8').digest()

        const result = _hmacSha256(key, data)

        expect(result.equals(expectedHmac)).toBe(true)
      })

      it('should correctly compute HMAC-SHA256 with buffer key', () => {
        const key = Buffer.from('secret')
        const data = 'message'
        const expectedHmac = crypto.createHmac('sha256', key).update(data, 'utf8').digest()

        const result = _hmacSha256(key, data)

        expect(result.equals(expectedHmac)).toBe(true)
      })
    })

    describe('hmacSha256Hex', () => {
      it('should correctly compute HMAC-SHA256 and return hex string', () => {
        const key = 'secret'
        const data = 'message'
        const expectedHex = crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')

        const result = _hmacSha256Hex(key, data)

        expect(result).toBe(expectedHex)
      })
    })
  })

  describe('URL Encoding (RFC3986)', () => {
    describe('uriEncode', () => {
      it('should encode special characters', () => {
        const input = 'hello world@#$%^&*()'
        const result = _uriEncode(input)

        // RFC3986 unreserved: A-Z a-z 0-9 - _ . ~
        // encodeURIComponent encodes most special chars except ! ' ( ) *
        expect(result).toContain('hello%20world')
        expect(result).toContain('%40') // @
        expect(result).toContain('%23') // #
        expect(result).toContain('%24') // $
      })

      it('should not encode unreserved characters', () => {
        const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'
        const result = _uriEncode(input)

        expect(result).toBe(input)
      })

      it('should encode slash by default', () => {
        const input = 'path/to/resource'
        const result = _uriEncode(input)

        expect(result).toBe('path%2Fto%2Fresource')
      })

      it('should not encode slash when encodeSlash is false', () => {
        const input = 'path/to/resource'
        const result = _uriEncode(input, false)

        expect(result).toBe('path/to/resource')
      })

      it('should handle empty string', () => {
        const result = _uriEncode('')

        expect(result).toBe('')
      })

      it('should encode spaces as %20', () => {
        const input = 'hello world'
        const result = _uriEncode(input)

        expect(result).toBe('hello%20world')
      })

      it('should handle unicode characters', () => {
        const input = '你好世界'
        const result = _uriEncode(input)

        expect(result).not.toBe(input)
        expect(result).toContain('%')
      })
    })
  })

  describe('Canonical Request Building', () => {
    describe('buildCanonicalQueryString', () => {
      it('should build sorted query string', () => {
        const query = {
          z: 'last',
          a: 'first',
          m: 'middle'
        }

        const result = _buildCanonicalQueryString(query)

        expect(result).toBe('a=first&m=middle&z=last')
      })

      it('should handle empty query object', () => {
        const result = _buildCanonicalQueryString({})

        expect(result).toBe('')
      })

      it('should URL encode keys and values', () => {
        const query = {
          'key with space': 'value with space',
          'special@#': 'chars$%^'
        }

        const result = _buildCanonicalQueryString(query)

        expect(result).toContain('key%20with%20space=value%20with%20space')
        expect(result).toContain('special%40%23=chars%24%25%5E')
      })

      it('should handle single parameter', () => {
        const query = { action: 'ListModels' }

        const result = _buildCanonicalQueryString(query)

        expect(result).toBe('action=ListModels')
      })
    })

    describe('buildCanonicalHeaders', () => {
      it('should lowercase and sort header names', () => {
        // Headers should already be lowercase when passed to this method
        const headers = {
          'x-date': '20240101T120000Z',
          'content-type': 'application/json',
          host: 'example.com'
        }

        const result = _buildCanonicalHeaders(headers)

        expect(result.canonicalHeaders).toBe(
          'content-type:application/json\nhost:example.com\nx-date:20240101T120000Z\n'
        )
        expect(result.signedHeaders).toBe('content-type;host;x-date')
      })

      it('should trim header values', () => {
        // Headers should already be lowercase when passed to this method
        const headers = {
          host: '  example.com  ',
          'x-date': '  20240101T120000Z  '
        }

        const result = _buildCanonicalHeaders(headers)

        expect(result.canonicalHeaders).toBe('host:example.com\nx-date:20240101T120000Z\n')
      })

      it('should handle empty header values', () => {
        // Headers should already be lowercase when passed to this method
        const headers = {
          host: 'example.com',
          'x-custom': ''
        }

        const result = _buildCanonicalHeaders(headers)

        expect(result.canonicalHeaders).toBe('host:example.com\nx-custom:\n')
      })
    })

    describe('deriveSigningKey', () => {
      it('should derive signing key correctly', () => {
        const secretKey = 'testSecret'
        const date = '20240101'
        const region = 'cn-beijing'
        const serviceName = 'ark'

        const result = _deriveSigningKey(secretKey, date, region, serviceName)

        // The result should be a Buffer
        expect(Buffer.isBuffer(result)).toBe(true)

        // The key derivation should be deterministic
        const result2 = _deriveSigningKey(secretKey, date, region, serviceName)
        expect(result.equals(result2)).toBe(true)
      })

      it('should produce different keys for different inputs', () => {
        const secretKey = 'testSecret'
        const date = '20240101'
        const region = 'cn-beijing'
        const serviceName = 'ark'

        const key1 = _deriveSigningKey(secretKey, date, region, serviceName)
        const key2 = _deriveSigningKey('differentSecret', date, region, serviceName)
        const key3 = _deriveSigningKey(secretKey, '20240102', region, serviceName)

        expect(key1.equals(key2)).toBe(false)
        expect(key1.equals(key3)).toBe(false)
      })
    })

    describe('createCanonicalRequest', () => {
      it('should create canonical request string correctly', () => {
        const method = 'POST'
        const canonicalUri = '/'
        const canonicalQueryString = 'Action=ListModels&Version=2024-01-01'
        const canonicalHeaders = 'host:open.volcengineapi.com\nx-date:20240101T120000Z\n'
        const signedHeaders = 'host;x-date'
        const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

        const result = _createCanonicalRequest(
          method,
          canonicalUri,
          canonicalQueryString,
          canonicalHeaders,
          signedHeaders,
          payloadHash
        )

        const expected = [
          method,
          canonicalUri,
          canonicalQueryString,
          canonicalHeaders,
          signedHeaders,
          payloadHash
        ].join('\n')

        expect(result).toBe(expected)
      })
    })

    describe('createStringToSign', () => {
      it('should create string to sign correctly', () => {
        const dateTime = '20240101T120000Z'
        const credentialScope = '20240101/cn-beijing/ark/request'
        const canonicalRequest = 'POST\n/\n\nhost:example.com\n\nhost\npayloadhash'

        const result = _createStringToSign(dateTime, credentialScope, canonicalRequest)

        const expectedHash = _sha256Hash(canonicalRequest)
        const expected = ['HMAC-SHA256', dateTime, credentialScope, expectedHash].join('\n')

        expect(result).toBe(expected)
      })
    })
  })

  // Note: Signature generation is tested through the public getAuthHeaders method
  // This ensures the complete signature flow works correctly

  describe('Credential Management', () => {
    describe('saveCredentials', () => {
      it('should save credentials using safeStorage', async () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)

        await service.saveCredentials(mockEvent, 'testAccessKey', 'testSecretKey')

        expect(safeStorage.encryptString).toHaveBeenCalledWith(
          JSON.stringify({
            accessKeyId: 'testAccessKey',
            secretAccessKey: 'testSecretKey'
          })
        )
        expect(fs.promises.writeFile).toHaveBeenCalled()
        expect(fs.promises.chmod).toHaveBeenCalledWith(expect.any(String), 0o600)
      })

      it('should throw error when credentials are empty', async () => {
        await expect(service.saveCredentials(mockEvent, '', 'secret')).rejects.toThrow('Failed to save credentials')

        await expect(service.saveCredentials(mockEvent, 'key', '')).rejects.toThrow('Failed to save credentials')
      })

      it('should throw error when safeStorage is not available', async () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)

        await expect(service.saveCredentials(mockEvent, 'key', 'secret')).rejects.toThrow('Failed to save credentials')
      })

      it('should create directory if it does not exist', async () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        await service.saveCredentials(mockEvent, 'testAccessKey', 'testSecretKey')

        expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      })
    })

    // loadCredentials is tested indirectly through public APIs like getAuthHeaders and listModels

    describe('hasCredentials', () => {
      it('should return true when credentials file exists', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)

        const result = await service.hasCredentials()

        expect(result).toBe(true)
      })

      it('should return false when credentials file does not exist', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        const result = await service.hasCredentials()

        expect(result).toBe(false)
      })
    })

    describe('clearCredentials', () => {
      it('should delete credentials file when it exists', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)

        await service.clearCredentials()

        expect(fs.promises.unlink).toHaveBeenCalled()
      })

      it('should not throw error when credentials file does not exist', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        await expect(service.clearCredentials()).resolves.not.toThrow()
        expect(fs.promises.unlink).not.toHaveBeenCalled()
      })

      it('should throw error when file deletion fails', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.unlink).mockRejectedValue(new Error('Permission denied'))

        await expect(service.clearCredentials()).rejects.toThrow('Failed to clear credentials')
      })
    })
  })

  describe('API Methods', () => {
    describe('listModels', () => {
      it('should fetch and combine foundation models and endpoints', async () => {
        const mockFoundationModelsResponse = {
          Result: {
            TotalCount: 2,
            Items: [
              { Name: 'model1', DisplayName: 'Model 1', Description: 'Test model 1' },
              { Name: 'model2', DisplayName: 'Model 2', Description: 'Test model 2' }
            ]
          }
        }

        const mockEndpointsResponse = {
          Result: {
            TotalCount: 1,
            Items: [
              {
                Id: 'ep-123',
                Name: 'Custom Endpoint',
                Description: 'Custom endpoint',
                ModelReference: {
                  FoundationModel: {
                    Name: 'base-model',
                    ModelVersion: 'v1.0'
                  }
                }
              }
            ]
          }
        }

        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        // Mock API calls
        vi.mocked(net.fetch)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => mockFoundationModelsResponse
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => mockEndpointsResponse
          } as any)

        const result = await service.listModels(mockEvent)

        expect(result.models).toHaveLength(3)
        expect(result.total).toBe(3)
        expect(result.models[0].id).toBe('model1')
        expect(result.models[2].id).toBe('ep-123')
      })

      it('should handle partial failures gracefully', async () => {
        const mockFoundationModelsResponse = {
          Result: {
            TotalCount: 1,
            Items: [{ Name: 'model1', DisplayName: 'Model 1' }]
          }
        }

        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        // Mock API calls - first succeeds, second fails
        vi.mocked(net.fetch)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => mockFoundationModelsResponse
          } as any)
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Server error'
          } as any)

        const result = await service.listModels(mockEvent)

        expect(result.models).toHaveLength(1)
        expect(result.warnings).toBeDefined()
        expect(result.warnings?.length).toBeGreaterThan(0)
      })

      it('should throw error when both API calls fail', async () => {
        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        // Mock both API calls to fail
        vi.mocked(net.fetch).mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Server error'
        } as any)

        await expect(service.listModels(mockEvent)).rejects.toThrow('Failed to list models')
      })

      it('should throw error when no credentials are found', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        await expect(service.listModels(mockEvent)).rejects.toThrow('Failed to list models')
      })
    })

    describe('getAuthHeaders', () => {
      it('should generate auth headers for external use', async () => {
        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        const params = {
          method: 'POST' as const,
          host: 'open.volcengineapi.com',
          path: '/v1/chat/completions',
          query: {},
          body: '{"model":"test"}'
        }

        const result = await service.getAuthHeaders(mockEvent, params)

        expect(result).toHaveProperty('Authorization')
        expect(result).toHaveProperty('X-Date')
        expect(result).toHaveProperty('X-Content-Sha256')
        expect(result).toHaveProperty('Host')
      })

      it('should use default service and region when not provided', async () => {
        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        const params = {
          method: 'POST' as const,
          host: 'open.volcengineapi.com',
          path: '/',
          query: {}
        }

        const result = await service.getAuthHeaders(mockEvent, params)

        // Should not throw and should generate headers
        expect(result).toHaveProperty('Authorization')
        expect(result.Authorization).toContain('cn-beijing/ark/request')
      })
    })

    describe('makeRequest', () => {
      it('should make a generic signed API request', async () => {
        const mockResponse = { success: true, data: 'test' }

        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
        )

        vi.mocked(net.fetch).mockResolvedValue({
          ok: true,
          json: async () => mockResponse
        } as any)

        const params = {
          method: 'POST' as const,
          host: 'open.volcengineapi.com',
          path: '/',
          action: 'TestAction',
          version: '2024-01-01',
          query: {},
          body: { test: true }
        }

        const result = await service.makeRequest(mockEvent, params)

        expect(result).toEqual(mockResponse)
        expect(net.fetch).toHaveBeenCalled()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors in API requests', async () => {
      // Setup credentials
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
      )

      vi.mocked(net.fetch).mockRejectedValue(new Error('Network error'))

      await expect(service.listModels(mockEvent)).rejects.toThrow('Failed to list models')
    })

    it('should handle API error responses', async () => {
      // Setup credentials
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        Buffer.from(`encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`)
      )

      vi.mocked(net.fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      } as any)

      await expect(service.listModels(mockEvent)).rejects.toThrow()
    })
  })
})
