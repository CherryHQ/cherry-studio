export const CURSOR_AUTO_MODEL_ID = 'auto'

export function resolveCursorModelId(modelId?: string): string {
  return !modelId || modelId === 'default' ? CURSOR_AUTO_MODEL_ID : modelId
}

export const cursorLoginMethod = {
  id: 'cursor_login',
  type: 'agent',
  name: 'Cursor',
  form: 'browser',
  clearEnv: ['CURSOR_API_KEY']
} as const
export const cursorApiKeyMethod = {
  id: 'cursor_api_key',
  type: 'agent',
  name: 'Cursor',
  form: 'api-key',
  apiKey: 'CURSOR_API_KEY'
} as const
export const cursorLoginMethods = [cursorLoginMethod, cursorApiKeyMethod] as const

export const CURSOR_PERMISSION_MODES = {
  id: 'cursor-mode',
  currentValue: 'default',
  application: 'next-turn',
  options: [
    { value: 'default', name: 'Default', permissionMode: 'default' },
    { value: 'plan', name: 'Plan', permissionMode: 'plan' }
  ]
} as const

export type CursorPermissionMode = (typeof CURSOR_PERMISSION_MODES.options)[number]['value']

export const cursorPreset = {
  id: 'cursor',
  name: 'Cursor',
  protocol: 'cursor',
  account: { methods: cursorLoginMethods, canReadAccount: true },
  defaultMode: CURSOR_PERMISSION_MODES,
  helpUrl: 'https://cursor.com/docs/api/sdk/typescript'
} as const
