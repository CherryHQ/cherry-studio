import { mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { SystemSpeechNativeClient } from '../src/SystemSpeechNativeClient'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const request = { operation: 'synthesize_stream', voiceId: 'exact.voice', text: 'private speech', speed: 1.25 } as const
const format = { type: 'format', sampleRate: 22050, channels: 1 }
function pcm(startFrame = 0, samples = [0.25, -0.5, 0.75]) {
  const bytes = Buffer.alloc(samples.length * 4)
  samples.forEach((value, index) => bytes.writeFloatLE(value, index * 4))
  return { type: 'pcm', startFrame, data: bytes.toString('base64') }
}
function lines(...frames: unknown[]) {
  return frames.map((frame) => JSON.stringify(frame) + '\n').join('')
}
async function helper(source: string, timeoutMs = 2000) {
  const directory = await mkdtemp(join(tmpdir(), 'speech-stream-'))
  directories.push(directory)
  const helperPath = join(directory, 'helper')
  const sourcePath = join(directory, 'scenario.cjs')
  await writeFile(sourcePath, `process.stdin.resume();\n${source}\n`)
  // Keep the executable immutable: Linux can reject a newly written executable with ETXTBSY.
  await symlink(fileURLToPath(new URL('./fixtures/runScenario.cjs', import.meta.url)), helperPath)
  return { directory, sourcePath, client: new SystemSpeechNativeClient({ helperPath, timeoutMs, killGraceMs: 250 }) }
}

describe.skipIf(process.platform === 'win32')('system speech streaming process contract', () => {
  it('runs a writable scenario without executing its writable inode', async () => {
    const { client, sourcePath } = await helper(
      `process.stdout.write(${JSON.stringify(lines(format, pcm(), { type: 'end', frames: 3 }))})`
    )
    const writer = await open(sourcePath, 'r+')
    try {
      const stream = await client.stream(request)
      const samples: number[] = []
      for await (const chunk of (await stream.output).chunks) samples.push(...chunk.samples)
      await stream.completed
      await stream.closed
      expect(samples).toEqual([0.25, -0.5, 0.75])
    } finally {
      await writer.close()
    }
  })

  it('delivers early PCM without losing fragmented lines or the final tail, and joins exit', async () => {
    const data = lines(format, pcm(), pcm(3, [-0.25]), { type: 'end', frames: 4 })
    const { client } = await helper(`
      const data=${JSON.stringify(data)};
      process.stdout.write(data.slice(0,7));
      setTimeout(()=>process.stdout.write(data.slice(7)),20);
      setTimeout(()=>process.exit(0),180);
    `)
    const stream = await client.stream(request)
    let closed = false
    void stream.closed.then(() => {
      closed = true
    })
    const output = await stream.output
    expect(output.format).toEqual({ sampleRate: 22050, channels: 1 })
    const chunks = output.chunks[Symbol.asyncIterator]()
    expect(await chunks.next()).toMatchObject({
      value: { startFrame: 0, samples: new Float32Array([0.25, -0.5, 0.75]) }
    })
    expect(closed).toBe(false)
    expect(await chunks.next()).toMatchObject({ value: { startFrame: 3, samples: new Float32Array([-0.25]) } })
    expect(await chunks.next()).toEqual({ done: true, value: undefined })
    await stream.completed
    expect(closed).toBe(true)
  })

  it.each([
    lines(format, pcm()),
    lines(format, pcm(1), { type: 'end', frames: 3 }),
    lines(format, pcm(0, [NaN]), { type: 'end', frames: 1 }),
    lines(format, pcm(), { type: 'end', frames: 4 }),
    lines(format, pcm(), { type: 'end', frames: 3 }, pcm(3)),
    lines(format, format),
    lines(format, { type: 'pcm', startFrame: 0, data: '!!!!' }),
    lines({ ...format, channels: 2 }, pcm()),
    lines(format, pcm(0, Array(1025).fill(0))),
    lines(format) + 'x'.repeat(16385),
    lines(format) + '{"type":"end"',
    lines({ ...format, sampleRate: 0 })
  ])('rejects malformed, discontinuous, oversized or truncated PCM output', async (data) => {
    const { client } = await helper(`process.stdout.write(${JSON.stringify(data)})`)
    const stream = await client.stream(request)
    const consume = (async () => {
      const output = await stream.output
      let samples = 0
      for await (const chunk of output.chunks) samples += chunk.samples.length
      return samples
    })()
    await expect(consume).rejects.toMatchObject({ code: 'native_helper_failed' })
    await expect(stream.completed).rejects.toMatchObject({ code: 'native_helper_failed' })
    await stream.closed
  })

  it('waits for native cleanup when cancelled while downstream is paused', async () => {
    const { directory, client } = await helper(`
      const fs=require('node:fs'), path=require('node:path');
      process.stdout.on('error',()=>{});
      process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(path.join(__dirname,'closed'),'yes');process.exit(0)},80));
      process.stdout.write(${JSON.stringify(lines(format, pcm()))});
      setInterval(()=>{process.stdout.write(${JSON.stringify(lines(pcm(3)))})},1);
    `)
    const stream = await client.stream(request)
    await stream.output
    await stream.cancel()
    expect(await readFile(join(directory, 'closed'), 'utf8')).toBe('yes')
    await expect(stream.completed).rejects.toMatchObject({ code: 'cancelled' })
    await stream.cancel()
  })

  it('does not time out downstream pause but times out a pending producer read', async () => {
    const { client } = await helper(
      `process.stdout.write(${JSON.stringify(lines(format, pcm()))});setInterval(()=>{},1000)`,
      1000
    )
    const stream = await client.stream(request)
    const output = await stream.output
    const chunks = output.chunks[Symbol.asyncIterator]()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect((await chunks.next()).done).toBe(false)
    await expect(chunks.next()).rejects.toMatchObject({ code: 'timeout' })
    await expect(stream.completed).rejects.toMatchObject({ code: 'timeout' })
    await stream.closed
  })

  it('keeps a slow consumer from allowing the producer to buffer the whole utterance', async () => {
    const { directory, client } = await helper(`
      const fs=require('node:fs'), path=require('node:path'), {once}=require('node:events');
      (async()=>{
        process.stdout.write(${JSON.stringify(lines(format))});
        const data=${JSON.stringify(pcm(0, Array(1024).fill(0.25)).data)};
        for(let i=0;i<500;i++){
          if(!process.stdout.write(JSON.stringify({type:'pcm',startFrame:i*1024,data})+'\\n'))await once(process.stdout,'drain');
        }
        fs.writeFileSync(path.join(__dirname,'produced'),'yes');
        process.stdout.end(JSON.stringify({type:'end',frames:512000})+'\\n');
      })();
    `)
    const stream = await client.stream(request)
    const output = await stream.output
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(readFile(join(directory, 'produced'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    let frames = 0
    for await (const chunk of output.chunks) frames += chunk.samples.length
    await stream.completed
    expect(frames).toBe(512000)
    expect(await readFile(join(directory, 'produced'), 'utf8')).toBe('yes')
  })

  it('terminates and joins the helper when a consumer exits early', async () => {
    const { client } = await helper(
      `process.stdout.write(${JSON.stringify(lines(format, pcm()))});setInterval(()=>{},1000)`
    )
    const stream = await client.stream(request)
    for await (const chunk of (await stream.output).chunks) {
      expect(chunk.samples[0]).toBe(0.25)
      break
    }
    await stream.closed
    await expect(stream.completed).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('rejects a crash even with a valid end marker and keeps native diagnostics private', async () => {
    const { client } = await helper(
      `process.stderr.write('private transcript');process.stdout.write(${JSON.stringify(lines(format, pcm(), { type: 'end', frames: 3 }))},()=>process.exit(2))`
    )
    const stream = await client.stream(request)
    await expect(stream.completed).rejects.toMatchObject({
      code: 'native_helper_failed',
      message: 'native_helper_failed'
    })
    await stream.closed
  })

  it('preserves a missing-voice error without retaining its native message', async () => {
    const { client } = await helper(
      `process.stdout.write(${JSON.stringify(lines({ ok: false, error: { code: 'voice_unavailable', message: 'private details' } }))})`
    )
    const stream = await client.stream(request)
    await expect(stream.output).rejects.toMatchObject({ code: 'voice_unavailable', message: 'voice_unavailable' })
    await expect(stream.completed).rejects.toMatchObject({ code: 'voice_unavailable' })
  })

  it('discards unread PCM on abort even after the helper has already exited', async () => {
    const { client } = await helper(
      `process.stdout.write(${JSON.stringify(lines(format, pcm(), { type: 'end', frames: 3 }))})`
    )
    const controller = new AbortController()
    const stream = await client.stream(request, { signal: controller.signal })
    const output = await stream.output
    await stream.closed
    controller.abort()
    await expect(stream.completed).rejects.toMatchObject({ code: 'cancelled' })
    await expect(output.chunks[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('aborts before the first format and waits for exit', async () => {
    const { client } = await helper('setInterval(()=>{},1000)')
    const controller = new AbortController()
    const stream = await client.stream(request, { signal: controller.signal })
    controller.abort()
    await expect(stream.output).rejects.toMatchObject({ code: 'cancelled' })
    await stream.closed
    await expect(stream.completed).rejects.toMatchObject({ code: 'cancelled' })
  })
})
