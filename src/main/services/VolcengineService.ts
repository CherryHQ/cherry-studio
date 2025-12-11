import { loggerService } from '@logger'
import crypto from 'crypto'
import { app, net, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import * as z from 'zod'

import { getConfigDir } from '../utils/file'

const logger = loggerService.withContext('VolcengineService')

// Configuration constants
const CONFIG = {
  ALGORITHM: 'HMAC-SHA256',
  REQUEST_TYPE: 'request',
  DEFAULT_REGION: 'cn-beijing',
  SERVICE_NAME: 'ark',
  DEFAULT_HEADERS: {
    'content-type': 'application/json',
    accept: 'application/json'
  },
  API_URLS: {
    ARK_HOST: 'open.volcengineapi.com'
  },
  CREDENTIALS_FILE_NAME: '.volcengine_credentials',
  API_VERSION: '2024-01-01',
  DEFAULT_PAGE_SIZE: 100
} as const

// Request schemas
const ListFoundationModelsRequestSchema = z.object({
  PageNumber: z.optional(z.number()),
  PageSize: z.optional(z.number())
})

const ListEndpointsRequestSchema = z.object({
  ProjectName: z.optional(z.string()),
  PageNumber: z.optional(z.number()),
  PageSize: z.optional(z.number())
})

// Response schemas - only keep fields needed for model list
const FoundationModelItemSchema = z.object({
  Name: z.string(),
  DisplayName: z.optional(z.string()),
  Description: z.optional(z.string())
})

const EndpointItemSchema = z.object({
  Id: z.string(),
  Name: z.optional(z.string()),
  Description: z.optional(z.string()),
  ModelReference: z.optional(
    z.object({
      FoundationModel: z.optional(
        z.object({
          Name: z.optional(z.string()),
          ModelVersion: z.optional(z.string())
        })
      ),
      CustomModelId: z.optional(z.string())
    })
  )
})

const ListFoundationModelsResponseSchema = z.object({
  Result: z.object({
    TotalCount: z.number(),
    Items: z.array(FoundationModelItemSchema)
  })
})

const ListEndpointsResponseSchema = z.object({
  Result: z.object({
    TotalCount: z.number(),
    Items: z.array(EndpointItemSchema)
  })
})

// Infer types from schemas
type ListFoundationModelsRequest = z.infer<typeof ListFoundationModelsRequestSchema>
type ListEndpointsRequest = z.infer<typeof ListEndpointsRequestSchema>
type ListFoundationModelsResponse = z.infer<typeof ListFoundationModelsResponseSchema>
type ListEndpointsResponse = z.infer<typeof ListEndpointsResponseSchema>

// ============= Internal Type Definitions =============

interface VolcengineCredentials {
  accessKeyId: string
  secretAccessKey: string
}

interface SignedRequestParams {
  method: 'GET' | 'POST'
  host: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
  service: string
  region: string
}

interface SignedHeaders {
  Authorization: string
  'X-Date': string
  'X-Content-Sha256': string
  Host: string
}

interface ModelInfo {
  id: string
  name: string
  description?: string
  created?: number
}

interface ListModelsResult {
  models: ModelInfo[]
  total?: number
  warnings?: string[]
}

// Custom error class
class VolcengineServiceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'VolcengineServiceError'
  }
}

/**
 * Volcengine API Signing Service
 *
 * Implements HMAC-SHA256 signing algorithm for Volcengine API authentication.
 * Securely stores credentials using Electron's safeStorage.
 */
class VolcengineService {
  private readonly credentialsFilePath: string

  constructor() {
    this.credentialsFilePath = this.getCredentialsFilePath()
  }

  /**
   * Get the path for storing encrypted credentials
   */
  private getCredentialsFilePath(): string {
    const oldPath = path.join(app.getPath('userData'), CONFIG.CREDENTIALS_FILE_NAME)
    if (fs.existsSync(oldPath)) {
      return oldPath
    }
    return path.join(getConfigDir(), CONFIG.CREDENTIALS_FILE_NAME)
  }

  // ============= Cryptographic Helper Methods =============

