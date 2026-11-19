import { ipcApi } from '@renderer/ipc'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS, type CliConfigWriteFile } from '@shared/utils/cliConfig'

import { getAdapter } from './adapters'
import { readCliConfigDraft, readCliConfigFiles, readOwnLoginCliConfigDraft } from './draft'
import { makeDraftFile, parseDraftFileOrThrow } from './draftFiles'
import { parseJsonOrThrow, readConfigFiles, readValidatedJsonOrNull, renderJsonFile } from './file'
import type { CliConfigFileDraft, CliConfigGatewayContext, CliConfigWriteArgs } from './types'
import { asRecord } from './values'

type ClaudeSelection =
  | {
      kind: 'provider'
      modelId: CliConfigWriteArgs['modelId']
      configBlob?: Record<string, unknown>
      writePrimaryModel?: boolean
      gateway?: CliConfigGatewayContext
    }
  | { kind: 'own-login'; configBlob?: Record<string, unknown> }

export interface ClaudeScopeTransitionContext {
  claudeScopedSettings?: boolean
  currentProviderId: string | null
  selection?: ClaudeSelection | null
}

async function buildSelection(
  ctx: ClaudeScopeTransitionContext,
  scoped: boolean,
  base?: CliConfigFileDraft[]
): Promise<CliConfigFileDraft[]> {
  const target = scoped ? 'claude-scoped-settings' : 'claude-settings'
  const files: CliConfigFileDraft[] | undefined = scoped
    ? [{ target, ...CLI_CONFIG_FILE_SPECS[target], content: '{}' }]
    : base
  if (!ctx.selection) return []
  if (ctx.selection.kind === 'own-login') {
    return readOwnLoginCliConfigDraft({
      cliTool: CodeCli.CLAUDE_CODE,
      configBlob: ctx.selection.configBlob,
      claudeScopedSettings: scoped,
      files
    })
  }
  return readCliConfigDraft(
    { ...ctx.selection, cliTool: CodeCli.CLAUDE_CODE, claudeScopedSettings: scoped, files },
    true
  )
}

async function commit(
  files: CliConfigWriteFile[],
  claudeScopedSettings: boolean,
  currentProviderId: string | null
): Promise<void> {
  const result = await ipcApi.request('code_cli.write_config', {
    cliTool: CodeCli.CLAUDE_CODE,
    files,
    claudeScopedSettings,
    expectedClaudeProviderId: currentProviderId
  })
  if (!result.success) throw new Error(result.message)
}

export async function enableClaudeScopedSettings(ctx: ClaudeScopeTransitionContext): Promise<void> {
  if (ctx.claudeScopedSettings === true) return
  if (!ctx.selection) {
    const read = await readConfigFiles(['claude-scoped-settings'])
    const content = read.get('claude-scoped-settings')!.content
    await commit(
      [{ target: 'claude-scoped-settings', content: content?.trim() ? content : '{}\n' }],
      true,
      ctx.currentProviderId
    )
    return
  }
  const scrub = await getAdapter(CodeCli.CLAUDE_CODE)!.buildClearFiles(false)
  const draft = await buildSelection(ctx, true)
  await commit(
    draft.map(({ target, content }) => ({ target, content })),
    true,
    ctx.currentProviderId
  )
  if (scrub.length) await commit(scrub, true, ctx.currentProviderId)
}

export async function disableClaudeScopedSettings(ctx: ClaudeScopeTransitionContext): Promise<void> {
  if (ctx.claudeScopedSettings !== true) return
  const scoped = await readCliConfigFiles(CodeCli.CLAUDE_CODE, { claudeScopedSettings: true })
  const overlay = scoped.length ? parseDraftFileOrThrow('claude-scoped-settings', scoped, parseJsonOrThrow) : {}
  if (!scoped.length) {
    const read = await readConfigFiles(['claude-scoped-settings'])
    const file = read.get('claude-scoped-settings')!
    if (file.content !== null) throw new Error(`Invalid Claude scoped settings at ${file.path}; fix the file and retry`)
  }
  const read = await readConfigFiles(['claude-settings'])
  const global = readValidatedJsonOrNull('claude-settings', read, 'Claude Code settings') ?? {}
  const merged = { ...global, ...overlay }
  for (const key of ['permissions', 'env']) {
    if (key in global || key in overlay) merged[key] = { ...asRecord(global[key]), ...asRecord(overlay[key]) }
  }
  const base = [makeDraftFile('claude-settings', renderJsonFile(merged), read)]
  const draft = ctx.selection ? await buildSelection(ctx, false, base) : base
  await commit(
    [...draft.map(({ target, content }) => ({ target, content })), { target: 'claude-scoped-settings', delete: true }],
    false,
    ctx.currentProviderId
  )
}
