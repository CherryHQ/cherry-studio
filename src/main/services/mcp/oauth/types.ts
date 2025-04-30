import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import EventEmitter from 'events'
import { z } from 'zod'

export interface OAuthStorageData {
  clientInfo?: OAuthClientInformation
  tokens?: OAuthTokens
  codeVerifier?: string
  lastUpdated: number
}

export const OAuthStorageSchema = z.object({
  clientInfo: z.any().optional(),
  tokens: z.any().optional(),
  codeVerifier: z.string().optional(),
  lastUpdated: z.number()
})

export interface IOAuthStorage {
  getClientInformation(): Promise<OAuthClientInformation | undefined>
  saveClientInformation(info: OAuthClientInformationFull): Promise<void>
  getTokens(): Promise<OAuthTokens | undefined>
  saveTokens(tokens: OAuthTokens): Promise<void>
  getCodeVerifier(): Promise<string>
  saveCodeVerifier(codeVerifier: string): Promise<void>
  clear(): Promise<void>
}

/**
 * OAuth callback server setup options
 */
export interface OAuthCallbackServerOptions {
  /** Port for the callback server */
  port: number
  /** Path for the callback endpoint */
  path: string
  /** Event emitter to signal when auth code is received */
  events: EventEmitter
}

/**
 * Options for creating an OAuth client provider
 */
export interface OAuthProviderOptions {
  /** Server URL to connect to */
  serverUrlHash: string
  /** Port for the OAuth callback server */
  callbackPort?: number
  /** Path for the OAuth callback endpoint */
  callbackPath?: string
  /** Directory to store OAuth credentials */
  configDir?: string
  /** Client name to use for OAuth registration */
  clientName?: string
  /** Client URI to use for OAuth registration */
  clientUri?: string
}
