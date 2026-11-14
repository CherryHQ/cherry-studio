import path from 'node:path'

import { loggerService } from '@logger'
import { detectDestructiveAssistantCommand } from '@main/ai/agents/builtin/assistantCommandSafety'
import { t } from '@main/i18n'

import bundledPolicy from './command-policy.json'
import {
  initializeCommandParser,
  MAX_COMMAND_NESTING,
  parseCommandSyntax,
  type CommandAnalysis,
  type CommandDialect,
  type CommandRange
} from './commandParser'
import { commandPolicySchema, type CommandPolicyRule, type CommandSelector } from './commandPolicySchema'
import {
  canonicalOption,
  discardsGitWorktree,
  findHeredocConsumer,
  interpretCommand,
  type CommandSemantics
} from './commandSemantics'

export interface CommandPolicyInput {
  command: string
  dialect: string
  cwd?: string
  builtinRoles?: readonly string[]
}
export interface CommandPolicyHit {
  ruleId: string
  reasonCode: CommandPolicyRule['reasonCode']
  evidence: string
  range?: CommandRange
}
export interface CommandPolicyDecision {
  effect: 'allow' | 'ask' | 'deny'
  revision: string
  hits: CommandPolicyHit[]
  reason?: string
}

const logger = loggerService.withContext('CommandPolicy')
const defaultSnapshot = commandPolicySchema.safeParse(bundledPolicy)
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash'])
const INTERPRETERS = new Set([
  ...SHELLS,
  'node',
  'nodejs',
  'python',
  'python3',
  'py',
  'powershell',
  'pwsh',
  'ruby',
  'perl'
])

const ruleReasons = {
  'builtin-destructive-command': () => t('command_approval.builtin-destructive-command'),
  'container-removal': () => t('command_approval.container-removal'),
  'disk-operation': () => t('command_approval.disk-operation'),
  'download-to-shell': () => t('command_approval.download-to-shell'),
  'find-deletion': () => t('command_approval.find-deletion'),
  'forced-overwrite': () => t('command_approval.forced-overwrite'),
  'git-discard-worktree': () => t('command_approval.git-discard-worktree'),
  'git-executable-configuration': () => t('command_approval.git-executable-configuration'),
  'git-force-push': () => t('command_approval.git-force-push'),
  'git-refspec-rewrite': () => t('command_approval.git-refspec-rewrite'),
  'home-path': () => t('command_approval.home-path'),
  'inline-interpreter': () => t('command_approval.inline-interpreter'),
  'mass-process-termination': () => t('command_approval.mass-process-termination'),
  'package-publish': () => t('command_approval.package-publish'),
  'permanent-deletion': () => t('command_approval.permanent-deletion'),
  'privilege-escalation': () => t('command_approval.privilege-escalation'),
  'recursive-permissions': () => t('command_approval.recursive-permissions'),
  'service-mutation': () => t('command_approval.service-mutation'),
  truncation: () => t('command_approval.truncation')
} satisfies Record<CommandPolicyRule['reasonCode'], () => string>

export function matchesCommandSelector(selector: CommandSelector, command: CommandSemantics): boolean {
  if (!selector.executables.includes(command.executable)) return false
  if (selector.subcommands?.some((part, index) => command.subcommands[index] !== part)) return false
  const has = (option: string) => command.options.has(canonicalOption(command, option))
  return (
    (!selector.options?.allOf || selector.options.allOf.every(has)) &&
    (!selector.options?.anyOf || selector.options.anyOf.some(has)) &&
    (!selector.options?.noneOf || !selector.options.noneOf.some(has))
  )
}

