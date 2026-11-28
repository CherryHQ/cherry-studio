import type { Document } from 'yaml'

import {
  cliConfigRecord as acpConfigRecord,
  type CliPreset,
  type JsonModelProfile
} from '@cherrystudio/agent-runtime/cli'

import type { AcpPermissionModes } from './permissionMode'

export { acpConfigRecord }
export { tomlModelField, type TomlModelProfile } from '@cherrystudio/agent-runtime/cli'

export type { PermissionModeCatalog } from '@cherrystudio/agent-runtime/cli'
export type { AcpPermissionModes } from './permissionMode'

export type AcpEnv = Record<string, string | undefined>
export type AcpLaunch = { args: string[]; env: Record<string, string>; nativeModel?: string }

export type AcpGatewayModelEndpoint = 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages'

export interface AcpGatewayModel {
  baseUrl: string
  apiKey: string
  model: string
}

type AcpLoginMethod = { id: string; name: string } & (
  | { form: 'browser' | 'enterprise' }
  | { form: 'api-key'; apiKey: string }
  | { form: 'cloud'; apiKey: string; project: string; location: string }
)

export interface AcpLoginProfile {
  catalogRequiresLogin?: true
  methods: readonly AcpLoginMethod[]
}

export interface AcpCliOptions {
  accountArgs?: readonly string[]
  auth?: AcpLoginProfile
  gatewayModelEndpoint?: AcpGatewayModelEndpoint
  gatewayProviderId?: string
  modelEndpoints?: readonly (AcpGatewayModelEndpoint | 'google-generate-content')[]
  minimumAcpVersion?: string
  registryId?: string
  permissionMode?: AcpPermissionModes
  legacyModes?: 'effort'
  /** ACP methods that rely on credentials configured outside the login flow. */
  externalCredentialMethods?: readonly string[]
}

export type AcpCliPreset<Target extends string = string> = CliPreset<'acp', Target> & AcpCliOptions

export interface AcpModelSelection {
  model?: string
  allowUnlisted?: true
  implicit?: string
}

export interface AcpJsonModelProfile<Target extends string = string> extends JsonModelProfile<Target> {
  relatedTarget?: Target
  matchesEnvironment?(get: (key: string) => string | undefined, shell: (key: string) => string | undefined): boolean
  launch?(
    document: Record<string, unknown>,
    env: Record<string, string>,
    get: (key: string) => string | undefined,
    related: Record<string, unknown> | undefined,
    purpose: 'chat' | 'models'
  ): string | undefined
}

export function jsonModelField<Target extends string>(target: Target, ...path: string[]): AcpJsonModelProfile<Target> {
  return {
    format: 'json',
    target,
    readModel(document) {
      const value = path.reduce<unknown>((item, key) => acpConfigRecord(item)?.[key], document)
      return typeof value === 'string' && value ? value : undefined
    },
    writeModel: (_doc, model) => [[path, model]]
  }
}

export type AcpYamlModelProfile<Target extends string = string> = {
  format: 'yaml'
  target: Target
  launch?(
    doc: Document,
    env: Record<string, string>,
    purpose: 'chat' | 'models',
    invalidConfig: () => never
  ): string | undefined
} & (
  | {
      path:
        | readonly string[]
        | {
            read(doc: Document): readonly string[]
            write(doc: Document): readonly string[]
          }
    }
  | {
      readModel(doc: Document): string | undefined
      writeModel(doc: Document, model: string | undefined): void
    }
)

export function acpGatewayPath(api: unknown) {
  if (api === 'anthropic' || api === 'anthropic_messages' || api === 'anthropic-messages') return '/v1/messages'
  return api === 'responses' || api === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions'
}

export interface AcpHostBinary {
  executable: string
  label: string
  envKey: string
  resolve(
    env: Record<string, string>,
    host: {
      windows: boolean
      home(): string
      find(name: string): Promise<string | null | undefined>
      installed(): Promise<string | undefined>
      isFile(file: string): Promise<boolean>
    }
  ): Promise<string | undefined>
}
