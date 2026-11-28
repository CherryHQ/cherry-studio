import { describe, expect, it } from 'vitest'

import { acpPermissionChoice, acpPermissionControl } from '@cherrystudio/agent-runtime-acp/v1'
import { gooseCli } from '@cherrystudio/agent-runtime-goose-acp/cli'
import { kimiCli } from '@cherrystudio/agent-runtime-kimi-acp/cli'
import { openCodeCli } from '@cherrystudio/agent-runtime-opencode-acp/cli'
import { qwenCli } from '@cherrystudio/agent-runtime-qwen-acp/cli'
import { requiresPermissionConfirmation } from '@cherrystudio/agent-runtime/cli'

import {
  ACP_LAUNCH_BYPASS_VALUE,
  getAcpHostPermissionModeSelection,
  getAcpLaunchBypassArgs,
  getAcpLaunchPermission,
  getLocalAgentLaunchMode
} from '../localAgent'

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

  it('adds bypass only for documented ACP launch commands and leaves explicit arguments alone', () => {
    expect(getAcpLaunchBypassArgs({ presetId: 'antigravity-acp', args: [] })).toEqual([
      'acp',
      '--dangerously-skip-permissions'
    ])
    expect(getAcpLaunchBypassArgs({ presetId: 'grok-build', args: ['agent', 'stdio'] })).toEqual([
      'agent',
      '--always-approve',
      'stdio'
    ])
    expect(getAcpLaunchBypassArgs({ presetId: 'antigravity-acp', args: ['acp', '--sandbox'] })).toBeUndefined()
    expect(getAcpLaunchBypassArgs({ presetId: 'cline', args: [] })).toEqual(['--acp', '--auto-approve', 'true'])
    expect(getAcpLaunchBypassArgs({ presetId: 'omp', args: ['acp'] })).toEqual(['acp', '--yolo'])
    expect(getAcpLaunchBypassArgs({ presetId: 'kimi', args: [] })).toBeUndefined()
  })

  it('uses live native bypass where available and replaces a host-only bypass with startup bypass', () => {
    const mode = {
      id: 'mode',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default', permissionMode: 'default' as const },
        { value: 'yolo', name: 'YOLO', permissionMode: 'bypassPermissions' as const }
      ]
    }
    expect(getAcpLaunchPermission(mode, false)).toBeUndefined()
    const host = getAcpHostPermissionModeSelection()
    expect(getAcpLaunchPermission(host, true)).toMatchObject({ currentValue: ACP_LAUNCH_BYPASS_VALUE })
    expect(getAcpLaunchPermission(host, false)?.options.map(({ value }) => value)).toEqual([
      'default',
      'acceptEdits',
      ACP_LAUNCH_BYPASS_VALUE
    ])
  })

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
