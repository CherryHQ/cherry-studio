export interface CodexCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
  builtin: boolean
}

type CommandResult = string | { prompt: string } | { running: true }

export interface CommandDefinition<Session, Turn> extends Pick<CodexCommand, 'name' | 'description' | 'aliases'> {
  /** Omit for exact, argument-free commands such as /clear. */
  available?(session: Session): boolean
  argumentHint?: string
  run(session: Session, turn: Turn, args: string): CommandResult | Promise<CommandResult>
}

export function findCodexCommand<S, T>(definitions: readonly CommandDefinition<S, T>[], name: string) {
  return definitions.find((command) => {
    const spelling = command.argumentHint !== undefined ? name.toLowerCase() : name
    return command.name === spelling || command.aliases?.includes(spelling)
  })
}
