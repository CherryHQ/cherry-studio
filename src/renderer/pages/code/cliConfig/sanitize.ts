import { CodeCli } from '@shared/types/codeCli'

import {
  asRecord,
  GEMINI_WRITABLE_SETTINGS_KEYS,
  KIMI_WRITABLE_SECTION_KEYS,
  KIMI_WRITABLE_TOP_LEVEL_KEYS,
  type ManagedSettingsKeys,
  OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS,
  QWEN_WRITABLE_SETTINGS_KEYS
} from './managedKeys'
import { getConfigBlob } from './values'

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

export function sanitizeCodexConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = getConfigBlob(configBlob)
  return pickTopLevel(blob, ['goalMode', 'remoteCompaction', 'commonConfig', 'disableResponseStorage'])
}

export function sanitizeOpenCodeConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = getConfigBlob(configBlob)
  const next = pickTopLevel(blob, OPEN_CODE_WRITABLE_TOP_LEVEL_KEYS)
  const env = asRecord(blob.env)
  if (env.OPENCODE_REASONING === 'true') next.env = { OPENCODE_REASONING: 'true' }
  return next
}

export function sanitizeGeminiConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  return pickSectionFields(getConfigBlob(configBlob), GEMINI_WRITABLE_SETTINGS_KEYS)
}

export function sanitizeQwenConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const next = pickSectionFields(getConfigBlob(configBlob), QWEN_WRITABLE_SETTINGS_KEYS)
  const autoMode = asRecord(asRecord(next.permissions).autoMode)
  if (autoMode.classifyAllShell === true) {
    next.permissions = { autoMode: { classifyAllShell: true } }
  } else {
    delete next.permissions
  }
  return next
}

export function sanitizeKimiConfigBlob(configBlob: Record<string, unknown> | undefined): Record<string, any> {
  const blob = getConfigBlob(configBlob)
  return {
    ...pickTopLevel(blob, KIMI_WRITABLE_TOP_LEVEL_KEYS),
    ...pickSectionFields(blob, KIMI_WRITABLE_SECTION_KEYS)
  }
}

export function sanitizeCliConfigBlob(
  cliTool: string,
  configBlob: Record<string, unknown> | undefined
): Record<string, any> {
  switch (cliTool) {
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
      return getConfigBlob(configBlob)
  }
}
