import { describe, expect, it } from 'vitest'

import { acpPermissionChoice, acpPermissionControl } from '@cherrystudio/agent-runtime-acp/v1'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { requiresPermissionConfirmation } from '@cherrystudio/agent-runtime/cli'

import { getAcpHostPermissionModeSelection, getLocalAgentLaunchMode } from '../localAgent'

describe('runtime permission declarations', () => {
  it.each([kimiCli, qwenCli])(
    'replaces saved Cherry-only approval with the advertised $name permission catalog',
    ({ permissionMode }) => {
      const options = Object.keys(permissionMode.values).map((value) =>
        acpPermissionChoice({ value, name: value }, 'mode', permissionMode)
      )
      expect(
        getAcpHostPermissionModeSelection({ id: 'mode', currentValue: 'default', options }, 'bypassPermissions')
      ).toBeUndefined()
      expect(requiresPermissionConfirmation(options.find(({ value }) => value === 'yolo'))).toBe(true)
    }
  )

  it('shows OpenCode native Plan in the shared chooser and preserves the host choice when back in Build', () => {
    const options = ['build', 'plan'].map((value) =>
      acpPermissionChoice({ value, name: value }, 'mode', openCodeCli.permissionMode)
    )
    const mode = { id: 'mode', application: 'session' as const, options }
    const duringPlan = getAcpHostPermissionModeSelection({ ...mode, currentValue: 'plan' }, 'acceptEdits')
    const duringBuild = getAcpHostPermissionModeSelection({ ...mode, currentValue: 'build' }, 'acceptEdits')
    expect(duringPlan?.currentValue).toBe('plan')
    expect(duringBuild?.currentValue).toBe('acceptEdits')
  })

  it('keeps Goose auto approval distinct from Claude auto review', () => {
    const raw = { value: 'auto', name: 'Auto' }
    const goose = acpPermissionChoice(raw, 'mode', gooseCli.permissionMode)
    const claude = getLocalAgentLaunchMode({ presetId: 'claude', env: {} })?.options.find(
      ({ value }) => value === 'auto'
    )

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
