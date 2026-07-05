import { CodeCli } from '@shared/types/codeCli'

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
import { asRecord } from './values'

function pickTopLevel(source: Record<string, any>, keys: readonly string[]): Record<string, any> {
  const next: Record<string, any> = {}
  for (const key of keys) {
    if (source[key] !== undefined) next[key] = source[key]
  }
  return next
}

function pickSectionFields(source: Record<string, any>, managedKeys: ManagedSettingsKeys): Record<string, any> {
  const next: Record<string, any> = {}
  for (const [section, keys] of Object.entries(managedKeys)) {
    const sourceSection = asRecord(source[section])
    const nextSection: Record<string, any> = {}
    for (const key of keys) {
      if (sourceSection[key] !== undefined) nextSection[key] = sourceSection[key]
    }
    if (Object.keys(nextSection).length > 0) next[section] = nextSection
  }
  return next
}

export function sanitizeClaudeConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = asRecord(configBlob)
  const next = { ...blob }
  const defaultMode = asRecord(blob.permissions).defaultMode
  if (isClaudePermissionMode(defaultMode)) next.permissions = { defaultMode }
  else delete next.permissions
  if (!isClaudeReasoningEffort(next.effortLevel)) delete next.effortLevel
  return next
}

export function sanitizeCodexConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = asRecord(configBlob)
  const next = pickTopLevel(blob, ['goalMode', 'remoteCompaction', 'commonConfig', 'disableResponseStorage'])
  if (isCodexPermissionMode(blob.permissionMode)) next.permissionMode = blob.permissionMode
  if (isCodexReasoningEffort(blob.reasoningEffort)) next.reasoningEffort = blob.reasoningEffort
  return next
}

export function sanitizeOpenCodeConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = asRecord(configBlob)
  const next = pickTopLevel(blob, OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS)
  if (!isOpenCodePermissionMode(next.permissionMode)) delete next.permissionMode
  const env = asRecord(blob.env)
  if (env.OPENCODE_REASONING === 'true') next.env = { OPENCODE_REASONING: 'true' }
  return next
}

export function sanitizeGeminiConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const next = pickSectionFields(asRecord(configBlob), GEMINI_WRITABLE_SETTINGS_KEYS)
  const general = asRecord(next.general)
  if (general.defaultApprovalMode !== undefined && !isGeminiApprovalMode(general.defaultApprovalMode)) {
    delete general.defaultApprovalMode
    if (Object.keys(general).length > 0) next.general = general
    else delete next.general
  }
  return next
}

export function sanitizeQwenConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
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

export function sanitizeKimiConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = asRecord(configBlob)
  const next = {
    ...pickTopLevel(blob, KIMI_WRITABLE_TOP_LEVEL_KEYS),
    ...pickSectionFields(blob, KIMI_WRITABLE_SECTION_KEYS)
  }
  if (next.default_permission_mode !== undefined && !isKimiPermissionMode(next.default_permission_mode)) {
    delete next.default_permission_mode
  }
  return next
}

export function sanitizeCliConfigBlob(
  cliTool: string,
  configBlob: Record<string, unknown> | undefined
): Record<string, any> {
  switch (cliTool) {
    case CodeCli.CLAUDE_CODE:
      return sanitizeClaudeConfigBlob(configBlob)
    case CodeCli.OPENAI_CODEX:
      return sanitizeCodexConfigBlob(configBlob)
    case CodeCli.OPEN_CODE:
      return sanitizeOpenCodeConfigBlob(configBlob)
    case CodeCli.GEMINI_CLI:
      return sanitizeGeminiConfigBlob(configBlob)
    case CodeCli.QWEN_CODE:
      return sanitizeQwenConfigBlob(configBlob)
    case CodeCli.KIMI_CODE:
      return sanitizeKimiConfigBlob(configBlob)
    default:
      return asRecord(configBlob)
  }
}