  /**
   * Calculate SHA256 hash of data and return hex encoded string
   */
  private sha256Hash(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex')
  }

  /**
   * Calculate HMAC-SHA256 and return buffer
   */
  private hmacSha256(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
  }

  /**
   * Calculate HMAC-SHA256 and return hex encoded string
   */
  private hmacSha256Hex(key: Buffer | string, data: string): string {
    return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')
  }

  /**
   * URL encode according to RFC3986
   */
  private uriEncode(str: string, encodeSlash: boolean = true): string {
    if (!str) return ''

    // RFC3986 unreserved: A-Z a-z 0-9 - _ . ~
    // If encodeSlash is false, / is also unencoded
    const pattern = encodeSlash ? /[^A-Za-z0-9_\-.~]/g : /[^A-Za-z0-9_\-.~/]/g
    return str.replace(pattern, (char) => encodeURIComponent(char))
  }

  // ============= Signing Implementation =============

  /**
   * Get current UTC time in ISO8601 format (YYYYMMDD'T'HHMMSS'Z')
   */
  private getIso8601DateTime(): string {
    const now = new Date()
    return now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  }

  /**
   * Get date portion from datetime (YYYYMMDD)
   */
  private getDateFromDateTime(dateTime: string): string {
    return dateTime.substring(0, 8)
  }

  /**
   * Build canonical query string from query parameters
   */
  private buildCanonicalQueryString(query: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) {
      return ''
    }

