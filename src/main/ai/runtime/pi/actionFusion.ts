/**
 * Action Fusion — fuse a file mutation and its follow-up command into one turn.
 *
 * Base rollouts repeat the same pair of turns: edit or write a file, then run
 * a command to test, build, or start it. This extension replaces the built-in
 * `edit` and `write` tools with versions that accept an optional `then_run`
 * object, apply the mutation, run the command, and return one combined
 * observation — the model decision between the two turns disappears. The
 * mechanism is ported from NVlabs/SoL-Pi (MIT), including the hash-before-
 * command interference check and the per-file queue that serializes fused
 * operations on one canonical path.
 *
 * Cherry adaptation: pi's `tool_call` hook never fires for programmatic
 * nested execution, so a fused command would silently bypass the permission
 * modes. The fused command is therefore routed through the SAME authorization
 * boundary as nested code-mode calls (`createPiToolAuthorizer`); a denial
 * appends a `then_run:blocked` note to the (successful) mutation result
 * instead of failing the whole call.
 */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  AgentToolResult,
  BashToolOptions,
  ExtensionFactory,
  ExtensionToolContext
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import type { PiToolAuthorizer } from './approvalExtension'
import type { loadPiSdk } from './piSdk'

/** Structural shape the fused runner needs from a bash tool definition. */
interface FusedBashTool {
  execute: (
    toolCallId: string,
    input: ThenRunInput,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionToolContext
  ) => Promise<AgentToolResult<unknown>>
}

export const THEN_RUN_SUCCEEDED = '[then_run:succeeded]'
export const THEN_RUN_FAILED = '[then_run:failed]'
export const THEN_RUN_BLOCKED = '[then_run:blocked]'
export const THEN_RUN_SKIPPED = '[then_run:skipped]'

export interface ThenRunInput {
  command: string
  timeout?: number
}

const EDIT_THEN_RUN_DESCRIPTION =
  'Command to run next on this file after the edit succeeds — e.g. run, build, start/restart, install, or check it; optional timeout in seconds. Skipped if the edit fails; a non-zero exit is reported but keeps the edit.'
const WRITE_THEN_RUN_DESCRIPTION =
  'Command to run next on this file after the write succeeds — e.g. run, build, start/restart, install, or check it; optional timeout in seconds. Skipped if the write fails; a non-zero exit is reported but keeps the write.'

type PiSdk = Awaited<ReturnType<typeof loadPiSdk>>

export interface PiActionFusionOptions {
  /** Session workspace root; the fused bash tool resolves relative commands against it. */
  workspacePath: string
  /** Cherry's managed bash contract (PATH prefix, Git Bash shell, spawn hook) — the fused command must run under the same environment as the regular bash tool. */
  bashToolOptions?: BashToolOptions
  /** Nested-call authorization boundary, built from the session's approval context. */
  authorize: PiToolAuthorizer
  /** Pause outer execution accounting while the user decides this nested call. */
  onApprovalPending?: () => () => void
}

// ---------------------------------------------------------------- per-file fusion queue

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu
const WINDOWS_SHELL_DRIVE = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i

const queueTails = new Map<string, Promise<void>>()

function normalizeToolPath(filePath: string): string {
  const normalized = filePath.replace(UNICODE_SPACES, ' ')
  return normalized.startsWith('@') ? normalized.slice(1) : normalized
}

/**
 * Git Bash, MSYS, Cygwin, and WSL hand pi paths like `/c/src/app.ts`. On
 * Windows pi's built-in mutation tools convert those to a native drive path
 * before touching the filesystem, so the queue and hash guard must convert
 * them the same way or they address a file the mutation never wrote.
 */
