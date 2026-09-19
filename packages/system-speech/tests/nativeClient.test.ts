import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { SystemSpeechNativeClient } from '../src/nativeClient'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function helper(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'speech-client-'))
  directories.push(directory)
  const helperPath = join(directory, 'helper')
  await writeFile(helperPath, `#!${process.execPath}\n${source}\n`)
  await chmod(helperPath, 0o700)
  return { directory, helperPath }
}

function response(value: unknown): string {
  return `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(JSON.stringify(value))}))`
}

describe('SystemSpeechNativeClient', () => {
  it('returns the transcript through the protocol without logging diagnostics', async () => {
    const setup = await helper(
      response({
        ok: true,
        value: { operation: 'transcribe', result: { locale: 'en_US', text: 'private transcript' } }
      })
    )
    const client = new SystemSpeechNativeClient(setup)
    await expect(
      client.request({ operation: 'transcribe', inputPath: '/private/input.wav', locale: 'en-US' })
    ).resolves.toEqual({
      operation: 'transcribe',
      result: { locale: 'en_US', text: 'private transcript' }
    })
  })

  it.each([
    {
      operation: 'synthesize',
      result: { outputPath: '/private/output.wav', voiceId: 'voice', sampleRate: 16000, channels: 1, frameCount: 16000 }
    },
    { operation: 'transcribe', result: { locale: 'en_US', text: 42 } },
    { operation: 'transcribe', result: {} }
  ])('rejects a response with a different operation or invalid payload', async (value) => {
    const setup = await helper(response({ ok: true, value }))
    await expect(
      new SystemSpeechNativeClient(setup).request({
        operation: 'transcribe',
        inputPath: '/private/input.wav',
        locale: 'en-US'
      })
    ).rejects.toMatchObject({ code: 'native_helper_failed' })
  })

  it('does not attach sensitive stderr or provider messages as error causes', async () => {
    const secret = '/private/user/audio.wav sensitive transcript'
    for (const source of [
      `process.stderr.write(${JSON.stringify(secret)}); process.exit(1)`,
      response({ ok: false, error: { code: 'transcription_failed', message: secret } })
    ]) {
      const setup = await helper(source)
      const error = await new SystemSpeechNativeClient(setup)
        .request({ operation: 'transcribe', inputPath: '/private/input.wav', locale: 'en-US' })
        .catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).not.toContain(secret)
      expect((error as Error).cause).toBeUndefined()
    }
  })

  it('joins termination before rejecting abort so a caller can safely reclaim files', async () => {
    const setup = await helper('')
    const ready = join(setup.directory, 'ready')
    const closed = join(setup.directory, 'closed')
    await writeFile(
      setup.helperPath,
      `#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(closed)},'done');process.exit(0)},80));fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)\n`
    )
    const controller = new AbortController()
    const result = new SystemSpeechNativeClient({ ...setup, killGraceMs: 500 })
      .request({ operation: 'capabilities', locale: 'en-US' }, { signal: controller.signal })
      .catch((error: unknown) => error)
    await vi.waitFor(async () => expect(await readFile(ready, 'utf8')).toBe('ready'))
    controller.abort(new Error('sensitive cancellation reason'))
    expect(await result).toMatchObject({ code: 'cancelled', message: 'cancelled' })
    expect(await readFile(closed, 'utf8')).toBe('done')
  })

  it('kills an uncooperative timed out helper and returns a stable timeout', async () => {
    const setup = await helper("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)")
    await expect(
      new SystemSpeechNativeClient({ ...setup, timeoutMs: 250, killGraceMs: 20 }).request({
        operation: 'capabilities',
        locale: 'en-US'
      })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('refuses malformed and oversized protocol output', async () => {
    for (const output of ['not json', 'x'.repeat(1_048_577)]) {
      const setup = await helper(`process.stdout.write(${JSON.stringify(output)})`)
      await expect(
        new SystemSpeechNativeClient(setup).request({ operation: 'capabilities', locale: 'en-US' })
      ).rejects.toMatchObject({ code: 'native_helper_failed' })
    }
  })
})
