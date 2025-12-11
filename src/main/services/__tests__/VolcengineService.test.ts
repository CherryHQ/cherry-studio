import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
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
import { app, net, safeStorage } from 'electron'
import VolcengineService from '../VolcengineService'

// Access private methods through type assertion for testing
type VolcengineServiceType = typeof VolcengineService & {
  sha256Hash(data: string | Buffer): string
  hmacSha256(key: Buffer | string, data: string): Buffer
  hmacSha256Hex(key: Buffer | string, data: string): string
  uriEncode(str: string, encodeSlash?: boolean): string
  buildCanonicalQueryString(query: Record<string, string>): string
  buildCanonicalHeaders(headers: Record<string, string>): {
    canonicalHeaders: string
    signedHeaders: string
  }
  deriveSigningKey(secretKey: string, date: string, region: string, service: string): Buffer
  createCanonicalRequest(
    method: string,
    canonicalUri: string,
    canonicalQueryString: string,
    canonicalHeaders: string,
    signedHeaders: string,
    payloadHash: string
  ): string
  createStringToSign(dateTime: string, credentialScope: string, canonicalRequest: string): string
  generateSignature(
    params: {
      method: 'GET' | 'POST'
      host: string
      path: string
      query: Record<string, string>
      headers: Record<string, string>
      body?: string
      service: string
      region: string
    },
    credentials: { accessKeyId: string; secretAccessKey: string }
  ): {
    Authorization: string
    'X-Date': string
    'X-Content-Sha256': string
    Host: string
  }
  loadCredentials(): Promise<{ accessKeyId: string; secretAccessKey: string } | null>
  credentialsFilePath: string
}

const service = VolcengineService as VolcengineServiceType

