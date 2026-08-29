import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createSecretEnvHandoff } from '../secretEnvHandoff'

const execFileAsync = promisify(execFile)

describe.skipIf(process.platform === 'win32')('secret environment handoff', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'cherry-secret-env-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('delivers exact values to the final process without putting them in the command or on disk', async () => {
    const apiKey = 'secret $HOME $(touch nope) \' " = value'
    const baseUrl = 'https://gemini.example.test/v1?token=$TOKEN&mode=direct'
    const handoff = await createSecretEnvHandoff(tempRoot, {
      GEMINI_API_KEY: apiKey,
      GOOGLE_GEMINI_BASE_URL: baseUrl
    })

    const wrappedCommand = handoff.wrapCommand(`printf '%s\\n%s\\n' "$GEMINI_API_KEY" "$GOOGLE_GEMINI_BASE_URL"`)
    expect(wrappedCommand).not.toContain(apiKey)
    expect(wrappedCommand).not.toContain(baseUrl)
    expect((await stat(handoff.pipePath)).isFIFO()).toBe(true)
    expect((await stat(handoff.pipePath)).size).toBe(0)

    const finalProcess = execFileAsync(
      '/bin/sh',
      [
        '-c',
        `unset GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL; set -x; ${wrappedCommand}; printf '%s' "\${GEMINI_API_KEY-unset}"`
      ],
      { encoding: 'utf8' }
    )

    const [result] = await Promise.all([finalProcess, handoff.deliver()])
    expect(result.stdout).toBe(`${apiKey}\n${baseUrl}\nunset`)
    expect(result.stderr).not.toContain(apiKey)
    expect(result.stderr).not.toContain(baseUrl)
    await expect(stat(handoff.pipePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects values that cannot be represented as one inert environment record', async () => {
    await expect(createSecretEnvHandoff(tempRoot, { GEMINI_API_KEY: 'first\nsecond' })).rejects.toThrow(
      'GEMINI_API_KEY'
    )
  })

  it('removes an unused pipe and its private directory when disposed before delivery', async () => {
    const handoff = await createSecretEnvHandoff(tempRoot, { GEMINI_API_KEY: 'unused-secret' })
    const handoffDir = path.dirname(handoff.pipePath)

    await handoff.dispose()

    await expect(stat(handoff.pipePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(handoffDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
