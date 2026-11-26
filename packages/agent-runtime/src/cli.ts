export interface CliComponent {
  readonly executable: string
  readonly npmPackage?: string
}

export interface CliAuthStatusProbe {
  readonly args: readonly string[]
  readonly includeStderr?: true
  parse(output: string): 'signed-in' | 'signed-out' | 'unknown'
}

export function parseBooleanLoginStatus(output: string, field: string) {
  try {
    const result: unknown = JSON.parse(output)
    if (result && typeof result === 'object') {
      const value: unknown = Reflect.get(result, field)
      if (typeof value === 'boolean') return value ? 'signed-in' : 'signed-out'
    }
  } catch {
    return 'unknown'
  }
  return 'unknown'
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
export {
  AGENT_PERMISSION_MODES,
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
