import type { InputId } from './contracts'

export interface RuntimeCommand {
  /** Command name without its leading slash. */
  name: string
  description: string
  argumentHint: string
  builtin?: boolean
  aliases?: readonly string[]
  subcommands?: readonly string[]
}

export interface RuntimeCommandCatalog<OfflineInput = never> {
  builtinCommands?: readonly RuntimeCommand[]
  liveCatalog?: 'push' | 'query'
  listOffline?(input: OfflineInput): Promise<RuntimeSkillCommand[]>
}

export interface RuntimeCommandInvocation {
  name: string
  args: string
  inputId: InputId
}

export interface RuntimeSkillCommand extends RuntimeCommand {
  skillPath: string
}

export function formatRuntimeCommand({ name, args }: Pick<RuntimeCommandInvocation, 'name' | 'args'>): string {
  return args ? `/${name} ${args}` : `/${name}`
}

export function skillCommand({ name, description, filePath }: { name: string; description: string; filePath: string }) {
  if (!/^[\w-]+$/.test(name)) return
  return { name: `skill:${name}`, description, argumentHint: '', builtin: false, skillPath: filePath }
}

export function buildSkillCommandPrompt(descriptorPath: string, args: string): string {
  const instruction = `Read the Skill instructions at ${JSON.stringify(descriptorPath)} and use them for this request. Resolve any relative Skill files from the directory containing those instructions.`
  return args ? `${instruction}\n\n${args}` : instruction
}