    return Object.keys(query)
      .sort()
      .map((key) => `${this.uriEncode(key)}=${this.uriEncode(query[key])}`)
      .join('&')
  }

  /**
   * Build canonical headers string
   */
  private buildCanonicalHeaders(headers: Record<string, string>): {
    canonicalHeaders: string
    signedHeaders: string
  } {
    const sortedKeys = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort()

    const canonicalHeaders = sortedKeys.map((key) => `${key}:${headers[key]?.trim() || ''}`).join('\n') + '\n'

    const signedHeaders = sortedKeys.join(';')

    return { canonicalHeaders, signedHeaders }
  }

  /**
   * Create the signing key through a series of HMAC operations
   *
   * kSecret = SecretAccessKey
   * kDate = HMAC(kSecret, Date)
   * kRegion = HMAC(kDate, Region)
   * kService = HMAC(kRegion, Service)
   * kSigning = HMAC(kService, "request")
   */
  private deriveSigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
    const kDate = this.hmacSha256(secretKey, date)
    const kRegion = this.hmacSha256(kDate, region)
    const kService = this.hmacSha256(kRegion, service)
    const kSigning = this.hmacSha256(kService, CONFIG.REQUEST_TYPE)
    return kSigning
  }

  /**
   * Create canonical request string
   *
   * CanonicalRequest =
   *   HTTPRequestMethod + '\n' +
   *   CanonicalURI + '\n' +
   *   CanonicalQueryString + '\n' +
   *   CanonicalHeaders + '\n' +
   *   SignedHeaders + '\n' +
   *   HexEncode(Hash(RequestPayload))
   */
  private createCanonicalRequest(
    method: string,
    canonicalUri: string,
    canonicalQueryString: string,
    canonicalHeaders: string,
    signedHeaders: string,
    payloadHash: string
  ): string {
    return [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  }

  /**
   * Create string to sign
   *
   * StringToSign =
   *   Algorithm + '\n' +
   *   RequestDateTime + '\n' +
   *   CredentialScope + '\n' +
   *   HexEncode(Hash(CanonicalRequest))
   */
  private createStringToSign(dateTime: string, credentialScope: string, canonicalRequest: string): string {
    const hashedCanonicalRequest = this.sha256Hash(canonicalRequest)
    return [CONFIG.ALGORITHM, dateTime, credentialScope, hashedCanonicalRequest].join('\n')
  }

  /**
   * Generate signature for the request
   */
  private generateSignature(params: SignedRequestParams, credentials: VolcengineCredentials): SignedHeaders {
    const { method, host, path: requestPath, query, body, service, region } = params

    // Step 1: Prepare datetime
    const dateTime = this.getIso8601DateTime()
    const date = this.getDateFromDateTime(dateTime)

    // Step 2: Calculate payload hash
    const payloadHash = this.sha256Hash(body || '')

    // Step 3: Prepare headers for signing
    const headersToSign: Record<string, string> = {
      host: host,
      'x-date': dateTime,
      'x-content-sha256': payloadHash,
      'content-type': 'application/json'
    }

    // Step 4: Build canonical components
    const canonicalUri = this.uriEncode(requestPath, false) || '/'
    const canonicalQueryString = this.buildCanonicalQueryString(query)
    const { canonicalHeaders, signedHeaders } = this.buildCanonicalHeaders(headersToSign)

    // Step 5: Create canonical request
    const canonicalRequest = this.createCanonicalRequest(
      method.toUpperCase(),
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash
    )

    // Step 6: Create credential scope and string to sign
    const credentialScope = `${date}/${region}/${service}/${CONFIG.REQUEST_TYPE}`
    const stringToSign = this.createStringToSign(dateTime, credentialScope, canonicalRequest)

    // Step 7: Calculate signature
    const signingKey = this.deriveSigningKey(credentials.secretAccessKey, date, region, service)
    const signature = this.hmacSha256Hex(signingKey, stringToSign)

    // Step 8: Build authorization header
    const authorization = `${CONFIG.ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    return {
      Authorization: authorization,
      'X-Date': dateTime,
      'X-Content-Sha256': payloadHash,
      Host: host
    }
  }

  // ============= Credential Management =============

  /**
   * Save credentials securely using Electron's safeStorage
   */
  public saveCredentials = async (
    _: Electron.IpcMainInvokeEvent,
    accessKeyId: string,
    secretAccessKey: string
  ): Promise<void> => {
    try {
      if (!accessKeyId || !secretAccessKey) {
        throw new VolcengineServiceError('Access Key ID and Secret Access Key are required')
      }

      if (!safeStorage.isEncryptionAvailable()) {
        throw new VolcengineServiceError('Secure storage is not available on this platform')
      }

      const credentials: VolcengineCredentials = { accessKeyId, secretAccessKey }
      const credentialsJson = JSON.stringify(credentials)
      const encryptedData = safeStorage.encryptString(credentialsJson)

      // Ensure directory exists
      const dir = path.dirname(this.credentialsFilePath)
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true })
      }

      await fs.promises.writeFile(this.credentialsFilePath, encryptedData)
      await fs.promises.chmod(this.credentialsFilePath, 0o600) // Read/write for owner only
      logger.info('Volcengine credentials saved successfully')
    } catch (error) {
      logger.error('Failed to save Volcengine credentials:', error as Error)
      throw new VolcengineServiceError('Failed to save credentials', error)
    }
  }

  /**
   * Load credentials from encrypted storage
   * @throws VolcengineServiceError if credentials file exists but is corrupted
   */
  private async loadCredentials(): Promise<VolcengineCredentials | null> {
    if (!fs.existsSync(this.credentialsFilePath)) {
      return null
    }

    try {
      const encryptedData = await fs.promises.readFile(this.credentialsFilePath)
      const decryptedJson = safeStorage.decryptString(Buffer.from(encryptedData))
      return JSON.parse(decryptedJson) as VolcengineCredentials
    } catch (error) {
      logger.error('Failed to load Volcengine credentials:', error as Error)
      throw new VolcengineServiceError(
        'Credentials file exists but could not be loaded. Please re-enter your credentials.',
        error
      )
    }
  }

  /**
   * Check if credentials exist
   */
  public hasCredentials = async (): Promise<boolean> => {
    return fs.existsSync(this.credentialsFilePath)
  }

  /**
   * Clear stored credentials
   */
  public clearCredentials = async (): Promise<void> => {
    try {
      if (fs.existsSync(this.credentialsFilePath)) {
        await fs.promises.unlink(this.credentialsFilePath)
        logger.info('Volcengine credentials cleared')
      }
    } catch (error) {
      logger.error('Failed to clear Volcengine credentials:', error as Error)
      throw new VolcengineServiceError('Failed to clear credentials', error)
    }
  }

  // ============= API Methods =============

  /**
   * Make a signed request to Volcengine API
   */
  private async makeSignedRequest<T>(
    method: 'GET' | 'POST',
    host: string,
    path: string,
    action: string,
    version: string,
    query?: Record<string, string>,
    body?: Record<string, unknown>,
    service: string = CONFIG.SERVICE_NAME,
    region: string = CONFIG.DEFAULT_REGION
  ): Promise<T> {
    const credentials = await this.loadCredentials()
    if (!credentials) {
      throw new VolcengineServiceError('No credentials found. Please save credentials first.')
    }

    const fullQuery: Record<string, string> = {
      Action: action,
      Version: version,
      ...query
    }

    const bodyString = body ? JSON.stringify(body) : ''

    const signedHeaders = this.generateSignature(
      {
        method,
        host,
        path,
        query: fullQuery,
        headers: {},
        body: bodyString,
        service,
        region
      },
      credentials
    )

    // Build URL with query string (use simple encoding for URL, canonical encoding is only for signature)
    const urlParams = new URLSearchParams(fullQuery)
    const url = `https://${host}${path}?${urlParams.toString()}`

    const requestHeaders: Record<string, string> = {
      ...CONFIG.DEFAULT_HEADERS,
      Authorization: signedHeaders.Authorization,
      'X-Date': signedHeaders['X-Date'],
      'X-Content-Sha256': signedHeaders['X-Content-Sha256']
    }

    logger.debug('Making Volcengine API request', { url, method, action })

    try {
      const response = await net.fetch(url, {
        method,
        headers: requestHeaders,
        body: method === 'POST' && bodyString ? bodyString : undefined
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(`Volcengine API error: ${response.status}`, { errorText })
        throw new VolcengineServiceError(`API request failed: ${response.status} - ${errorText}`)
      }

      return (await response.json()) as T
    } catch (error) {
      if (error instanceof VolcengineServiceError) {
        throw error
      }
      logger.error('Volcengine API request failed:', error as Error)
      throw new VolcengineServiceError('API request failed', error)
    }
  }

  /**
   * List foundation models from Volcengine ARK
   */
  private async listFoundationModels(region: string = CONFIG.DEFAULT_REGION): Promise<ListFoundationModelsResponse> {
    const requestBody: ListFoundationModelsRequest = {
      PageNumber: 1,
      PageSize: CONFIG.DEFAULT_PAGE_SIZE
    }

    const response = await this.makeSignedRequest<unknown>(
      'POST',
      CONFIG.API_URLS.ARK_HOST,
      '/',
      'ListFoundationModels',
      CONFIG.API_VERSION,
      {},
      requestBody,
      CONFIG.SERVICE_NAME,
      region
    )

    return ListFoundationModelsResponseSchema.parse(response)
  }

  /**
   * List user-created endpoints from Volcengine ARK
   */
  private async listEndpoints(
    projectName?: string,
    region: string = CONFIG.DEFAULT_REGION
  ): Promise<ListEndpointsResponse> {
    const requestBody: ListEndpointsRequest = {
      ProjectName: projectName || 'default',
      PageNumber: 1,
      PageSize: CONFIG.DEFAULT_PAGE_SIZE
    }

    const response = await this.makeSignedRequest<unknown>(
      'POST',
      CONFIG.API_URLS.ARK_HOST,
      '/',
      'ListEndpoints',
      CONFIG.API_VERSION,
      {},
      requestBody,
      CONFIG.SERVICE_NAME,
      region
    )

    return ListEndpointsResponseSchema.parse(response)
  }

  /**
   * List all available models from Volcengine ARK
   * Combines foundation models and user-created endpoints
   */
  public listModels = async (
    _?: Electron.IpcMainInvokeEvent,
    projectName?: string,
    region?: string
  ): Promise<ListModelsResult> => {
    try {
      const effectiveRegion = region || CONFIG.DEFAULT_REGION
      const [foundationModelsResult, endpointsResult] = await Promise.allSettled([
        this.listFoundationModels(effectiveRegion),
        this.listEndpoints(projectName, effectiveRegion)
      ])

      const models: ModelInfo[] = []
      const warnings: string[] = []

      if (foundationModelsResult.status === 'fulfilled') {
        const foundationModels = foundationModelsResult.value
        for (const item of foundationModels.Result.Items) {
          models.push({
            id: item.Name,
            name: item.DisplayName || item.Name,
            description: item.Description
          })
        }
        logger.info(`Found ${foundationModels.Result.Items.length} foundation models`)
      } else {
        const errorMsg = `Failed to fetch foundation models: ${foundationModelsResult.reason}`
        logger.warn(errorMsg)
        warnings.push(errorMsg)
      }

      // Process endpoints
      if (endpointsResult.status === 'fulfilled') {
        const endpoints = endpointsResult.value
        for (const item of endpoints.Result.Items) {
          const modelRef = item.ModelReference
          const foundationModelName = modelRef?.FoundationModel?.Name
          const modelVersion = modelRef?.FoundationModel?.ModelVersion
          const customModelId = modelRef?.CustomModelId

          let displayName = item.Name || item.Id
          if (foundationModelName) {
            displayName = modelVersion ? `${foundationModelName} (${modelVersion})` : foundationModelName
          } else if (customModelId) {
            displayName = customModelId
          }

          models.push({
            id: item.Id,
            name: displayName,
            description: item.Description
          })
        }
        logger.info(`Found ${endpoints.Result.Items.length} endpoints`)
      } else {
        const errorMsg = `Failed to fetch endpoints: ${endpointsResult.reason}`
        logger.warn(errorMsg)
        warnings.push(errorMsg)
      }

      // If both failed, throw error
      if (foundationModelsResult.status === 'rejected' && endpointsResult.status === 'rejected') {
        throw new VolcengineServiceError('Failed to fetch both foundation models and endpoints')
      }

      const total =
        (foundationModelsResult.status === 'fulfilled' ? foundationModelsResult.value.Result.TotalCount : 0) +
        (endpointsResult.status === 'fulfilled' ? endpointsResult.value.Result.TotalCount : 0)

      logger.info(`Total models found: ${models.length}`)

      return {
        models,
        total,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Failed to list Volcengine models:', error as Error)
      throw new VolcengineServiceError('Failed to list models', error)
    }
  }

  /**
   * Get authorization headers for external use
   * This allows the renderer process to make direct API calls with proper authentication
   */
  public getAuthHeaders = async (
    _: Electron.IpcMainInvokeEvent,
    params: {
      method: 'GET' | 'POST'
      host: string
      path: string
      query?: Record<string, string>
      body?: string
      service?: string
      region?: string
    }
  ): Promise<SignedHeaders> => {
    const credentials = await this.loadCredentials()
    if (!credentials) {
      throw new VolcengineServiceError('No credentials found. Please save credentials first.')
    }

    return this.generateSignature(
      {
        method: params.method,
        host: params.host,
        path: params.path,
        query: params.query || {},
        headers: {},
        body: params.body,
        service: params.service || CONFIG.SERVICE_NAME,
        region: params.region || CONFIG.DEFAULT_REGION
      },
      credentials
    )
  }

  /**
   * Make a generic signed API request
   * This is a more flexible method that allows custom API calls
   */
  public makeRequest = async (
    _: Electron.IpcMainInvokeEvent,
    params: {
      method: 'GET' | 'POST'
      host: string
      path: string
      action: string
      version: string
      query?: Record<string, string>
      body?: Record<string, unknown>
      service?: string
      region?: string
    }
  ): Promise<unknown> => {
    return this.makeSignedRequest(
      params.method,
      params.host,
      params.path,
      params.action,
      params.version,
      params.query,
      params.body,
      params.service || CONFIG.SERVICE_NAME,
      params.region || CONFIG.DEFAULT_REGION
    )
  }
}

export default new VolcengineService()
