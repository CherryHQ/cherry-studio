import type { RuntimeAccountResult, RuntimeLoginRequest } from './account'
import type { PermissionModeCatalog } from './permissionMode'

export interface RuntimeAccountDeclaration {
  readonly canReadAccount?: true
  readonly methods?: readonly RuntimeLoginMethod[]
}

export type RuntimeLoginMethod = { id: string; type: 'agent'; name: string } & (
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

export interface CliPresetInfo {
  id: string
  name: string
  helpUrl: string
  account?: RuntimeAccountDeclaration
  credentialScope?: 'provider'
  retired?: true
  subscriptionUsage?: true
  defaultMode?: PermissionModeCatalog
  modeForLaunch?: (env: Readonly<Record<string, string>>) => PermissionModeCatalog
}

export interface CliModelConfig<Target extends string = string> {
  target: Target
  overrides: readonly string[] | ((platform: string) => readonly string[])
  tool?: string
  field?: string
  nativeSelection?: 'agent'
}

export interface CliPresetOptions<Target extends string = string> extends CliComponent, CliLoginDeclaration {
  placeholderTitle?: RegExp
  terminalArgs?: readonly string[]
  aliases?: readonly string[]
  managedPackage?: string
  nativeCliInstall?: true
  loginArgs?: readonly string[]
  credentialEnvironment?: readonly string[]
  accountProbe?: CliAccountProbe
  terminalCli?: { executable: string; npmPackage?: string; requiredForChat?: true }
  terminalUsesInstalledCli?: true
  args: readonly string[]
  env?: Readonly<Record<string, string>>
  modelConfig?: CliModelConfig<Target>
  modelDependencies?: readonly string[]
  windowsShell?: { variable: string; allowSh: boolean }
  requiredRuntime?: { executable: 'bun'; minimumVersion: string }
}

export type RuntimePreset<Protocol extends string> = CliPresetInfo & { protocol: Protocol }

export type CliPreset<Protocol extends string, Target extends string = string> = RuntimePreset<Protocol> &
  CliPresetOptions<Target>

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

export interface JsonModelProfile<Target extends string = string> {
  format: 'json'
  target: Target
  readModel(document: Record<string, unknown>): string | undefined
  writeModel(
    document: Record<string, unknown>,
    model: string | undefined,
    invalidModel: () => never
  ): [string[], string | undefined][]
}

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
