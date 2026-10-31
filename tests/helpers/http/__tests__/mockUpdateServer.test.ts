import { expect, it } from 'vitest'
import { parse } from 'yaml'

import { startMockUpdateServer } from '../mockUpdateServer'
import { unusedPort } from '../server'

it('serves the running version for platform and edition channels without providing an installer', async () => {
  const feed = `http://127.0.0.1:${await unusedPort()}/updates`
  const server = await startMockUpdateServer(feed, '2.1.8')
  try {
    for (const channel of ['latest', 'latest-cn', 'latest-mac', 'rc']) {
      const response = await fetch(`${feed}/${channel}.yml?noCache=123`)
      expect(response.status).toBe(200)
      expect(parse(await response.text())).toMatchObject({ version: '2.1.8', files: [] })
    }
    expect((await fetch(`${feed}/setup.exe`)).status).toBe(404)
    expect((await fetch(`${feed}/latest.yml`, { method: 'POST' })).status).toBe(404)
  } finally {
    await server.close()
  }
})

it('refuses an occupied feed port and leaves its existing server intact', async () => {
  const feed = `http://127.0.0.1:${await unusedPort()}`
  const original = await startMockUpdateServer(feed, '2.1.8')
  try {
    await expect(startMockUpdateServer(feed, '9.9.9')).rejects.toMatchObject({ code: 'EADDRINUSE' })
    const response = await fetch(`${feed}/latest.yml`)
    expect(parse(await response.text()).version).toBe('2.1.8')
  } finally {
    await original.close()
  }
  const replacement = await startMockUpdateServer(feed, '2.1.9')
  try {
    const response = await fetch(`${feed}/latest.yml`)
    expect(parse(await response.text()).version).toBe('2.1.9')
  } finally {
    await replacement.close()
  }
})

it.each(['http://0.0.0.0:3378', 'https://127.0.0.1:3378', 'http://example.com:3378'])(
  'refuses a non-loopback HTTP fixture address: %s',
  async (url) => {
    await expect(startMockUpdateServer(url, '2.1.8')).rejects.toThrow('HTTP feed on 127.0.0.1')
  }
)
