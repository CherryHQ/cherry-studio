import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildLaunchOverlay, reclaimLaunchOverlays, reconcileLaunchOverlay } from '../launchOverlay'

let root: string
let realHome: string
let overlays: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'launch-overlay-'))
  realHome = path.join(root, 'real')
  overlays = path.join(root, 'overlays')
  await fs.mkdir(path.join(realHome, 'sessions'), { recursive: true })
  await fs.writeFile(path.join(realHome, 'config.toml'), 'user = true\n')
  await fs.writeFile(path.join(realHome, 'auth.json'), '{"token":"user"}')
  await fs.writeFile(path.join(realHome, 'sessions', 'one.jsonl'), 'first\n')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const read = (file: string) => fs.readFile(file, 'utf8')
const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false
  )

async function build(name = 'launch', files = [{ relativePath: 'config.toml', content: 'cherry = true\n' }]) {
  const dir = path.join(overlays, name)
  return { dir, home: await buildLaunchOverlay(dir, realHome, files) }
}

describe('launch overlay home', () => {
  it('serves generated files and the user entries without changing the user home', async () => {
    const { dir, home } = await build()

    expect(await read(path.join(home, 'config.toml'))).toBe('cherry = true\n')
    expect(await read(path.join(home, 'auth.json'))).toBe('{"token":"user"}')
    expect(await read(path.join(home, 'sessions', 'one.jsonl'))).toBe('first\n')
    expect(await read(path.join(realHome, 'config.toml'))).toBe('user = true\n')

    await reconcileLaunchOverlay(dir)
    expect(await exists(dir)).toBe(false)
    expect(await read(path.join(realHome, 'config.toml'))).toBe('user = true\n')
    expect(await read(path.join(realHome, 'sessions', 'one.jsonl'))).toBe('first\n')
  })

  it('writes session data through shared directories immediately', async () => {
    const { dir, home } = await build()
    await fs.writeFile(path.join(home, 'sessions', 'two.jsonl'), 'second\n')

    expect(await read(path.join(realHome, 'sessions', 'two.jsonl'))).toBe('second\n')
    await reconcileLaunchOverlay(dir)
    expect(await read(path.join(realHome, 'sessions', 'two.jsonl'))).toBe('second\n')
  })

  it('moves entries the CLI created into the user home and keeps an entry the user created meanwhile', async () => {
    const { dir, home } = await build()
    await fs.mkdir(path.join(home, 'skills'))
    await fs.writeFile(path.join(home, 'skills', 'note.md'), 'skill')
    await fs.writeFile(path.join(home, 'history.json'), 'launch')
    await fs.writeFile(path.join(realHome, 'history.json'), 'user')

    await reconcileLaunchOverlay(dir)
    expect(await read(path.join(realHome, 'skills', 'note.md'))).toBe('skill')
    expect(await read(path.join(realHome, 'history.json'))).toBe('user')
  })

  it('writes back a replaced file only while the user file is unchanged', async () => {
    const first = await build('first')
    const second = await build('second')
    const replace = async (home: string, content: string) => {
      await fs.writeFile(path.join(home, 'auth.tmp'), content)
      await fs.rename(path.join(home, 'auth.tmp'), path.join(home, 'auth.json'))
    }
    await replace(first.home, '{"token":"rotated"}')
    await replace(second.home, '{"token":"stale"}')

    await reconcileLaunchOverlay(first.dir)
    expect(await read(path.join(realHome, 'auth.json'))).toBe('{"token":"rotated"}')
    await reconcileLaunchOverlay(second.dir)
    expect(await read(path.join(realHome, 'auth.json'))).toBe('{"token":"rotated"}')
  })

  it('deletes a file the CLI deleted but never a directory whose link it removed', async () => {
    const { dir, home } = await build()
    await fs.unlink(path.join(home, 'auth.json'))
    await fs.unlink(path.join(home, 'sessions'))

    await reconcileLaunchOverlay(dir)
    expect(await exists(path.join(realHome, 'auth.json'))).toBe(false)
    expect(await read(path.join(realHome, 'sessions', 'one.jsonl'))).toBe('first\n')
  })

  it('splits nested directories down to the generated file and shares their other entries', async () => {
    await fs.mkdir(path.join(realHome, 'v2'))
    await fs.writeFile(path.join(realHome, 'v2', 'config.json'), '{"user":true}')
    await fs.writeFile(path.join(realHome, 'v2', 'state.json'), '{}')
    const { dir, home } = await build('nested', [{ relativePath: path.join('v2', 'config.json'), content: '{}' }])

    expect((await fs.lstat(path.join(home, 'v2'))).isSymbolicLink()).toBe(false)
    expect(await read(path.join(home, 'v2', 'state.json'))).toBe('{}')
    expect(await read(path.join(home, 'config.toml'))).toBe('user = true\n')
    await reconcileLaunchOverlay(dir)
    expect(await read(path.join(realHome, 'v2', 'config.json'))).toBe('{"user":true}')
  })

  it('creates the user home on demand when the CLI never ran before', async () => {
    const dir = path.join(overlays, 'fresh')
    const fresh = path.join(root, 'fresh-home')
    const home = await buildLaunchOverlay(dir, fresh, [{ relativePath: 'config.yaml', content: 'a: 1' }])
    await fs.writeFile(path.join(home, 'sessions.db'), 'db')

    await reconcileLaunchOverlay(dir)
    expect(await read(path.join(fresh, 'sessions.db'))).toBe('db')
    expect(await exists(path.join(fresh, 'config.yaml'))).toBe(false)
  })

  it('reclaims leftovers by the same rules and skips overlays still in use', async () => {
    const left = await build('left')
    const live = await build('live')
    await fs.writeFile(path.join(left.home, 'created.txt'), 'kept')

    await reclaimLaunchOverlays(overlays, new Set([live.dir]))
    expect(await read(path.join(realHome, 'created.txt'))).toBe('kept')
    expect(await exists(left.dir)).toBe(false)
    expect(await exists(live.home)).toBe(true)
  })

  it('only removes an overlay whose build never finished, even when it lists shared entries', async () => {
    const { dir, home } = await build()
    const manifest = JSON.parse(await read(path.join(dir, 'manifest.json')))
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, ready: false }))
    await fs.unlink(path.join(home, 'auth.json'))

    await reconcileLaunchOverlay(dir)
    expect(await read(path.join(realHome, 'auth.json'))).toBe('{"token":"user"}')
    expect(await exists(dir)).toBe(false)
  })
})
