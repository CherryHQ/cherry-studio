import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { installBinaryAgent } from '../installBinary'
import { ownsNpmExecutable, ownsUvExecutable, uninstallBinaryAgent } from '../uninstall'

// Catch deleting a neighboring installation or following a replaced command outside its owner.
describe('local agent uninstall ownership', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ACP uninstall ' "))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const directory = path.join(root, key === 'external.acp.bin' ? 'bin' : 'agents')
      return file ? path.join(directory, file) : directory
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('#!/bin/sh\necho hello\n'))
    )
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await fs.rm(root, { recursive: true, force: true })
  })
  const install = (name: string) =>
    installBinaryAgent(
      name,
      {
        manager: 'binary',
        version: '1.0',
        archive: 'https://example.com/agent',
        cmd: 'agent'
      },
      new AbortController().signal
    )

  it('removes the installed wrapper and its bundle while retaining the other installation', async () => {
    const entry = await install('example')
    const other = await install('neighbor')
    expect(await uninstallBinaryAgent('example', entry)).toBe(true)
    await expect(fs.stat(entry)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(path.join(root, 'agents'))).every((name) => name.startsWith('neighbor-'))).toBe(true)
    expect(await fs.readFile(other, 'utf8')).toContain('neighbor-')
  })

  it('refuses a modified wrapper and preserves all installation files', async () => {
    const entry = await install('example')
    await fs.appendFile(entry, 'echo custom\n')
    expect(await uninstallBinaryAgent('example', entry)).toBe(false)
    expect(await fs.readFile(entry, 'utf8')).toContain('echo custom')
    expect(await fs.readdir(path.join(root, 'agents'))).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('refuses a replaced executable pointing outside the bundle', async () => {
    const entry = await install('example')
    const bundle = (await fs.readdir(path.join(root, 'agents')))[0]
    const executable = path.join(root, 'agents', bundle, 'files', 'agent')
    const outside = path.join(root, 'unrelated')
    await fs.writeFile(outside, 'keep')
    await fs.unlink(executable)
    await fs.symlink(outside, executable)
    expect(await uninstallBinaryAgent('example', entry)).toBe(false)
    expect(await fs.readFile(outside, 'utf8')).toBe('keep')
    expect(await fs.stat(entry)).toBeDefined()
  })

  it.skipIf(process.platform === 'win32')(
    'requires the detected npm command to resolve to a declared package bin',
    async () => {
      const directory = path.join(root, '@test', 'agent')
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: '@test/agent', bin: { agent: 'cli.js' } })
      )
      const target = path.join(directory, 'cli.js')
      const entry = path.join(root, 'agent')
      await fs.writeFile(target, 'cli')
      await fs.symlink(target, entry)
      expect(await ownsNpmExecutable(root, '@test/agent', entry)).toBe(true)
      await fs.unlink(entry)
      await fs.writeFile(entry, 'unrelated executable')
      expect(await ownsNpmExecutable(root, '@test/agent', entry)).toBe(false)
      expect(await ownsNpmExecutable(root, '@test/other', target)).toBe(false)
    }
  )
  it('resolves an npm Windows command shim to its declared package bin', async () => {
    const directory = path.join(root, 'node_modules', 'agent')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'agent', bin: 'cli.js' }))
    await fs.writeFile(path.join(directory, 'cli.js'), 'cli')
    const entry = path.join(root, 'agent.cmd')
    await fs.writeFile(entry, '@echo off\r\n"%dp0%\\node_modules\\agent\\cli.js" %*\r\n')
    expect(await ownsNpmExecutable(path.join(root, 'node_modules'), 'agent', entry)).toBe(true)
    await fs.writeFile(entry, '@echo off\r\necho replaced\r\n')
    expect(await ownsNpmExecutable(path.join(root, 'node_modules'), 'agent', entry)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('requires both a uv receipt and the original executable', async () => {
    const directory = path.join(root, 'example', 'bin')
    await fs.mkdir(directory, { recursive: true })
    const target = path.join(directory, 'agent')
    const entry = path.join(root, 'agent')
    await fs.writeFile(target, 'cli')
    await fs.symlink(target, entry)
    expect(await ownsUvExecutable(root, 'example', entry)).toBe(false)
    await fs.writeFile(
      path.join(root, 'example', 'uv-receipt.toml'),
      `[tool]\nentrypoints = [{ name = "agent", install-path = ${JSON.stringify(entry)} }]\n`
    )
    expect(await ownsUvExecutable(root, 'example', entry)).toBe(true)
    await fs.unlink(entry)
    await fs.writeFile(entry, 'replacement')
    expect(await ownsUvExecutable(root, 'example', entry)).toBe(false)
  })
  it.skipIf(process.platform === 'win32')('does not follow a replaced executable into another bundle', async () => {
    const entry = await install('example')
    await fs.unlink(entry)
    const secondEntry = await install('example')
    const wrapper = await fs.readFile(secondEntry, 'utf8')
    const bundles = await fs.readdir(path.join(root, 'agents'))
    const second = bundles.find((bundle) => wrapper.includes(bundle))!
    const first = bundles.find((bundle) => bundle !== second)!
    const secondCommand = path.join(root, 'agents', second, 'files', 'agent')
    const firstCommand = path.join(root, 'agents', first, 'files', 'agent')
    await fs.unlink(secondCommand)
    await fs.symlink(firstCommand, secondCommand)
    expect(await uninstallBinaryAgent('example', secondEntry)).toBe(false)
    expect(await fs.readFile(firstCommand, 'utf8')).toContain('hello')
    expect(await fs.readdir(path.join(root, 'agents'))).toHaveLength(2)
  })
})
