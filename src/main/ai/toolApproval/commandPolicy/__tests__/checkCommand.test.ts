import { describe, expect, it } from 'vitest'

import { checkCommand } from '../checkCommand'

const check = (
  command: string,
  permissionMode: Parameters<typeof checkCommand>[0]['permissionMode'],
  builtinRole?: string
) => checkCommand({ command, dialect: 'bash', cwd: '/workspace', builtinRole, permissionMode })

describe('checkCommand', () => {
  // Catch a non-auto mode inheriting auto's per-invocation prompt, or Full Access lifting a denial.
  it.each(['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const)(
    'asks only in auto and keeps denials in %s',
    async (mode) => {
      expect((await check('git reset --hard', 'auto')).effect).toBe('ask')
      expect((await check('git reset --hard', mode)).effect).toBe('allow')
      expect((await check('rm -rf build', mode, 'assistant')).effect).toBe('deny')
    }
  )

  it('reports the matched rule and working directory as card evidence', async () => {
    const result = await check('git reset --hard', 'default')
    expect(result.reason).toBeDefined()
    expect(result.evidence).toMatchObject({
      cwd: '/workspace',
      rules: [{ ruleId: 'git-discard-worktree', evidence: 'git reset --hard' }]
    })
  })

  // Catch a pending approval surviving a permission-mode or role change.
  it('changes context with mode or role but not with the command text', async () => {
    const base = (await check('rm file', 'auto')).context
    expect((await check('git status', 'auto')).context).toBe(base)
    expect((await check('rm file', 'bypassPermissions')).context).not.toBe(base)
    expect((await check('rm file', 'auto', 'assistant')).context).not.toBe(base)
  })
})
