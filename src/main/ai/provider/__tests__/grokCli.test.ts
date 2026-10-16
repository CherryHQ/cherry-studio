import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gte } from 'semver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildGrokCliRequestHeaders,
  normalizeGrokModelId,
  pickGrokClientVersion,
  resolveGrokClientVersion,
  rewriteGrokCliResponsesBody
} from '../grokCli'

describe('rewriteGrokCliResponsesBody', () => {
  it('hoists system/developer turns into instructions and drops them from input', () => {
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-build',
      instructions: 'base',
      input: [
        { role: 'system', content: 'you are helpful' },
        { role: 'developer', content: [{ type: 'input_text', text: 'be terse' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] }
      ]
    })
    expect(out.instructions).toBe('base\n\nyou are helpful\n\nbe terse')
    expect(out.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
  })

  it('drops empty reasoning and empty-content turns', () => {
    const out = rewriteGrokCliResponsesBody({
      input: [
        { type: 'reasoning', summary: [] },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'keep me' }
      ]
    })
    expect(out.input).toEqual([{ role: 'user', content: 'keep me' }])
  })

  it('strips unsupported legacy effort and cache retention without losing encrypted reasoning', () => {
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-build',
      reasoning: { effort: 'high' },
      prompt_cache_retention: '24h',
      include: ['reasoning.encrypted_content', 'file_search_call.results'],
      response_format: { type: 'json_object' }
    })
    expect(out.reasoning).toBeUndefined()
    expect(out.prompt_cache_retention).toBeUndefined()
    expect(out.include).toEqual(['reasoning.encrypted_content', 'file_search_call.results'])
    expect(out.text).toEqual({ format: { type: 'json_object' } })
    expect(out.response_format).toBeUndefined()
  })

  it.each(['grok-build', 'grok-composer-2.5-fast'])('omits effort for legacy model %s', (model) => {
    expect(rewriteGrokCliResponsesBody({ model, reasoning: { effort: 'high' } }).reasoning).toBeUndefined()
  })

  it.each(['low', 'medium', 'high', 'xhigh'])('keeps Grok 4.7 effort %s without OpenAI summary options', (effort) => {
    const out = rewriteGrokCliResponsesBody({ model: 'grok-4.7', reasoning: { effort, summary: 'auto' } })
    expect(out.reasoning).toEqual({ effort })
  })

  it('preserves opaque reasoning between tool calls and their results', () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [] }
    const call = { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{}' }
    const result = { type: 'function_call_output', call_id: 'call_1', output: 'file content' }
    const out = rewriteGrokCliResponsesBody({
      model: 'grok-4.7',
      input: [reasoning, call, result],
      include: ['reasoning.encrypted_content', 'reasoning.encrypted_content']
    })
    expect(out.input).toEqual([reasoning, call, result])
    expect(out.include).toEqual(['reasoning.encrypted_content'])
    expect(out.store).toBe(false)
  })

  it('requests encrypted reasoning even when the SDK supplied no include', () => {
    expect(rewriteGrokCliResponsesBody({ model: 'grok-4.7' }).include).toEqual(['reasoning.encrypted_content'])
  })
})

describe('normalizeGrokModelId', () => {
  it('lower-cases and strips any provider prefix', () => {
    expect(normalizeGrokModelId('grok-cli/Grok-Build')).toBe('grok-build')
    expect(normalizeGrokModelId('grok-composer-2.5-fast')).toBe('grok-composer-2.5-fast')
  })
})

describe('buildGrokCliRequestHeaders', () => {
  it('sets the bearer token plus the Grok CLI proxy markers', () => {
    const headers = buildGrokCliRequestHeaders(
      { 'content-type': 'application/json' },
      { accessToken: 'tok', modelId: 'grok-cli/grok-build' }
    )
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('x-grok-client-identifier')).toBe('cherry-studio')
    expect(headers.get('x-xai-token-auth')).toBe('xai-grok-cli')
    expect(gte(headers.get('x-grok-client-version')!, '1.0.13')).toBe(true)
    expect(headers.get('x-authenticateresponse')).toBe('authenticate-response')
    expect(headers.get('x-grok-client-mode')).toBe('interactive')
    expect(headers.get('x-grok-model-override')).toBe('grok-build')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the model-override header when no model id is known', () => {
    const headers = buildGrokCliRequestHeaders(undefined, { accessToken: 'tok', modelId: '' })
    expect(headers.has('x-grok-model-override')).toBe(false)
  })
})

