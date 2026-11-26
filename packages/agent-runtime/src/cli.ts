import type { RuntimeAccountResult, RuntimeLoginRequest } from './account'

export interface RuntimeAccountDeclaration {
  readonly canReadAccount?: true
  readonly methods?: readonly RuntimeLoginMethod[]
}

type RuntimeLoginMethod = { id: string; type: 'agent'; name: string } & (
  | { form: 'browser'; clearEnv?: readonly string[] }
  | { form: 'api-key'; apiKey: string }
)

export interface CliAuthOption {
  id: string
  nameKey: string
  hintKey?: string
  kind: 'browser' | 'api-key'
  args: readonly string[]
  autoOpenUrl?: boolean
  recommended?: boolean
}

export interface CliLoginDeclaration {
  cliLogin?: readonly CliAuthOption[]
  providerLogin?: { id: string; args: readonly string[]; suggestions: readonly string[] }
}

export interface CliAuthCommandSpec {
  args: string[]
  stdin?: string
  autoOpenUrl?: boolean
}

export function planCliLogin(
  declaration: CliLoginDeclaration | undefined,
  { methodId, secret, provider }: RuntimeLoginRequest
): CliAuthCommandSpec | undefined {
  const method = declaration?.cliLogin?.find((option) => option.id === methodId)
  if (method) {
    if (method.kind === 'api-key') {
      const apiKey = secret?.trim()
      if (!apiKey) throw new Error('API key is required')
      return { args: [...method.args], stdin: apiKey + '\n' }
    }
    return { args: [...method.args], ...(method.autoOpenUrl && { autoOpenUrl: true }) }
  }
  if (declaration?.providerLogin?.id === methodId) {
    const providerId = provider?.trim()
    if (!providerId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(providerId))
      throw new Error('Valid provider ID is required')
    return { args: [...declaration.providerLogin.args, providerId], autoOpenUrl: true }
  }
  return undefined
}

export interface CliComponent {
  readonly executable: string
  readonly npmPackage?: string
}

export interface CliAccountProbe {
  readonly args: readonly string[]
  readonly stdin?: string
  readonly signedOutExitCode?: number
  parse(output: string, env: Readonly<Record<string, string>>): RuntimeAccountResult
}

export function parseBooleanLoginStatus(output: string, field: string): RuntimeAccountResult {
  try {
    const result: unknown = JSON.parse(output)
    if (result && typeof result === 'object') {
      const value: unknown = Reflect.get(result, field)
      if (typeof value === 'boolean') return { status: value ? 'signed-in' : 'signed-out' }
    }
  } catch {
    return { status: 'unknown' }
  }
  return { status: 'unknown' }
}

export interface InstalledCli<Component extends string = string, Source extends string = string> {
  readonly componentId: Component
  readonly path: string
  readonly source: Source
  readonly version?: string
}

export type CliInstallPlan =
  | { manager: 'npm' | 'uv'; package: string; args: string[] }
  | { manager: 'binary'; version: string; archive: string; cmd: string; sha256?: string }
  | { manager: 'script'; command: string; args: string[] }
export interface CliInstaller {
  executable: string
  script(platform: string, version?: string): Extract<CliInstallPlan, { manager: 'script' }> | undefined
  removal:
    | {
        kind: 'command'
        probe: string[]
        accepts(help: string): boolean
        args: string[]
        fallback: { manager: 'uv'; package: string }
      }
    | { kind: 'file'; identity: RegExp }
}

export {
  AGENT_PERMISSION_MODES,
  hasPermissionModeChoices,
  isAgentFullAccessMode,
  requiresPermissionConfirmation,
  selectedPermissionMode,
  type AgentPermissionMode,
  type PermissionModeApplication,
  type PermissionModeCatalog,
  type PermissionModeChoice
} from './permissionMode'

export interface TomlModelProfile<Target extends string = string> {
  format: 'toml'
  target: Target
  readModel(document: Record<string, unknown>): string | undefined
  writeModel(document: Record<string, unknown>, model: string | undefined): void
}

export function tomlModelField<Target extends string>(target: Target, key: string): TomlModelProfile<Target> {
  return {
    format: 'toml',
    target,
    readModel: (doc) => (typeof doc[key] === 'string' ? doc[key] : undefined),
    writeModel(doc, model) {
      if (model === undefined) delete doc[key]
      else doc[key] = model
    }
  }
}

export function cliConfigRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
