import type {
  OAuthClientInformationContext,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from '@modelcontextprotocol/client'
import {
  OAuthClientInformationFullSchema,
  OAuthClientInformationSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
  OpenIdProviderDiscoveryMetadataSchema
} from '@modelcontextprotocol/core'
import type EventEmitter from 'events'
import * as z from 'zod'

const issuerStamp = { issuer: z.string().optional() }
const StoredOAuthClientInformationSchema = z.union([
  OAuthClientInformationFullSchema.extend(issuerStamp),
  OAuthClientInformationSchema.extend(issuerStamp)
])
const StoredOAuthTokensSchema = OAuthTokensSchema.extend(issuerStamp)
const AuthorizationServerMetadataSchema = z.union([OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema])
const OAuthDiscoveryStateSchema: z.ZodType<OAuthDiscoveryState> = z.object({
  authorizationServerUrl: z.string(),
  authorizationServerMetadata: AuthorizationServerMetadataSchema.optional(),
  resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(),
  resourceMetadataUrl: z.string().optional()
})

export const OAuthSecretDataSchema = z.object({
  clientInfoByIssuer: z.record(z.string(), StoredOAuthClientInformationSchema),
  tokensByIssuer: z.record(z.string(), StoredOAuthTokensSchema),
  lastIssuer: z.string().optional(),
  codeVerifier: z.string().optional(),
  state: z.string().optional()
})
export type OAuthSecretData = z.infer<typeof OAuthSecretDataSchema>

export const OAuthStorageSchema = z.object({
  encryptedCredentials: z.string().optional(),
  discoveryState: OAuthDiscoveryStateSchema.optional(),
  lastUpdated: z.number()
})
export type OAuthStorageData = z.infer<typeof OAuthStorageSchema>

export const LegacyOAuthStorageSchema = z.object({
  clientInfo: StoredOAuthClientInformationSchema.optional(),
  tokens: StoredOAuthTokensSchema.optional(),
  codeVerifier: z.string().optional()
})

export interface IOAuthStorage {
  getClientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined>
  saveClientInformation(
    info: StoredOAuthClientInformation | undefined,
    ctx?: OAuthClientInformationContext
  ): Promise<void>
  getTokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined>
  saveTokens(tokens: StoredOAuthTokens | undefined, ctx?: OAuthClientInformationContext): Promise<void>
  getCodeVerifier(): Promise<string>
  saveCodeVerifier(codeVerifier: string): Promise<void>
  getState(): Promise<string | undefined>
  saveState(state: string | undefined): Promise<void>
  getDiscoveryState(): Promise<OAuthDiscoveryState | undefined>
  saveDiscoveryState(state: OAuthDiscoveryState | undefined): Promise<void>
  clear(scope?: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void>
}

export interface OAuthCallbackServerOptions {
  port: number
  path: string
  events: EventEmitter
}

export interface OAuthProviderOptions {
  serverUrlHash: string
  callbackPort?: number
  callbackPath?: string
  configDir?: string
  clientName?: string
  clientUri?: string
}
