import { expect, it, vi } from 'vitest'

import { themeRequestSchemas } from '@shared/ipc/schemas/theme'

import { themeHandlers } from '../theme'

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn<typeof globalThis.fetch>() }))
vi.mock('electron', () => ({ net: { fetch } }))

it('posts the selected preview and review metadata with the same key on retry', async () => {
  const bytes = Uint8Array.of(1, 2, 3)
  const input = themeRequestSchemas['theme.marketplace.submit'].input.parse({
    key: crypto.randomUUID(),
    name: 'Night',
    author: 'Author',
    version: '1.2',
    code: ':root { color: white }',
    cdn_link: '',
    title: ['Dark'],
    light_pic: null,
    dark_pic: { name: 'night.png', type: 'image/png', bytes }
  })
  const submit = () => themeHandlers['theme.marketplace.submit'](input, { senderId: 'test' })
  fetch
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
  await expect(submit()).rejects.toThrow('503')
  await submit()
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toBe('https://cherryai.com.cn/api/website/theme-submissions')
    expect(options).toMatchObject({ method: 'POST', headers: { 'Idempotency-Key': input.key } })
    const form = options!.body as FormData
    expect(JSON.parse(String(form.get('content')))).toEqual({
      name: 'Night',
      author: 'Author',
      version: '1.2',
      code: input.code,
      cdn_link: '',
      title: ['Dark'],
      description: '',
      light_mode: false,
      dark_mode: true
    })
    expect(form.has('light_pic')).toBe(false)
    const file = form.get('dark_pic') as File
    expect([file.name, file.type]).toEqual(['night.png', 'image/png'])
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
  }
})
