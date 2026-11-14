import { parseCommandSyntax } from './commandParser'
import { findHeredocConsumer, resolveCommandWords } from './commandSemantics'

export interface ShellCommand {
  /** Basename without `.exe`, lowercased (`C:\Tools\sc.exe` → `sc`). */
  command: string
  /** Arguments after the command word; redirection targets are excluded. */
  args: string[]
  /** Command substitutions found inside the command's words. */
  substitutions: string[]
}

export interface ShellPipeline {
  commands: ShellCommand[]
}

export interface ShellHeredoc {
  consumer?: ShellCommand
  delimiter: string
  body: string
  stripTabs: boolean
  /** A quoted delimiter (`<<'EOF'`) suppresses expansions; an unquoted one still evaluates them. */
  quoted: boolean
  /** The physical line that carried the `<<` operator. */
  line: string
}

export interface ParsedShellCommand {
  pipelines: ShellPipeline[]
  heredocs: ShellHeredoc[]
}

export function resolveCommand(words: readonly string[]): { command: string; args: string[] } | undefined {
  const resolved = resolveCommandWords(words, true)
  return resolved ? { command: resolved.command, args: resolved.args } : undefined
}

export function parseShellCommand(command: string): ParsedShellCommand {
  const parsed = parseCommandSyntax(command, 'bash')
  const pipelines = new Map<string, ShellCommand[]>()
  for (const node of parsed.commands) {
    const stdin = parsed.redirections
      .filter((redirect) => redirect.pipeline === node.pipeline && redirect.operator === '<<<')
      .flatMap((redirect) => (redirect.target ? [redirect.target.value ?? redirect.target.raw] : []))
    const resolved = resolveCommand([...node.words.map((word) => word.value ?? word.raw), ...stdin])
    if (!resolved) continue
    const commands = pipelines.get(node.pipeline) ?? []
    commands.push({ ...resolved, substitutions: node.substitutions })
    pipelines.set(node.pipeline, commands)
  }
  return {
    pipelines: [...pipelines.values()].map((commands) => ({ commands })),
    heredocs: parsed.heredocs.map((heredoc) => {
      const resolved = findHeredocConsumer(parsed, heredoc)
      return {
        ...heredoc,
        ...(resolved
          ? {
              consumer: {
                command: resolved.executable,
                args: resolved.args.map(({ value, raw }) => value ?? raw),
                substitutions: []
              }
            }
          : {})
      }
    })
  }
}