export function normalizeWindowsShellPath(filePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return filePath
  if (!filePath.startsWith('/') || filePath.startsWith('//') || filePath.includes('\\')) return filePath
  const match = WINDOWS_SHELL_DRIVE.exec(filePath)
  if (!match?.[1]) return filePath
  return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll('/', '\\') ?? ''}`
}

/** Resolve a raw tool `path` the same way pi's mutation tools do, for queue keys and hash checks. */
export function resolveFusionPath(cwd: string, filePath: string): string {
  const stripped = normalizeWindowsShellPath(normalizeToolPath(filePath))
  // pi accepts file URLs; the queue and hash guard must use the same target.
  const expanded = stripped.startsWith('file://') ? fileURLToPath(stripped) : stripped
  if (expanded === '~') return homedir()
  if (expanded.startsWith('~/') || (process.platform === 'win32' && expanded.startsWith('~\\'))) {
    return resolve(homedir(), expanded.slice(2))
  }
  return resolve(cwd, expanded)
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR')
  )
}

async function canonicalQueueKey(filePath: string): Promise<string> {
  const resolvedPath = resolve(filePath)
  let current = resolvedPath
  const missingSegments: string[] = []
  for (;;) {
    try {
      return resolve(await realpath(current), ...missingSegments)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
      const parent = dirname(current)
      if (parent === current) return resolvedPath
      missingSegments.unshift(basename(current))
      current = parent
    }
  }
}

/**
 * Serialize fused operations for one canonical file path. This queue belongs
 * to the fusion extension and intentionally does not nest pi's built-in
 * mutation queue.
 */
export async function withFusedFileQueue<T>(filePath: string, work: () => Promise<T>): Promise<T> {
  const key = await canonicalQueueKey(filePath)
  const previous = queueTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const owned = new Promise<void>((resolveOwned) => {
    release = resolveOwned
  })
  const tail = previous.then(() => owned)
  queueTails.set(key, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (queueTails.get(key) === tail) queueTails.delete(key)
  }
}

// ---------------------------------------------------------------- mutation + then_run

export function createThenRunSchema(description: string) {
  return Type.Optional(
    Type.Object(
      {
        command: Type.String({ description: 'Bash command to run' }),
        timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (optional, no default timeout)' }))
      },
      { description }
    )
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function thenRunSkippedError(error: unknown): Error {
  return new Error(
    `${errorText(error)}\n\n${THEN_RUN_SKIPPED} The file mutation did not complete successfully; the command was not run.`
  )
}

async function fileSha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

export async function assertUnchangedBeforeCommand(
  path: string,
  yieldForInterference: () => Promise<void> = () => new Promise<void>((resolve) => setImmediate(resolve))
): Promise<void> {
  try {
    const mutationHash = await fileSha256(path)
    await yieldForInterference()
    const commandHash = await fileSha256(path)
    if (mutationHash !== commandHash) {
      throw new Error('target content changed after the fused mutation')
    }
  } catch (error) {
    throw new Error(`${THEN_RUN_SKIPPED} ${errorText(error)}; the command was not run.`)
  }
}

/**
 * Apply a file mutation and, when the model asked for one, run its follow-up
 * command before returning a single observation.
 *
 * Both steps run inside one fusion queue slot for `absolutePath`, so another
 * fused mutation of the same file cannot interleave. Pi's built-in mutation
 * tool keeps its own queue; the two queues are not nested.
 */
export async function executeMutationThenRun<TDetails>({
  toolCallId,
  absolutePath,
  thenRun,
  mutate,
  bash,
  authorize,
  onApprovalPending,
  signal,
  ctx
}: {
  toolCallId: string
  absolutePath: string
  thenRun: ThenRunInput | undefined
  mutate: () => Promise<AgentToolResult<TDetails>>
  bash: FusedBashTool
  authorize: PiToolAuthorizer
  onApprovalPending?: () => () => void
  signal: AbortSignal | undefined
  ctx: ExtensionToolContext
}): Promise<AgentToolResult<TDetails>> {
  return withFusedFileQueue(absolutePath, async () => {
    let mutationResult: AgentToolResult<TDetails>
    try {
      mutationResult = await mutate()
    } catch (error) {
      if (thenRun !== undefined) {
        throw thenRunSkippedError(error)
      }
      throw error
    }

    if (thenRun === undefined) {
      return mutationResult
    }

    await assertUnchangedBeforeCommand(absolutePath)

    // The nested command must pass the same gate as a model-issued bash call:
    // without this, a fused command would run unapproved in every mode.
    const decision = await authorize({
      toolName: 'bash',
      toolCallId: `${toolCallId}:then_run`,
      input: { command: thenRun.command },
      signal,
      onApprovalPending
    })
    if (decision) {
      return {
        ...mutationResult,
        content: [...mutationResult.content, { type: 'text', text: `${THEN_RUN_BLOCKED} ${decision.reason}` }]
      }
    }

    try {
      const bashResult = await bash.execute(`${toolCallId}:then_run`, thenRun, signal, undefined, ctx)
      const output = resultText(bashResult)
      return {
        ...mutationResult,
        content: [
          ...mutationResult.content,
          { type: 'text', text: output ? `${THEN_RUN_SUCCEEDED}\n${output}` : THEN_RUN_SUCCEEDED }
        ]
      }
    } catch (error) {
      const mutationOutput = resultText(mutationResult)
      throw new Error([mutationOutput, THEN_RUN_FAILED, errorText(error)].filter(Boolean).join('\n\n'))
    }
  })
}

// ---------------------------------------------------------------- extension

export function createPiActionFusionExtension(piSdk: PiSdk, options: PiActionFusionOptions): ExtensionFactory {
  const baseEdit = piSdk.createEditToolDefinition(options.workspacePath)
  const baseWrite = piSdk.createWriteToolDefinition(options.workspacePath)
  const bash = piSdk.createBashToolDefinition(options.workspacePath, options.bashToolOptions)
  const authorize = options.authorize

  return (pi) => {
    const editParameters = Type.Object({
      ...baseEdit.parameters.properties,
      then_run: createThenRunSchema(EDIT_THEN_RUN_DESCRIPTION)
    })
    const writeParameters = Type.Object({
      ...baseWrite.parameters.properties,
      then_run: createThenRunSchema(WRITE_THEN_RUN_DESCRIPTION)
    })

    const fusedExecute = <TDetails>(
      mutate: () => Promise<AgentToolResult<TDetails>>,
      path: unknown,
      thenRun: ThenRunInput | undefined,
      toolCallId: string,
      signal: AbortSignal | undefined,
      ctx: ExtensionToolContext
    ) =>
      executeMutationThenRun({
        toolCallId,
        absolutePath: resolveFusionPath(options.workspacePath, path as string),
        thenRun,
        mutate,
        bash,
        authorize,
        onApprovalPending: options.onApprovalPending,
        signal,
        ctx
      })

    pi.registerTool({
      ...baseEdit,
      parameters: editParameters,
      async execute(toolCallId, input, signal, onUpdate, ctx) {
        const { then_run, ...editInput } = input as typeof input & { then_run?: ThenRunInput }
        return fusedExecute(
          () => baseEdit.execute(toolCallId, editInput, signal, onUpdate, ctx),
          (input as { path?: unknown }).path,
          then_run,
          toolCallId,
          signal,
          ctx
        )
      }
    })

    pi.registerTool({
      ...baseWrite,
      parameters: writeParameters,
      async execute(toolCallId, input, signal, onUpdate, ctx) {
        const { then_run, ...writeInput } = input as typeof input & { then_run?: ThenRunInput }
        return fusedExecute(
          () => baseWrite.execute(toolCallId, writeInput, signal, onUpdate, ctx),
          (input as { path?: unknown }).path,
          then_run,
          toolCallId,
          signal,
          ctx
        )
      }
    })
  }
}