function appendSource(
  analysis: CommandAnalysis,
  text: string,
  dialect: CommandDialect,
  depth: number,
  origin?: CommandRange,
  cwd?: string
): CommandSemantics[] {
  const source = analysis.sources.length
  analysis.sources.push({ text, dialect, ...(origin ? { origin } : {}) })
  if (depth > MAX_COMMAND_NESTING || source >= 64) {
    analysis.diagnostics.push({ reason: 'nesting-limit', range: origin ?? { start: 0, end: text.length, source } })
    return []
  }
  const parsed = parseCommandSyntax(text, dialect, source)
  analysis.redirections.push(...parsed.redirections)
  analysis.heredocs.push(...parsed.heredocs)
  analysis.diagnostics.push(...parsed.diagnostics)
  const commands: CommandSemantics[] = []
  for (const node of parsed.commands) {
    node.id = analysis.commands.length
    analysis.commands.push(node)
    const command = interpretCommand(node)
    if (!command) {
      const [name, ...args] = node.words.map(({ value }) => value)
      const inspection =
        (['command', 'builtin'].includes(name ?? '') && ['-v', '-V'].includes(args[0] ?? '')) ||
        (name === 'env' &&
          args.every(
            (value) =>
              value !== undefined &&
              (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value) || ['-i', '--ignore-environment', '-0', '--null'].includes(value))
          )) ||
        (args.length === 0 && ['command', 'builtin'].includes(name ?? ''))
      if (!inspection) analysis.diagnostics.push({ reason: 'unresolved-wrapper', range: node.range })
      continue
    }
    command.workingDirectory = cwd
    for (const wrapper of command.wrappers)
      if (wrapper.directory !== undefined && cwd) command.workingDirectory = path.resolve(cwd, wrapper.directory)
    if (command.executable === 'cd' && node.controls.length === 0) {
      const target = command.args[0]?.value
      if (target !== undefined && cwd) cwd = path.resolve(cwd, target)
      else analysis.diagnostics.push({ reason: 'dynamic-directory', range: node.range })
    }
    commands.push(command)
    if (command.incomplete) analysis.diagnostics.push({ reason: 'incomplete-command', range: node.range })
    if (command.inline?.code !== undefined && ['bash', 'powershell'].includes(command.inline.language))
      commands.push(
        ...appendSource(
          analysis,
          command.inline.code,
          command.inline.language as CommandDialect,
          depth + 1,
          command.inline.word.range,
          command.workingDirectory
        )
      )
  }
  for (const heredoc of parsed.heredocs) {
    const resolved = findHeredocConsumer(parsed, heredoc)
    const consumer = resolved && commands.find(({ node }) => node === resolved.node)
    if (
      !consumer ||
      !INTERPRETERS.has(consumer.executable) ||
      consumer.args.some(({ value }) => value !== undefined && value !== '-' && !value.startsWith('-'))
    )
      continue
    consumer.inline = {
      language: SHELLS.has(consumer.executable) ? 'bash' : consumer.executable,
      code: heredoc.body,
      word: { raw: heredoc.body, value: heredoc.body, quoted: heredoc.quoted, range: heredoc.range }
    }
    if (consumer.inline.language === 'bash' || consumer.inline.language === 'powershell')
      commands.push(
        ...appendSource(
          analysis,
          heredoc.body,
          consumer.inline.language,
          depth + 1,
          heredoc.range,
          consumer.workingDirectory
        )
      )
  }
  for (const command of commands.filter(({ executable }) => SHELLS.has(executable))) {
    if (command.inline) continue
    const redirect = parsed.redirections.find(({ pipeline }) => pipeline === command.node.pipeline)
    if (redirect?.operator === '<<<' && redirect.target?.value !== undefined) {
      command.inline = { language: 'bash', code: redirect.target.value, word: redirect.target }
      commands.push(
        ...appendSource(analysis, redirect.target.value, 'bash', depth + 1, redirect.range, command.workingDirectory)
      )
    } else if (
      redirect ||
      commands.some((other) => other !== command && other.node.pipeline === command.node.pipeline)
    ) {
      analysis.diagnostics.push({ reason: 'unresolved-interpreter-input', range: command.node.range })
    }
  }
  return commands
}

