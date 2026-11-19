import { ipcApi } from '@renderer/ipc'
import { CodeCli } from '@shared/types/codeCli'
import { CLI_CONFIG_FILE_SPECS, type CliConfigWriteFile } from '@shared/utils/cliConfig'

import { getAdapter } from './adapters'
import { readCliConfigDraft, readCliConfigFiles, readOwnLoginCliConfigDraft } from './draft'
import { parseDraftFileOrThrow } from './draftFiles'
import { parseJsonOrThrow, readConfigFiles } from './file'
import type { CliConfigFileDraft, CliConfigGatewayContext, CliConfigWriteArgs } from './types'

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
  const scrub = await getAdapter(CodeCli.CLAUDE_CODE)!.buildClearFiles(false)
  const draft = await buildSelection(ctx, true)
  await commit(
    [
      ...scrub,
      ...draft.map(({ target, content }) => ({ target, content })),
      ...(ctx.selection ? [] : [{ target: 'claude-scoped-settings' as const, content: '{}\n' }])
    ],
    true,
    ctx.currentProviderId
  )
}

export async function disableClaudeScopedSettings(ctx: ClaudeScopeTransitionContext): Promise<void> {
  if (ctx.claudeScopedSettings !== true) return
  const scoped = await readCliConfigFiles(CodeCli.CLAUDE_CODE, { claudeScopedSettings: true })
  if (scoped.length) parseDraftFileOrThrow('claude-scoped-settings', scoped, parseJsonOrThrow)
  else {
    const read = await readConfigFiles(['claude-scoped-settings'])
    const file = read.get('claude-scoped-settings')!
    if (file.content !== null) throw new Error(`Invalid Claude scoped settings at ${file.path}; fix the file and retry`)
  }
  const base = scoped.map((file) => ({
    ...file,
    target: 'claude-settings' as const,
    ...CLI_CONFIG_FILE_SPECS['claude-settings']
  }))
  const draft = await buildSelection(ctx, false, base.length ? base : undefined)
  await commit(
    [...draft.map(({ target, content }) => ({ target, content })), { target: 'claude-scoped-settings', delete: true }],
    false,
    ctx.currentProviderId
  )
}
