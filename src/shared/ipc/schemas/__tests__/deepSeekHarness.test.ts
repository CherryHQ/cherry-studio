import { describe, expect, it } from 'vitest'

import { deepSeekHarnessRequestSchemas } from '../deepSeekHarness'

describe('DeepSeek Harness IPC schemas', () => {
  it('accepts validated launch settings and supplies safe defaults', () => {
    const input = deepSeekHarnessRequestSchemas['deepseek_harness.start'].input
    expect(input.parse({ mode: 'direct', uniqueModelId: 'anthropic::claude-sonnet' })).toEqual({
      mode: 'direct',
      uniqueModelId: 'anthropic::claude-sonnet',
      agentPreset: 'inherit',
      permissionMode: 'workspace-write'
    })
    expect(
      input.safeParse({
        mode: 'gateway',
        uniqueModelId: 'openai::gpt-5',
        agentPreset: 'code',
        permissionMode: 'read-only'
      }).success
    ).toBe(true)
    expect(
      input.safeParse({
        mode: 'direct',
        uniqueModelId: 'anthropic::claude-sonnet',
        agentPreset: 'unknown',
        permissionMode: 'workspace-write'
      }).success
    ).toBe(false)
    expect(
      input.safeParse({
        mode: 'direct',
        uniqueModelId: 'anthropic::claude-sonnet',
        agentPreset: 'standard',
        permissionMode: 'unrestricted'
      }).success
    ).toBe(false)
    expect(
      input.safeParse({ mode: 'direct', uniqueModelId: 'anthropic::claude-sonnet', apiKey: 'secret' }).success
    ).toBe(false)
    expect(input.safeParse({ mode: 'direct', uniqueModelId: 'invalid' }).success).toBe(false)
  })

  it('requires a dynamic URL on successful start and keeps it optional in status', () => {
    const startOutput = deepSeekHarnessRequestSchemas['deepseek_harness.start'].output
    const statusOutput = deepSeekHarnessRequestSchemas['deepseek_harness.get_status'].output
    expect(startOutput.safeParse({ success: true, url: 'http://127.0.0.1:43123' }).success).toBe(true)
    expect(startOutput.safeParse({ success: true }).success).toBe(false)
    expect(statusOutput.safeParse({ status: 'stopped' }).success).toBe(true)
    expect(statusOutput.safeParse({ status: 'running', url: 'http://127.0.0.1:43123' }).success).toBe(true)
  })
})
