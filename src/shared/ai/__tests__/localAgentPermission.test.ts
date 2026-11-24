import { describe, expect, it } from 'vitest'

import { isLocalPermissionConfigOption, isLocalPermissionConfigOptionId } from '../localAgent'
import {
  classifyNativePermissionMode,
  isHighRiskLocalOption,
  resolveEffectiveLocalPermissionMode
} from '../localAgentPermission'

describe('localAgentPermission', () => {
  it('classifies native modes across Antigravity, Codex, Claude, OpenCode, and DeepSeek aliases', () => {
    expect(classifyNativePermissionMode({ value: 'bypassPermissions', name: 'Bypass' })?.canonicalMode).toBe(
      'bypassPermissions'
    )
    expect(classifyNativePermissionMode({ value: 'yolo', name: 'YOLO' })?.canonicalMode).toBe('bypassPermissions')
    expect(classifyNativePermissionMode({ value: 'fullAccess', name: 'Full Access' })?.canonicalMode).toBe(
      'bypassPermissions'
    )
    expect(classifyNativePermissionMode({ value: 'accept-edits', name: 'Accept Edits' })?.canonicalMode).toBe(
      'acceptEdits'
    )
    expect(classifyNativePermissionMode({ value: 'workspace-write', name: 'Workspace' })?.canonicalMode).toBe(
      'acceptEdits'
    )
    expect(classifyNativePermissionMode({ value: 'auto', name: 'Auto' })?.canonicalMode).toBe('auto')
    expect(classifyNativePermissionMode({ value: 'smart_approve', name: 'Smart Approve' })?.canonicalMode).toBe('auto')
    expect(classifyNativePermissionMode({ value: 'read-only', name: 'Read Only' })?.canonicalMode).toBe('plan')
    expect(classifyNativePermissionMode({ value: 'default', name: 'Default' })?.canonicalMode).toBe('default')
  })

  it('resolves effective permission mode from allow_all overrides, session mode, and grouped config options', () => {
    expect(
      resolveEffectiveLocalPermissionMode({
        mode: { id: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
        configOptions: [{ id: 'allow_all', name: 'Allow All', type: 'boolean', currentValue: true }]
      })
    ).toBe('bypassPermissions')

    expect(
      resolveEffectiveLocalPermissionMode({
        mode: {
          id: 'mode',
          currentValue: 'accept-edits',
          options: [
            { value: 'default', name: 'Default' },
            { value: 'accept-edits', name: 'Accept Edits' }
          ]
        }
      })
    ).toBe('acceptEdits')

    expect(
      resolveEffectiveLocalPermissionMode({
        configOptions: [
          {
            id: 'approval_mode',
            name: 'Approval Mode',
            type: 'select',
            currentValue: 'yolo',
            options: [{ group: 'Modes', name: 'Modes', options: [{ value: 'yolo', name: 'Full Access' }] }]
          }
        ]
      })
    ).toBe('bypassPermissions')

    expect(
      resolveEffectiveLocalPermissionMode({
        configOptions: [
          {
            id: 'custom-opt',
            name: 'Permissions',
            type: 'select',
            currentValue: 'auto',
            options: [{ value: 'auto', name: 'Auto' }]
          }
        ]
      })
    ).toBe('auto')
  })

  it('flags high-risk mode and config options while leaving restricted options unflagged', () => {
    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'yolo', name: 'YOLO' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'custom', name: 'Full Access' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: 'on' })).toBe(true)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'sandbox', value: 'disabled' })).toBe(true)

    expect(isHighRiskLocalOption({ kind: 'mode', optionId: 'mode', value: 'accept-edits', name: 'Accept Edits' })).toBe(
      false
    )
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'allow_all', value: false })).toBe(false)
    expect(isHighRiskLocalOption({ kind: 'config', optionId: 'sandbox', value: 'workspace-write' })).toBe(false)
  })

  it('recognizes permission config option IDs and names for persistence', () => {
    expect(isLocalPermissionConfigOptionId('permission_mode')).toBe(true)
    expect(isLocalPermissionConfigOptionId('approval_mode')).toBe(true)
    expect(isLocalPermissionConfigOptionId('permissions')).toBe(true)
    expect(isLocalPermissionConfigOptionId('allow_all')).toBe(true)
    expect(isLocalPermissionConfigOptionId('sandbox')).toBe(true)
    expect(isLocalPermissionConfigOptionId('thinking_level')).toBe(false)

    expect(
      isLocalPermissionConfigOption({
        id: 'custom_id',
        category: 'mode'
      })
    ).toBe(true)
    expect(
      isLocalPermissionConfigOption({
        id: 'verbosity',
        category: '_verbosity'
      })
    ).toBe(false)
  })
})
