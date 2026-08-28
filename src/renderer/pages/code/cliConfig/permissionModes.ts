export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const

export const CLAUDE_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

export const CODEX_PERMISSION_MODES = ['readOnly', 'workspace', 'fullAccess'] as const

export const CODEX_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

export const OPEN_CODE_PERMISSION_MODES = ['ask', 'deny'] as const

export const GEMINI_APPROVAL_MODES = ['default', 'auto_edit', 'plan'] as const

export const QWEN_APPROVAL_MODES = ['plan', 'default', 'auto-edit', 'auto', 'yolo'] as const

export const KIMI_PERMISSION_MODES = ['manual', 'auto', 'yolo'] as const

export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number]

const CODEX_PERMISSION_CONFIG: Record<CodexPermissionMode, { approval_policy: string; sandbox_mode: string }> = {
  readOnly: { approval_policy: 'on-request', sandbox_mode: 'read-only' },
  workspace: { approval_policy: 'on-request', sandbox_mode: 'workspace-write' },
  fullAccess: { approval_policy: 'never', sandbox_mode: 'danger-full-access' }
}

function isOneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

export function isClaudePermissionMode(value: unknown): value is (typeof CLAUDE_PERMISSION_MODES)[number] {
  return isOneOf(CLAUDE_PERMISSION_MODES, value)
}

export function isClaudeReasoningEffort(value: unknown): value is (typeof CLAUDE_REASONING_EFFORTS)[number] {
  return isOneOf(CLAUDE_REASONING_EFFORTS, value)
}

export function isCodexPermissionMode(value: unknown): value is CodexPermissionMode {
  return isOneOf(CODEX_PERMISSION_MODES, value)
}

export function isCodexReasoningEffort(value: unknown): value is (typeof CODEX_REASONING_EFFORTS)[number] {
  return isOneOf(CODEX_REASONING_EFFORTS, value)
}

export function isOpenCodePermissionMode(value: unknown): value is (typeof OPEN_CODE_PERMISSION_MODES)[number] {
  return isOneOf(OPEN_CODE_PERMISSION_MODES, value)
}

export function isGeminiApprovalMode(value: unknown): value is (typeof GEMINI_APPROVAL_MODES)[number] {
  return isOneOf(GEMINI_APPROVAL_MODES, value)
}

export function isQwenApprovalMode(value: unknown): value is (typeof QWEN_APPROVAL_MODES)[number] {
  return isOneOf(QWEN_APPROVAL_MODES, value)
}

export function isKimiPermissionMode(value: unknown): value is (typeof KIMI_PERMISSION_MODES)[number] {
  return isOneOf(KIMI_PERMISSION_MODES, value)
}

export function codexPermissionModeToConfig(mode: CodexPermissionMode): {
  approval_policy: string
  sandbox_mode: string
} {
  return CODEX_PERMISSION_CONFIG[mode]
}

export function codexConfigToPermissionMode(config: Record<string, any>): CodexPermissionMode | undefined {
  return CODEX_PERMISSION_MODES.find((mode) => {
    const candidate = CODEX_PERMISSION_CONFIG[mode]
    return config.approval_policy === candidate.approval_policy && config.sandbox_mode === candidate.sandbox_mode
  })
}