describe('pickGrokClientVersion', () => {
  const floor = '1.0.13'

  it('returns the floor when the file contents are null', () => {
    expect(pickGrokClientVersion(null, floor)).toBe(floor)
  })

  it('returns the floor when the file contents are empty', () => {
    expect(pickGrokClientVersion('', floor)).toBe(floor)
  })

  it('returns the floor on malformed JSON', () => {
    expect(pickGrokClientVersion('not json', floor)).toBe(floor)
  })

  it('returns the floor when the parsed object has no version fields', () => {
    expect(pickGrokClientVersion('{}', floor)).toBe(floor)
  })

  it('prefers stable_version over version', () => {
    const contents = JSON.stringify({ version: '1.0.0', stable_version: '1.0.52' })
    expect(pickGrokClientVersion(contents, floor)).toBe('1.0.52')
  })

  it('falls back to version when stable_version is missing', () => {
    const contents = JSON.stringify({ version: '1.0.52' })
    expect(pickGrokClientVersion(contents, floor)).toBe('1.0.52')
  })

  it('returns the floor when stable_version is not a valid semver', () => {
    const contents = JSON.stringify({ stable_version: 'not-a-version' })
    expect(pickGrokClientVersion(contents, floor)).toBe(floor)
  })

  it('clamps to the floor when the installed version is below floor', () => {
    const contents = JSON.stringify({ stable_version: '1.0.0' })
    expect(pickGrokClientVersion(contents, floor)).toBe(floor)
  })

  it('returns the floor verbatim when the parsed value exactly equals the floor', () => {
    expect(pickGrokClientVersion(JSON.stringify({ stable_version: floor }), floor)).toBe(floor)
  })

  it('accepts versions with a build metadata segment', () => {
    const contents = JSON.stringify({ stable_version: '1.0.50+meta' })
    expect(pickGrokClientVersion(contents, floor)).toBe('1.0.50+meta')
  })
})

describe('resolveGrokClientVersion', () => {
  let tmpDir: string
  let homedirSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = process.env.GROK_CLIENT_VERSION_OVERRIDE

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-test-'))
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
  })

  afterEach(() => {
    homedirSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalEnv === undefined) delete process.env.GROK_CLIENT_VERSION_OVERRIDE
    else process.env.GROK_CLIENT_VERSION_OVERRIDE = originalEnv
  })

  function writeVersionFile(contents: string): string {
    const dir = path.join(tmpDir, '.grok')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'version.json')
    fs.writeFileSync(file, contents, 'utf8')
    return file
  }

  it('returns the override env var when set, without reading disk', () => {
    process.env.GROK_CLIENT_VERSION_OVERRIDE = '9.9.9'
    writeVersionFile(JSON.stringify({ stable_version: '1.0.52' }))
    expect(resolveGrokClientVersion()).toBe('9.9.9')
  })

  it('reads ~/.grok/version.json stable_version when the file is present', () => {
    writeVersionFile(JSON.stringify({ version: '1.0.0', stable_version: '1.0.52' }))
    expect(resolveGrokClientVersion()).toBe('1.0.52')
  })

  it('falls back to the floor when the file is missing', () => {
    expect(resolveGrokClientVersion()).toBe('1.0.13')
  })

  it('falls back to the floor when the file is unreadable (bad JSON)', () => {
    writeVersionFile('this is not json')
    expect(resolveGrokClientVersion()).toBe('1.0.13')
  })

  it('clamps to the floor when the file version is below floor', () => {
    writeVersionFile(JSON.stringify({ stable_version: '1.0.0' }))
    expect(resolveGrokClientVersion()).toBe('1.0.13')
  })
})

describe('buildGrokCliRequestHeaders (runtime version)', () => {
  it('sets x-grok-client-version to a value at or above the floor', () => {
    const headers = buildGrokCliRequestHeaders(undefined, { accessToken: 'tok', modelId: 'grok-build' })
    const v = headers.get('x-grok-client-version')!
    // Don't pin an exact version (CI may or may not have ~/.grok/version.json);
    // just verify it parses and the major is >= 1.
    expect(v).toMatch(/^\d+\.\d+\.\d+/)
    expect(Number(v.split('.')[0])).toBeGreaterThanOrEqual(1)
  })
})
