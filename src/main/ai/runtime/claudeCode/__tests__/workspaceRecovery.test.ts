import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { afterEach, expect, it } from 'vitest'

import { runForkWorker } from '../../fork'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function nativeWorker(file: string, workerData: object, configDir: string) {
  const source = stripTypeScriptTypes(
    await readFile(path.resolve('src/main/ai/runtime/claudeCode', file), 'utf8')
  ).replaceAll(
    '@anthropic-ai/claude-agent-sdk',
    pathToFileURL(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')).href
  )
  return runForkWorker(
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
      workerData,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
    }),
    AbortSignal.timeout(15_000)
  )
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-workspace-recovery-'))
  roots.push(root)
  const configDir = path.join(root, '.claude')
  const oldCwd = path.join(root, 'missing')
  const targetCwd = path.join(root, 'renamed')
  await mkdir(targetCwd, { recursive: true })
  const keys = (await nativeWorker('relocationWorker.ts', { oldCwd, newCwd: targetCwd }, configDir)) as {
    oldKey: string
    newKey: string
  }
  const nativeThreadId = randomUUID()
  const source = path.join(configDir, 'projects', keys.oldKey, `${nativeThreadId}.jsonl`)
  const target = path.join(configDir, 'projects', keys.newKey, `${nativeThreadId}.jsonl`)
  const entry = {
    type: 'user',
    sessionId: nativeThreadId,
    uuid: randomUUID(),
    parentUuid: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: oldCwd,
    message: { role: 'user', content: 'Keep the original history' }
  }
  await mkdir(path.dirname(source), { recursive: true })
  const content = JSON.stringify(entry) + '\n'
  await writeFile(source, content)
  return { configDir, targetCwd, sourceCwd: oldCwd, nativeThreadId, source, target, content }
}

it('copies renamed-workspace history to the SDK project key and reopens it without deleting the source', async () => {
  const f = await fixture()
  expect(await nativeWorker('workspaceRecoveryWorker.ts', f, f.configDir)).toEqual({ verified: true })
  expect(await readFile(f.source, 'utf8')).toBe(f.content)
  expect(await readFile(f.target, 'utf8')).toBe(f.content)
  expect(await nativeWorker('workspaceRecoveryWorker.ts', f, f.configDir)).toEqual({ verified: true })
})

it('rejects ambiguous source transcripts without publishing or removing either', async () => {
  const f = await fixture()
  const other = path.join(f.configDir, 'projects', 'another', `${f.nativeThreadId}.jsonl`)
  await mkdir(path.dirname(other), { recursive: true })
  await writeFile(other, f.content)
  await expect(
    nativeWorker('workspaceRecoveryWorker.ts', { ...f, sourceCwd: path.join(f.sourceCwd, 'unknown') }, f.configDir)
  ).rejects.toThrow('missing or ambiguous')
  await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(f.source, 'utf8')).toBe(f.content)
  expect(await readFile(other, 'utf8')).toBe(f.content)
})

it('fails closed for missing history without creating a target transcript', async () => {
  const f = await fixture()
  await rm(f.source)
  await expect(nativeWorker('workspaceRecoveryWorker.ts', f, f.configDir)).rejects.toThrow('missing or ambiguous')
  await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('never overwrites an existing conflicting target transcript', async () => {
  const f = await fixture()
  await mkdir(path.dirname(f.target), { recursive: true })
  await writeFile(f.target, 'different existing history')
  await expect(nativeWorker('workspaceRecoveryWorker.ts', f, f.configDir)).rejects.toThrow('Conflicting Claude history')
  expect(await readFile(f.target, 'utf8')).toBe('different existing history')
  expect(await readFile(f.source, 'utf8')).toBe(f.content)
})

it('keeps child archive files with the copied native session', async () => {
  const f = await fixture()
  const child = path.join(path.dirname(f.source), f.nativeThreadId, 'subagents', 'agent-child.jsonl')
  await mkdir(path.dirname(child), { recursive: true })
  await writeFile(child, f.content)
  await nativeWorker('workspaceRecoveryWorker.ts', f, f.configDir)
  const targetChild = path.join(path.dirname(f.target), f.nativeThreadId, 'subagents', 'agent-child.jsonl')
  expect(await readFile(targetChild, 'utf8')).toBe(f.content)
  expect(await readFile(child, 'utf8')).toBe(f.content)
})
