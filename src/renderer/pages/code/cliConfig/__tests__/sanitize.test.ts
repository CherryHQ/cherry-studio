import { CodeCli } from '@shared/types/codeCli'
import { describe, expect, it } from 'vitest'

import { sanitizeCliConfigBlob } from '../adapters'

describe('sanitizeCliConfigBlob (codex)', () => {
  // `commonConfig` was a dead toggle (buildCodexConfig/parser.ts never read or wrote it) and was
  // removed from the UI — pin it as filtered so a future field addition can't silently revive it.
  it('drops the removed commonConfig field', () => {
    const result = sanitizeCliConfigBlob(CodeCli.OPENAI_CODEX, { commonConfig: true, goalMode: true })
    expect(result).not.toHaveProperty('commonConfig')
    expect(result).toEqual({ goalMode: true })
  })
})

describe('sanitizeCliConfigBlob (DeepSeek Harness)', () => {
  it('keeps only valid managed settings and supplies safe defaults', () => {
    expect(
      sanitizeCliConfigBlob(CodeCli.DEEPSEEK_HARNESS, {
        agentPreset: 'code',
        permissionMode: 'read-only',
        unrelated: true
      })
    ).toEqual({ agentPreset: 'code', permissionMode: 'read-only' })

    expect(
      sanitizeCliConfigBlob(CodeCli.DEEPSEEK_HARNESS, {
        agentPreset: 'unknown',
        permissionMode: 'root'
      })
    ).toEqual({ agentPreset: 'inherit', permissionMode: 'workspace-write' })
  })
})
