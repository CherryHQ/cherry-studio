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
