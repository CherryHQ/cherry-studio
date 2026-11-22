import {
  GEMINI_WRITABLE_SETTINGS_KEYS,
  KIMI_WRITABLE_SECTION_KEYS,
  KIMI_WRITABLE_TOP_LEVEL_KEYS,
  type ManagedSettingsKeys,
  OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS,
  QWEN_WRITABLE_SETTINGS_KEYS
} from './managedKeys'
import {
  isClaudePermissionMode,
  isClaudeReasoningEffort,
  isCodexPermissionMode,
  isCodexReasoningEffort,
  isGeminiApprovalMode,
  isKimiPermissionMode,
  isOpenCodePermissionMode,
  isQwenApprovalMode
} from './permissionModes'
import type { CliConfigWriteArgs } from './types'
import { asRecord } from './values'

function pickTopLevel<T>(source: Record<string, T>, keys: readonly string[]) {
  const next: Record<string, T> = {}
  for (const key of keys) {
    if (source[key] !== undefined) next[key] = source[key]
  }
  return next
}

function pickSectionFields(
  source: NonNullable<CliConfigWriteArgs['configBlob']>,
  managedKeys: ManagedSettingsKeys
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const next: NonNullable<CliConfigWriteArgs['configBlob']> = {}
  for (const [section, keys] of Object.entries(managedKeys)) {
    const sourceSection = asRecord(source[section])
    const nextSection: NonNullable<CliConfigWriteArgs['configBlob']> = {}
    for (const key of keys) {
      if (sourceSection[key] !== undefined) nextSection[key] = sourceSection[key]
    }
    if (Object.keys(nextSection).length > 0) next[section] = nextSection
  }
  return next
}

export function sanitizeClaudeConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const blob: NonNullable<CliConfigWriteArgs['configBlob']> = asRecord(configBlob)
  const next: NonNullable<CliConfigWriteArgs['configBlob']> = { ...blob }
  const defaultMode = asRecord(blob.permissions).defaultMode
  if (isClaudePermissionMode(defaultMode)) next.permissions = { defaultMode }
  else delete next.permissions
  if (!isClaudeReasoningEffort(next.effortLevel)) delete next.effortLevel
  return next
}

export function sanitizeCodexConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const blob: NonNullable<CliConfigWriteArgs['configBlob']> = asRecord(configBlob)
  const next = pickTopLevel(blob, ['goalMode', 'remoteCompaction', 'disableResponseStorage'])
  if (isCodexPermissionMode(blob.permissionMode)) next.permissionMode = blob.permissionMode
  if (isCodexReasoningEffort(blob.reasoningEffort)) next.reasoningEffort = blob.reasoningEffort
  return next
}

export function sanitizeOpenCodeConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const blob: NonNullable<CliConfigWriteArgs['configBlob']> = asRecord(configBlob)
  const next = pickTopLevel(blob, OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS)
  if (!isOpenCodePermissionMode(next.permissionMode)) delete next.permissionMode
  const env = asRecord(blob.env)
  if (env.OPENCODE_REASONING === 'true') next.env = { OPENCODE_REASONING: 'true' }
  return next
}

export function sanitizeGeminiConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const next = pickSectionFields(asRecord(configBlob), GEMINI_WRITABLE_SETTINGS_KEYS)
  const general = asRecord(next.general)
  if (general.defaultApprovalMode !== undefined && !isGeminiApprovalMode(general.defaultApprovalMode)) {
    delete general.defaultApprovalMode
    if (Object.keys(general).length > 0) next.general = general
    else delete next.general
  }
  return next
}

export function sanitizeQwenConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const next = pickSectionFields(asRecord(configBlob), QWEN_WRITABLE_SETTINGS_KEYS)
  const tools = asRecord(next.tools)
  if (tools.approvalMode !== undefined && !isQwenApprovalMode(tools.approvalMode)) {
    delete tools.approvalMode
    if (Object.keys(tools).length > 0) next.tools = tools
    else delete next.tools
  }
  const autoMode = asRecord(asRecord(next.permissions).autoMode)
  if (autoMode.classifyAllShell === true) {
    next.permissions = { autoMode: { classifyAllShell: true } }
  } else {
    delete next.permissions
  }
  return next
}

export function sanitizeKimiConfigBlob(
  configBlob: CliConfigWriteArgs['configBlob']
): NonNullable<CliConfigWriteArgs['configBlob']> {
  const blob: NonNullable<CliConfigWriteArgs['configBlob']> = asRecord(configBlob)
  const next = {
    ...pickTopLevel(blob, KIMI_WRITABLE_TOP_LEVEL_KEYS),
    ...pickSectionFields(blob, KIMI_WRITABLE_SECTION_KEYS)
  }
  if (next.default_permission_mode !== undefined && !isKimiPermissionMode(next.default_permission_mode)) {
    delete next.default_permission_mode
  }
  return next
}
