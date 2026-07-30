import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { AbsoluteFilePathSchema } from '@shared/types/file'
import { afterEach, describe, expect, it } from 'vitest'

import {
  decodePortableAgentResumePoint,
  encodePortableAgentResumePoint,
  PortableAgentTranscriptStore
} from '../portableTranscriptStore'

const temporaryDirectories: string[] = []

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portable-agent-transcript-'))
  temporaryDirectories.push(root)
  const directory = AbsoluteFilePathSchema.parse(path.join(root, 'transcripts'))
  const file = AbsoluteFilePathSchema.parse(path.join(directory, 'session.json'))
  return { file, store: new PortableAgentTranscriptStore(file, directory) }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('PortableAgentTranscriptStore', () => {
  it('round-trips portable resume points and keeps raw pre-feature tokens readable', () => {
    const encoded = encodePortableAgentResumePoint({
      sessionId: '11111111-1111-4111-8111-111111111111',
      resumeSessionAt: '22222222-2222-4222-8222-222222222222'
    })

    expect(decodePortableAgentResumePoint(encoded)).toEqual({
      sessionId: '11111111-1111-4111-8111-111111111111',
      resumeSessionAt: '22222222-2222-4222-8222-222222222222'
    })
    expect(decodePortableAgentResumePoint('legacy-sdk-session')).toEqual({ sessionId: 'legacy-sdk-session' })
    expect(() => decodePortableAgentResumePoint('cherry-agent-resume-v1:not-base64-json')).toThrow(
      'Malformed portable Agent resume point'
    )
    expect(() =>
      decodePortableAgentResumePoint(
        `cherry-agent-resume-v1:${Buffer.from(JSON.stringify({ sessionId: '__proto__' })).toString('base64url')}`
      )
    ).toThrow('Malformed portable Agent resume point')
    expect(() => encodePortableAgentResumePoint({ sessionId: 'not-a-uuid' })).toThrow()
  })

  it('publishes only the completed main-transcript prefix', async () => {
    const { file, store } = await createStore()
    const key = { projectKey: 'producer-workspace', sessionId: 'sdk-session' }
    await store.append(key, [
      { type: 'user', uuid: 'user-1' },
      { type: 'assistant', uuid: 'assistant-1' },
      { type: 'progress', uuid: 'after-boundary' }
    ])
    await store.append({ ...key, subpath: 'subagents/agent-1' }, [{ type: 'assistant', uuid: 'subagent-1' }])

    await store.commitTurn('sdk-session', 'assistant-1')

    expect(await store.load({ ...key, projectKey: 'target-rebased-workspace' })).toEqual([
      { type: 'user', uuid: 'user-1' },
      { type: 'assistant', uuid: 'assistant-1' }
    ])
    expect(await store.listSubkeys({ projectKey: 'ignored', sessionId: 'sdk-session' })).toEqual(['subagents/agent-1'])
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('does not expose uncommitted entries after a new SDK process loads the store', async () => {
    const { file, store } = await createStore()
    const key = { projectKey: 'workspace', sessionId: 'sdk-session' }
    await store.append(key, [
      { type: 'user', uuid: 'user-1' },
      { type: 'assistant', uuid: 'assistant-1' }
    ])
    await store.commitTurn('sdk-session', 'assistant-1')
    await store.append(key, [{ type: 'assistant', uuid: 'incomplete-turn' }])

    const reloaded = new PortableAgentTranscriptStore(file, AbsoluteFilePathSchema.parse(path.dirname(file)))
    expect(await reloaded.load(key)).toEqual([
      { type: 'user', uuid: 'user-1' },
      { type: 'assistant', uuid: 'assistant-1' }
    ])
  })

  it('deduplicates replayed UUID entries while retaining UUID-less markers', async () => {
    const { store } = await createStore()
    const key = { projectKey: 'workspace', sessionId: 'sdk-session' }
    await store.append(key, [
      { type: 'user', uuid: 'user-1' },
      { type: 'mode', mode: 'plan' }
    ])
    await store.append(key, [
      { type: 'user', uuid: 'user-1' },
      { type: 'mode', mode: 'default' },
      { type: 'assistant', uuid: 'assistant-1' }
    ])

    await store.commitTurn('sdk-session', 'assistant-1')

    expect(await store.load(key)).toEqual([
      { type: 'user', uuid: 'user-1' },
      { type: 'mode', mode: 'plan' },
      { type: 'mode', mode: 'default' },
      { type: 'assistant', uuid: 'assistant-1' }
    ])
  })
})
