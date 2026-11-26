import { expect, it } from 'vitest'

import { deniedReason } from '../../src/core/approval/approval'
import type { ApprovalHostFacts } from '../../src/core/hostFacts'
import { createToolPolicy } from '../../src/orchestration/gate'
import { call, PARENT, SETTINGS } from '../core/history'
import { createScriptedHost } from '../scriptedHost'

it('asks under the current permission mode when facts were gathered under an earlier mode', async () => {
  let mode: 'default' | 'auto' = 'default'
  const host = createScriptedHost({
    settings: SETTINGS,
    approvalFacts: () => {
      const facts: ApprovalHostFacts = {
        category: 'other',
        disabled: false,
        autoApproved: false,
        approvalRequired: false,
        nonBypassable: false,
        withinAllowedRoots: true,
        permissionMode: mode,
        destructive: mode === 'auto'
      }
      mode = 'auto'
      return facts
    }
  })
  host.answerApproval({ kind: 'denied', feedback: 'Leave the file untouched' })
  const policy = createToolPolicy({ ...host, settings: { ...host.settings, permissionMode: () => mode } })
  await expect(
    policy.approve(
      {
        key: call('changed-mode'),
        thread: PARENT,
        tool: 'bash',
        args: { command: 'rm file' },
        nested: false,
        signal: new AbortController().signal
      },
      { goalRound: false, callWindow: [], plan: undefined },
      (_name, ask) => ask()
    )
  ).resolves.toEqual({ block: deniedReason('Leave the file untouched') })
})
