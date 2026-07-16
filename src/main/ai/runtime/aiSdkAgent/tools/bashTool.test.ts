import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bashDenyReason, buildBashEnv, createBashTool, MAX_BASH_OUTPUT_CHARS, runBoundedCommand } from './bashTool'

vi.mock('@main/utils/rtk', () => ({
  rtkRewrite: vi.fn(async () => null)
}))

const { rtkRewrite } = vi.mocked(await import('@main/utils/rtk'))

const CALL_OPTIONS = { toolCallId: 'call-1', messages: [] }
const posixIt = it.skipIf(process.platform === 'win32')

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

describe('bashDenyReason', () => {
  it('blocks global installs and allows project-local ones', () => {
    expect(bashDenyReason({ command: 'npm install -g typescript' })).toContain('dependency pollution')
    expect(bashDenyReason({ command: 'cd /tmp && pipx install httpie' })).toContain('dependency pollution')
    expect(bashDenyReason({ command: 'npm install typescript' })).toBeNull()
    expect(bashDenyReason({ command: '' })).toBeNull()
    expect(bashDenyReason({})).toBeNull()
  })
})

describe('buildBashEnv', () => {
  beforeEach(() => {
    process.env.CHERRY_TEST_SECRET_TOKEN = 'leak-me'
    process.env.CHERRY_TEST_MY_API_KEY = 'leak-me-too'
    process.env.CHERRY_TEST_PLAIN = 'visible'
  })
  afterEach(() => {
    delete process.env.CHERRY_TEST_SECRET_TOKEN
    delete process.env.CHERRY_TEST_MY_API_KEY
    delete process.env.CHERRY_TEST_PLAIN
  })

  it('strips credential-shaped keys and keeps the rest', () => {
    const env = buildBashEnv()
    expect(env.CHERRY_TEST_SECRET_TOKEN).toBeUndefined()
    expect(env.CHERRY_TEST_MY_API_KEY).toBeUndefined()
    expect(env.CHERRY_TEST_PLAIN).toBe('visible')
    expect(env.MISE_DATA_DIR).toBeDefined()
  })
})

describe('bash tool execution', () => {
  beforeEach(() => {
    rtkRewrite.mockClear()
    rtkRewrite.mockResolvedValue(null)
  })

  posixIt('runs with the workspace as cwd', async () => {
    const tool = createBashTool({ workspacePath: process.cwd() })
    const output = (await tool.execute!({ command: 'pwd' } as never, CALL_OPTIONS)) as string
    expect(output.trim()).toBe(process.cwd())
  })

  posixIt('returns stderr and non-zero exit codes without throwing', async () => {
    const tool = createBashTool({ workspacePath: process.cwd() })
    const output = (await tool.execute!({ command: 'echo out; echo err >&2; exit 3' } as never, CALL_OPTIONS)) as string
    expect(output).toContain('out')
    expect(output).toContain('stderr:\nerr')
    expect(output).toContain('Exit code: 3')
  })

  posixIt('caps combined output and marks truncation', async () => {
    const tool = createBashTool({ workspacePath: process.cwd() })
    const output = (await tool.execute!({ command: 'seq 1 50000' } as never, CALL_OPTIONS)) as string
    expect(output).toContain('[output truncated')
    expect(output.length).toBeLessThan(MAX_BASH_OUTPUT_CHARS + 500)
  })

  posixIt(
    'kills the whole process tree on timeout',
    async () => {
      const promise = runBoundedCommand('sleep 30 & echo child:$!; wait', {
        cwd: process.cwd(),
        timeoutMs: 300
      })
      await expect(promise).rejects.toThrow('timed out after 300ms')
      const message = await promise.catch((error: Error) => error.message)
      const childPid = Number(/child:(\d+)/.exec(message)?.[1])
      expect(childPid).toBeGreaterThan(0)
      await expect(waitForProcessExit(childPid)).resolves.toBe(true)
    },
    15_000
  )

  posixIt(
    'kills the command on abort',
    async () => {
      const controller = new AbortController()
      const promise = runBoundedCommand('sleep 30', {
        cwd: process.cwd(),
        timeoutMs: 60_000,
        signal: controller.signal
      })
      setTimeout(() => controller.abort('test-abort'), 200)
      const startedAt = Date.now()
      await expect(promise).rejects.toThrow('Command aborted')
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    },
    15_000
  )

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('pre-aborted')
    await expect(
      runBoundedCommand('echo hi', { cwd: process.cwd(), timeoutMs: 1000, signal: controller.signal })
    ).rejects.toThrow('aborted before start')
  })

  posixIt('strips credential-shaped env vars from the command environment', async () => {
    process.env.CHERRY_TEST_SECRET_TOKEN = 'leak-me'
    process.env.CHERRY_TEST_PLAIN = 'visible'
    try {
      const tool = createBashTool({ workspacePath: process.cwd() })
      const output = (await tool.execute!(
        { command: 'echo "secret=[$CHERRY_TEST_SECRET_TOKEN] plain=[$CHERRY_TEST_PLAIN]"' } as never,
        CALL_OPTIONS
      )) as string
      expect(output).toContain('secret=[]')
      expect(output).toContain('plain=[visible]')
    } finally {
      delete process.env.CHERRY_TEST_SECRET_TOKEN
      delete process.env.CHERRY_TEST_PLAIN
    }
  })

  posixIt('executes the rtk-rewritten command when a rewrite is available', async () => {
    rtkRewrite.mockResolvedValue('echo rewritten')
    const tool = createBashTool({ workspacePath: process.cwd() })
    const output = (await tool.execute!({ command: 'echo original' } as never, CALL_OPTIONS)) as string
    expect(rtkRewrite).toHaveBeenCalledWith('echo original')
    expect(output.trim()).toBe('rewritten')
  })
})
