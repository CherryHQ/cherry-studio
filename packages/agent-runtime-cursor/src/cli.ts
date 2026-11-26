export const cursorLoginMethod = { id: 'cursor_login', type: 'agent', name: 'Cursor' } as const

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
  defaultMode: CURSOR_PERMISSION_MODES,
  helpUrl: 'https://cursor.com/docs/api/sdk/typescript'
} as const
