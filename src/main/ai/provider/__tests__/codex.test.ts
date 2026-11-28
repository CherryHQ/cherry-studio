import { describe, expect, it } from 'vitest'

import {
  applyCodexFetchInit,
  buildCodexRequestHeaders,
  coerceCodexRequestBody,
  prepareCodexRequestBody
} from '../codex'

describe('coerceCodexRequestBody', () => {
  it('forces store:false and adds encrypted reasoning to include', () => {
    const out = coerceCodexRequestBody(JSON.stringify({ model: 'gpt-5.5', store: true }))
    const json = JSON.parse(out as string)
    expect(json.store).toBe(false)
    expect(json.include).toEqual(['reasoning.encrypted_content'])
  })

  it('drops max_output_tokens because the codex backend rejects it', () => {
    const out = coerceCodexRequestBody(JSON.stringify({ model: 'gpt-5.5', max_output_tokens: 32000 }))
    const json = JSON.parse(out as string)
    expect(json).not.toHaveProperty('max_output_tokens')
  })

  it('preserves existing include entries without duplicating', () => {
    const out = coerceCodexRequestBody(
      JSON.stringify({ include: ['file_search_call.results', 'reasoning.encrypted_content'] })
    )
    const json = JSON.parse(out as string)
    expect(json.include).toEqual(['file_search_call.results', 'reasoning.encrypted_content'])
  })

  it('passes through non-string and non-JSON bodies untouched', () => {
    expect(coerceCodexRequestBody(undefined)).toBeUndefined()
    expect(coerceCodexRequestBody('not json')).toBe('not json')
  })
})

describe('buildCodexRequestHeaders', () => {
  it('sets the bearer token, account id and codex markers', () => {
    const headers = buildCodexRequestHeaders(
      { 'content-type': 'application/json' },
      { accessToken: 'tok', accountId: 'acct-1' }
    )
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('chatgpt-account-id')).toBe('acct-1')
    expect(headers.get('OpenAI-Beta')).toBe('responses=experimental')
    expect(headers.get('originator')).toBe('cherry-studio')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the account id header when none is known', () => {
    const headers = buildCodexRequestHeaders(undefined, { accessToken: 'tok', accountId: null })
    expect(headers.has('chatgpt-account-id')).toBe(false)
  })
})

const CODEX_EDIT_URL = 'https://chatgpt.com/backend-api/codex/images/edits'

describe('Codex image edit requests', () => {
  it('sends JSON image references to /images/edits and keeps the OAuth headers', async () => {
    const form = new FormData()
    form.set('model', 'gpt-image-2')
    form.set('prompt', 'Add a red cap')
    form.set('n', '2')
    form.set('size', '1024x1024')
    form.append('image', new File([Uint8Array.from([1, 2, 3])], 'cap.png', { type: 'image/png' }))
    form.append('image', new File([Uint8Array.from([9])], 'two.webp', { type: 'image/webp' }))
    form.set('mask', new File([Uint8Array.from([4])], 'mask.png', { type: 'image/png' }))

    const body = await prepareCodexRequestBody(CODEX_EDIT_URL, form)
    const init = applyCodexFetchInit(
      CODEX_EDIT_URL,
      { method: 'POST', headers: { 'content-type': 'multipart/form-data' }, body: form },
      body,
      { accessToken: 'tok', accountId: 'acct-1' }
    )

    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
    expect(new Headers(init.headers).get('chatgpt-account-id')).toBe('acct-1')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-image-2',
      prompt: 'Add a red cap',
      n: 2,
      size: '1024x1024',
      images: [
        { image_url: 'data:image/png;base64,AQID' },
        { image_url: 'data:image/webp;base64,CQ==' }
      ],
      mask: { image_url: 'data:image/png;base64,BA==' }
    })
  })

  it('does not rewrite an image generation body as a Responses request', async () => {
    const raw = JSON.stringify({ model: 'gpt-image-2', prompt: 'a sun', store: true })
    const out = await prepareCodexRequestBody('https://chatgpt.com/backend-api/codex/images/generations', raw)
    expect(out).toBe(raw)
  })

  it('leaves a generation upload untouched', async () => {
    const form = new FormData()
    form.set('model', 'gpt-image-2')
    const out = await prepareCodexRequestBody('https://chatgpt.com/backend-api/codex/images/generations', form)
    expect(out).toBe(form)
  })

  it('still coerces Responses bodies', async () => {
    const out = await prepareCodexRequestBody(
      'https://chatgpt.com/backend-api/codex/responses',
      JSON.stringify({ model: 'gpt-5.5', store: true })
    )
    const json = JSON.parse(out as string)
    expect(json.store).toBe(false)
    expect(json.include).toEqual(['reasoning.encrypted_content'])
  })
})