function matchesDetector(
  name: string,
  command: CommandSemantics,
  commands: readonly CommandSemantics[],
  analysis: CommandAnalysis
): boolean {
  const executable = command.executable
  const args = command.args.map(({ value, raw }) => value ?? raw)
  switch (name) {
    case 'find-deletion': {
      if (!['find', 'fd'].includes(executable)) return false
      const valueOptions = new Set([
        '-name',
        '-iname',
        '-path',
        '-ipath',
        '-regex',
        '-iregex',
        '-type',
        '-size',
        '-user',
        '-group',
        '-maxdepth',
        '-mindepth'
      ])
      for (let index = 0; index < args.length; index++) {
        if (valueOptions.has(args[index])) {
          index++
          continue
        }
        if (args[index] === '-delete') return true
        if (
          ['-exec', '-execdir', '-x', '--exec'].includes(args[index]) &&
          ['rm', 'unlink', 'shred'].includes(args[index + 1])
        )
          return true
      }
      return false
    }
    case 'disk-operation':
      return ['dd', 'mkfs', 'diskutil', 'fdisk', 'parted'].includes(executable) || executable.startsWith('mkfs.')
    case 'git-refspec-rewrite':
      return (
        executable === 'git' &&
        command.subcommands[0] === 'push' &&
        (command.options.has('--mirror') ||
          command.options.has('--delete') ||
          command.options.has('-d') ||
          command.operands.some((operand) => operand.startsWith('+') || operand.startsWith(':')))
      )
    case 'git-discard-worktree':
      return discardsGitWorktree(command)
    case 'mass-process-termination':
      return (
        ['killall', 'pkill'].includes(executable) ||
        (executable === 'kill' && args.includes('-9') && args.includes('-1'))
      )
    case 'service-mutation': {
      if (!['launchctl', 'systemctl', 'crontab', 'service'].includes(executable)) return false
      const operation =
        executable === 'service'
          ? args.filter((arg) => !arg.startsWith('-'))[1]
          : (command.subcommands[0] ?? args.find((arg) => !arg.startsWith('-')))
      return !operation || !/^(?:status|list[\w-]*|show|is-[\w-]+|cat|print)$/.test(operation)
        ? !command.options.has('-l') && !command.options.has('--status-all')
        : false
    }
    case 'container-removal': {
      if (!['docker', 'podman'].includes(executable)) return false
      const [group, operation] = command.subcommands
      if (['rm', 'rmi', 'prune'].includes(group)) return true
      return (
        ['system', 'container', 'image', 'volume', 'network', 'builder'].includes(group) &&
        ['rm', 'prune'].includes(operation)
      )
    }
    case 'home-path': {
      const words = [
        ...command.node.words,
        ...analysis.redirections
          .filter(({ pipeline }) => pipeline === command.node.pipeline)
          .flatMap(({ target }) => (target ? [target] : []))
      ]
      return words.some(
        ({ raw, quoted, value }) =>
          (!quoted && raw.startsWith('~/')) ||
          (value === undefined && !raw.startsWith("'") && /\$(?:HOME|\{HOME\})\//.test(raw))
      )
    }
    case 'privilege-escalation':
      return command.elevated
    case 'download-to-shell':
      return (
        INTERPRETERS.has(executable) &&
        commands.some(
          (other) => other.node.pipeline === command.node.pipeline && ['curl', 'wget'].includes(other.executable)
        )
      )
    case 'inline-interpreter':
      return command.inline !== undefined
    case 'git-executable-configuration': {
      if (executable !== 'git') return false
      if (command.gitGlobalOptions.has('--exec-path') || command.gitGlobalOptions.has('--config-env')) return true
      if (
        [...command.node.words, ...(command.node.assignments ?? [])].some(({ raw }) =>
          /^(?:GIT_SSH_COMMAND|GIT_CONFIG(?:_[A-Z_]+)?)=/.test(raw)
        )
      )
        return true
      return command.gitConfigurations.some((config) =>
        /^(?:alias\.[^=]+=!|core\.(?:sshcommand|hookspath|pager|editor)=|diff\.external=|credential\.helper=|filter\.[^.]+\.(?:clean|smudge|process)=|pager\.)/i.test(
          config
        )
      )
    }
    default:
      return false
  }
}

function applies(rule: CommandPolicyRule, roles: readonly string[]): boolean {
  return !rule.appliesTo || rule.appliesTo.builtinRoles.some((role) => roles.includes(role))
}

/** Folds the whole invocation before callers may execute any constituent command. */
export async function evaluateCommandPolicy(
  input: CommandPolicyInput,
  document: unknown = bundledPolicy
): Promise<CommandPolicyDecision> {
  const snapshot = document === bundledPolicy ? defaultSnapshot : commandPolicySchema.safeParse(document)
  if (!snapshot.success) {
    logger.error('Invalid command policy snapshot', { issues: snapshot.error.issues })
    return { effect: 'deny', revision: 'invalid', hits: [], reason: t('command_approval.configuration_error') }
  }
  const { revision, rules } = snapshot.data
  if (input.dialect !== 'bash' && input.dialect !== 'powershell')
    return { effect: 'ask', revision, hits: [], reason: t('command_approval.incomplete') }
  try {
    await initializeCommandParser()
    const analysis: CommandAnalysis = { sources: [], commands: [], redirections: [], heredocs: [], diagnostics: [] }
    const commands = appendSource(analysis, input.command, input.dialect, 0, undefined, input.cwd)
    const hits: (CommandPolicyHit & { effect: 'ask' | 'deny' })[] = []
    for (const rule of rules) {
      if (!applies(rule, input.builtinRoles ?? [])) continue
      if (rule.selector.kind === 'detector' && rule.selector.name === 'builtin-destructive-command') {
        const dangerous = commands.find((command) =>
          detectDestructiveAssistantCommand(
            [command.executable, ...command.args.map(({ value, raw }) => value ?? raw)]
              .map((value) => `'${value.replace(/'/g, "'\\''")}'`)
              .join(' ')
          )
        )
        if (dangerous) {
          hits.push({
            effect: rule.effect,
            ruleId: rule.id,
            reasonCode: rule.reasonCode,
            evidence: dangerous.node.raw.slice(0, 2048),
            range: dangerous.node.range
          })
          continue
        }

        for (const [source, entry] of analysis.sources.entries()) {
          const script =
            entry.dialect === 'powershell' ? `powershell -Command '${entry.text.replace(/'/g, "'\\''")}'` : entry.text
          if (detectDestructiveAssistantCommand(script)) {
            hits.push({
              effect: rule.effect,
              ruleId: rule.id,
              reasonCode: rule.reasonCode,
              evidence: entry.text.slice(0, 2048),
              range: entry.origin ?? { start: 0, end: entry.text.length, source }
            })
            break
          }
        }
        continue
      }
      const command = commands.find((candidate) =>
        rule.selector.kind === 'command'
          ? matchesCommandSelector(rule.selector, candidate)
          : matchesDetector(rule.selector.name, candidate, commands, analysis)
      )
      if (!command && rule.selector.kind === 'detector' && rule.selector.name === 'home-path') {
        const redirect = analysis.redirections.find(
          ({ target }) =>
            target &&
            ((!target.quoted && target.raw.startsWith('~/')) ||
              (target.value === undefined && !target.raw.startsWith("'") && /\$(?:HOME|\{HOME\})\//.test(target.raw)))
        )
        if (redirect)
          hits.push({
            effect: rule.effect,
            ruleId: rule.id,
            reasonCode: rule.reasonCode,
            evidence: redirect.raw,
            range: redirect.range
          })
      }
      if (command)
        hits.push({
          effect: rule.effect,
          ruleId: rule.id,
          reasonCode: rule.reasonCode,
          evidence: command.node.raw.slice(0, 2048),
          range: command.node.range
        })
    }
    const effect = hits.some((hit) => hit.effect === 'deny')
      ? 'deny'
      : hits.length || analysis.diagnostics.length
        ? 'ask'
        : 'allow'
    const relevant = hits.filter((hit) => hit.effect === effect)
    return {
      effect,
      revision,
      hits: relevant.map(({ ruleId, reasonCode, evidence, range }) => ({ ruleId, reasonCode, evidence, range })),
      ...(effect !== 'allow'
        ? {
            reason: relevant.length
              ? relevant.map(({ reasonCode }) => ruleReasons[reasonCode]()).join('; ')
              : t('command_approval.incomplete')
          }
        : {})
    }
  } catch (error) {
    logger.error('Command policy could not analyze an invocation', error as Error)
    return { effect: 'deny', revision, hits: [], reason: t('command_approval.configuration_error') }
  }
}
