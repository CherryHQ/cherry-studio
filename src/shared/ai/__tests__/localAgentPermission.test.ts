import { describe, expect, it } from 'vitest'

import { acpPermissionChoice, acpPermissionControl } from '@cherrystudio/agent-runtime-acp/v1'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { requiresPermissionConfirmation } from '@cherrystudio/agent-runtime/cli'

import { getDefaultLocalAgentMode } from '../localAgent'

describe('runtime permission declarations', () => {
  it('keeps Goose auto approval distinct from Claude auto review', () => {
    const raw = { value: 'auto', name: 'Auto' }
    const goose = acpPermissionChoice(raw, 'mode', gooseCli.permissionMode)
    const claude = getDefaultLocalAgentMode('claude')?.options.find(({ value }) => value === 'auto')

    expect(goose.permissionMode).toBe('bypassPermissions')
    expect(requiresPermissionConfirmation(goose)).toBe(true)
    expect(claude?.permissionMode).toBe('auto')
    expect(requiresPermissionConfirmation(claude)).toBe(false)
  })

  it('warns about a custom ACP unrestricted option without granting host permissions', () => {
    const unverified = acpPermissionChoice({ value: 'yolo', name: 'Full Access' }, 'mode')
    expect(unverified.permissionMode).toBeUndefined()
    expect(requiresPermissionConfirmation(unverified)).toBe(true)

    const unrelated = acpPermissionChoice({ value: 'yolo', name: 'Full Access' }, undefined)
    expect(requiresPermissionConfirmation(unrelated)).toBe(false)
  })

  it('marks the option that disables isolation or enables unconditional approval', () => {
    const sandbox = acpPermissionControl({ id: 'sandbox', name: 'Sandbox' })
    const allowAll = acpPermissionControl({ id: 'allow_all', name: 'Allow All' })
    expect(
      requiresPermissionConfirmation(acpPermissionChoice({ value: 'false', name: 'Local Environment' }, sandbox))
    ).toBe(true)
    expect(requiresPermissionConfirmation(acpPermissionChoice({ value: 'true', name: 'Sandbox' }, sandbox))).toBe(false)
    expect(requiresPermissionConfirmation(acpPermissionChoice({ value: 'on', name: 'On' }, allowAll))).toBe(true)
    expect(requiresPermissionConfirmation(acpPermissionChoice({ value: 'off', name: 'Off' }, allowAll))).toBe(false)
  })
})