describe('VolcengineService', () => {
  const mockEvent = {} as Electron.IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock file system
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from(''))
    vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'chmod').mockResolvedValue(undefined)
  })

  describe('Cryptographic Helper Methods', () => {
    describe('sha256Hash', () => {
      it('should correctly hash a string', () => {
        const input = 'test string'
        const expectedHash = crypto.createHash('sha256').update(input).digest('hex')

        const result = service.sha256Hash(input)

        expect(result).toBe(expectedHash)
      })

      it('should correctly hash a buffer', () => {
        const input = Buffer.from('test buffer')
        const expectedHash = crypto.createHash('sha256').update(input).digest('hex')

        const result = service.sha256Hash(input)

        expect(result).toBe(expectedHash)
      })

      it('should hash empty string', () => {
        const expectedHash = crypto.createHash('sha256').update('').digest('hex')

        const result = service.sha256Hash('')

        expect(result).toBe(expectedHash)
      })
    })

    describe('hmacSha256', () => {
      it('should correctly compute HMAC-SHA256 with string key', () => {
        const key = 'secret'
        const data = 'message'
        const expectedHmac = crypto.createHmac('sha256', key).update(data, 'utf8').digest()

        const result = service.hmacSha256(key, data)

        expect(result.equals(expectedHmac)).toBe(true)
      })

      it('should correctly compute HMAC-SHA256 with buffer key', () => {
        const key = Buffer.from('secret')
        const data = 'message'
        const expectedHmac = crypto.createHmac('sha256', key).update(data, 'utf8').digest()

        const result = service.hmacSha256(key, data)

        expect(result.equals(expectedHmac)).toBe(true)
      })
    })

    describe('hmacSha256Hex', () => {
      it('should correctly compute HMAC-SHA256 and return hex string', () => {
        const key = 'secret'
        const data = 'message'
        const expectedHex = crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')

        const result = service.hmacSha256Hex(key, data)

        expect(result).toBe(expectedHex)
      })
    })
  })

  describe('URL Encoding (RFC3986)', () => {
    describe('uriEncode', () => {
      it('should encode special characters', () => {
        const input = 'hello world!@#$%^&*()'
        const result = service.uriEncode(input)

        // RFC3986 unreserved: A-Z a-z 0-9 - _ . ~
        expect(result).toContain('hello%20world')
        expect(result).toContain('%21') // !
        expect(result).toContain('%40') // @
      })

      it('should not encode unreserved characters', () => {
        const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'
        const result = service.uriEncode(input)

        expect(result).toBe(input)
      })

      it('should encode slash by default', () => {
        const input = 'path/to/resource'
        const result = service.uriEncode(input)

        expect(result).toBe('path%2Fto%2Fresource')
      })

      it('should not encode slash when encodeSlash is false', () => {
        const input = 'path/to/resource'
        const result = service.uriEncode(input, false)

        expect(result).toBe('path/to/resource')
      })

      it('should handle empty string', () => {
        const result = service.uriEncode('')

        expect(result).toBe('')
      })

      it('should encode spaces as %20', () => {
        const input = 'hello world'
        const result = service.uriEncode(input)

        expect(result).toBe('hello%20world')
      })

      it('should handle unicode characters', () => {
        const input = '你好世界'
        const result = service.uriEncode(input)

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

        const result = service.buildCanonicalQueryString(query)

        expect(result).toBe('a=first&m=middle&z=last')
      })

      it('should handle empty query object', () => {
        const result = service.buildCanonicalQueryString({})

        expect(result).toBe('')
      })

      it('should URL encode keys and values', () => {
        const query = {
          'key with space': 'value with space',
          'special!@#': 'chars$%^'
        }

        const result = service.buildCanonicalQueryString(query)

        expect(result).toContain('key%20with%20space=value%20with%20space')
        expect(result).toContain('special%21%40%23=chars%24%25%5E')
      })

      it('should handle single parameter', () => {
        const query = { action: 'ListModels' }

        const result = service.buildCanonicalQueryString(query)

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

        const result = service.buildCanonicalHeaders(headers)

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

        const result = service.buildCanonicalHeaders(headers)

        expect(result.canonicalHeaders).toBe('host:example.com\nx-date:20240101T120000Z\n')
      })

      it('should handle empty header values', () => {
        // Headers should already be lowercase when passed to this method
        const headers = {
          host: 'example.com',
          'x-custom': ''
        }

        const result = service.buildCanonicalHeaders(headers)

        expect(result.canonicalHeaders).toBe('host:example.com\nx-custom:\n')
      })
    })

    describe('deriveSigningKey', () => {
      it('should derive signing key correctly', () => {
        const secretKey = 'testSecret'
        const date = '20240101'
        const region = 'cn-beijing'
        const serviceName = 'ark'

        const result = service.deriveSigningKey(secretKey, date, region, serviceName)

        // The result should be a Buffer
        expect(Buffer.isBuffer(result)).toBe(true)

        // The key derivation should be deterministic
        const result2 = service.deriveSigningKey(secretKey, date, region, serviceName)
        expect(result.equals(result2)).toBe(true)
      })

      it('should produce different keys for different inputs', () => {
        const secretKey = 'testSecret'
        const date = '20240101'
        const region = 'cn-beijing'
        const serviceName = 'ark'

        const key1 = service.deriveSigningKey(secretKey, date, region, serviceName)
        const key2 = service.deriveSigningKey('differentSecret', date, region, serviceName)
        const key3 = service.deriveSigningKey(secretKey, '20240102', region, serviceName)

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

        const result = service.createCanonicalRequest(
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

        const result = service.createStringToSign(dateTime, credentialScope, canonicalRequest)

        const expectedHash = service.sha256Hash(canonicalRequest)
        const expected = ['HMAC-SHA256', dateTime, credentialScope, expectedHash].join('\n')

        expect(result).toBe(expected)
      })
    })
  })

  describe('Signature Generation', () => {
    describe('generateSignature', () => {
      it('should generate valid signature headers', () => {
        const params = {
          method: 'POST' as const,
          host: 'open.volcengineapi.com',
          path: '/',
          query: { Action: 'ListModels', Version: '2024-01-01' },
          headers: {},
          body: '{}',
          service: 'ark',
          region: 'cn-beijing'
        }

        const credentials = {
          accessKeyId: 'testAccessKey',
          secretAccessKey: 'testSecretKey'
        }

        const result = service.generateSignature(params, credentials)

        expect(result).toHaveProperty('Authorization')
        expect(result).toHaveProperty('X-Date')
        expect(result).toHaveProperty('X-Content-Sha256')
        expect(result).toHaveProperty('Host')

        // Verify Authorization header format
        expect(result.Authorization).toContain('HMAC-SHA256')
        expect(result.Authorization).toContain('Credential=testAccessKey')
        expect(result.Authorization).toContain('SignedHeaders=')
        expect(result.Authorization).toContain('Signature=')

        // Verify Host header
        expect(result.Host).toBe('open.volcengineapi.com')

        // Verify X-Content-Sha256 matches body hash
        const expectedBodyHash = service.sha256Hash('{}')
        expect(result['X-Content-Sha256']).toBe(expectedBodyHash)

        // Verify X-Date format (ISO8601 basic format)
        expect(result['X-Date']).toMatch(/^\d{8}T\d{6}Z$/)
      })

      it('should handle empty body', () => {
        const params = {
          method: 'GET' as const,
          host: 'open.volcengineapi.com',
          path: '/',
          query: {},
          headers: {},
          service: 'ark',
          region: 'cn-beijing'
        }

        const credentials = {
          accessKeyId: 'testAccessKey',
          secretAccessKey: 'testSecretKey'
        }

        const result = service.generateSignature(params, credentials)

        // Empty body should hash to specific value
        const emptyHash = service.sha256Hash('')
        expect(result['X-Content-Sha256']).toBe(emptyHash)
      })

      it('should generate consistent signatures for same input', () => {
        const params = {
          method: 'POST' as const,
          host: 'open.volcengineapi.com',
          path: '/',
          query: { Action: 'ListModels' },
          headers: {},
          body: '{"test":true}',
          service: 'ark',
          region: 'cn-beijing'
        }

        const credentials = {
          accessKeyId: 'testAccessKey',
          secretAccessKey: 'testSecretKey'
        }

        // Mock Date to ensure consistent timestamp
        const mockDate = new Date('2024-01-01T12:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(mockDate)

        const result1 = service.generateSignature(params, credentials)
        const result2 = service.generateSignature(params, credentials)

        expect(result1.Authorization).toBe(result2.Authorization)
        expect(result1['X-Date']).toBe(result2['X-Date'])
        expect(result1['X-Content-Sha256']).toBe(result2['X-Content-Sha256'])

        vi.useRealTimers()
      })
    })
  })

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
        await expect(service.saveCredentials(mockEvent, '', 'secret')).rejects.toThrow(
          'Access Key ID and Secret Access Key are required'
        )

        await expect(service.saveCredentials(mockEvent, 'key', '')).rejects.toThrow(
          'Access Key ID and Secret Access Key are required'
        )
      })

      it('should throw error when safeStorage is not available', async () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)

        await expect(service.saveCredentials(mockEvent, 'key', 'secret')).rejects.toThrow(
          'Secure storage is not available on this platform'
        )
      })

      it('should create directory if it does not exist', async () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        await service.saveCredentials(mockEvent, 'testAccessKey', 'testSecretKey')

        expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      })
    })

    describe('loadCredentials', () => {
      it('should return null when credentials file does not exist', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        const result = await service.loadCredentials()

        expect(result).toBeNull()
      })

      it('should load and decrypt credentials when file exists', async () => {
        const mockCredentials = {
          accessKeyId: 'testAccessKey',
          secretAccessKey: 'testSecretKey'
        }

        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(`encrypted:${JSON.stringify(mockCredentials)}`)
        )

        const result = await service.loadCredentials()

        expect(result).toEqual(mockCredentials)
        expect(safeStorage.decryptString).toHaveBeenCalled()
      })

      it('should throw error for corrupted credentials file', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('corrupted-data'))
        vi.mocked(safeStorage.decryptString).mockImplementation(() => {
          throw new Error('Decryption failed')
        })

        await expect(service.loadCredentials()).rejects.toThrow(
          'Credentials file exists but could not be loaded'
        )
      })

      it('should throw error for invalid JSON in credentials', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('encrypted:invalid-json'))

        await expect(service.loadCredentials()).rejects.toThrow(
          'Credentials file exists but could not be loaded'
        )
      })
    })

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
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
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
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
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
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
        )

        // Mock both API calls to fail
        vi.mocked(net.fetch).mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Server error'
        } as any)

        await expect(service.listModels(mockEvent)).rejects.toThrow(
          'Failed to fetch both foundation models and endpoints'
        )
      })

      it('should throw error when no credentials are found', async () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false)

        await expect(service.listModels(mockEvent)).rejects.toThrow(
          'No credentials found. Please save credentials first.'
        )
      })
    })

    describe('getAuthHeaders', () => {
      it('should generate auth headers for external use', async () => {
        // Setup credentials
        vi.spyOn(fs, 'existsSync').mockReturnValue(true)
        vi.mocked(fs.promises.readFile).mockResolvedValue(
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
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
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
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
          Buffer.from(
            `encrypted:${JSON.stringify({ accessKeyId: 'test', secretAccessKey: 'test' })}`
          )
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
