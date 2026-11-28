import {
  type CommandDialect,
  type CommandSemantics,
  resolveInvocationCommands
} from '@main/ai/toolApproval/commandPolicy'

type CommandArgs = CommandSemantics['args']

const FEEDBACK_SUBMISSIONS: Readonly<Record<string, { group: string; actions: readonly string[] }>> = {
  // Aliases: https://cli.github.com/manual/gh_issue_create
  gh: { group: 'issue', actions: ['create', 'new'] },
  // https://github.com/larksuite/cli/blob/main/skills/lark-base/references/lark-base-form-submit.md
  'lark-cli': { group: 'base', actions: ['+form-submit'] }
}
// https://cli.github.com/manual/gh_api
const GH_API_VALUE_OPTIONS = [
  ...['-F', '--field', '-f', '--raw-field', '-H', '--header', '--hostname', '--input', '-q', '--jq'],
  ...['-X', '--method', '-p', '--preview', '-t', '--template', '--cache']
]
const GH_API_PARAMETER = /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)|^-[fF]./
const ISSUE_ENDPOINT = /^\/?repos\/[^/]+\/[^/]+\/issues\/?(?:\?|$)/
const SUBMITTER_NAME = /(?:^|[^\w.-])(?:gh|lark-cli)(?:\.exe)?(?![\w.-])/i

function invokesSubcommand(args: CommandArgs, { group, actions }: { group: string; actions: readonly string[] }) {
  // Option arities are unknown, so a word right after an option may be its value; a dynamic word matches anything.
  return args.some(({ value }, start) => {
    if (value !== undefined && value !== group) return false
    for (let index = start + 1; index < args.length; index++) {
      const word = args[index].value
      if (word === undefined || actions.includes(word)) return true
      if (word.startsWith('-')) continue
      const previous = args[index - 1].value
      if (!previous?.startsWith('-') || previous.includes('=')) return false
    }
    return false
  })
}

function createsIssueThroughApi(args: CommandArgs): boolean {
  const values = args.map(({ value }) => value)
  const apiIndex = values.findIndex((value) => value === undefined || !value.startsWith('-'))
  if (values[apiIndex] !== 'api') return false
  // null: not given; undefined: dynamic.
  let endpoint: string | undefined | null = null
  let method: string | undefined | null = null
  let hasParameters = false
  for (let index = apiIndex + 1; index < values.length; index++) {
    const value = values[index]
    if (value === undefined || !value.startsWith('-')) {
      if (endpoint === null) endpoint = value
      continue
    }
    const [name, attached] = value.split(/=(.*)/s)
    hasParameters ||= GH_API_PARAMETER.test(value)
    if (name === '-X' || name === '--method') method = attached ?? values[++index]
    else if (name.startsWith('-X')) method = name.slice(2)
    else if (attached === undefined && GH_API_VALUE_OPTIONS.includes(name)) index++
  }
  const writes = method === null ? hasParameters : method === undefined || method.toUpperCase() !== 'GET'
  if (!writes || endpoint === null) return false
  if (endpoint === undefined || ISSUE_ENDPOINT.test(endpoint)) return true
  // A mutation read from a file or a dynamic word cannot be inspected.
  return (
    endpoint === 'graphql' &&
    values.some((value) => value === undefined || /createIssue|=@|^--input(?:=|$)/.test(value))
  )
}

function submitsFeedback({ executable, args, inline }: CommandSemantics): boolean {
  // Git Bash and Pi's PowerShell (analyzed as bash) resolve executables case-insensitively on Windows.
  const name = executable.toLowerCase().replace(/\.exe$/, '')
  if (name === 'gh' && createsIssueThroughApi(args)) return true
  const submission = FEEDBACK_SUBMISSIONS[name]
  if (submission && invokesSubcommand(args, submission)) return true
  // Shell code is already resolved into commands; other interpreters' code is only scanned for a submitter name.
  return (
    inline?.code !== undefined && !['bash', 'powershell'].includes(inline.language) && SUBMITTER_NAME.test(inline.code)
  )
}

export async function isFeedbackSubmissionCommand(command: string, dialect: CommandDialect): Promise<boolean> {
  const { commands, complete } = await resolveInvocationCommands(command, dialect)
  if (commands.some(submitsFeedback)) return true
  // An unresolved part may still run a submitter, so its literal name fails closed.
  return !complete && SUBMITTER_NAME.test(command)
}

export function isPermanentDeletionToolName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__')) return false
  const sourceToolName = toolName.split('__').at(-1)?.toLowerCase()
  return ['delete', 'delete_file', 'delete_directory', 'remove_file', 'remove_directory'].includes(sourceToolName ?? '')
}
