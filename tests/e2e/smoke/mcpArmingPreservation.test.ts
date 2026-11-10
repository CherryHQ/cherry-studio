import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'

import Database from 'better-sqlite3'

import type { DataRequest } from '@shared/data/api/types'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import { AssistantSchema } from '@shared/data/types/assistant'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import { TopicSchema } from '@shared/data/types/topic'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'

interface ArmingRow {
  assistant_id: string
  mcp_server_id: string
  created_at: number
  updated_at: number
}

interface FixtureProcess {
  pid: number
  ppid: number
  command: string
}

async function listProcesses(): Promise<FixtureProcess[]> {
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress -Depth 3'
      ],
      { timeout: 20_000 }
    )
    type WindowsProcess = { ProcessId: number; ParentProcessId: number; CommandLine: string | null }
    const parsed = JSON.parse(stdout) as WindowsProcess | WindowsProcess[]
    return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
      pid: entry.ProcessId,
      ppid: entry.ParentProcessId,
      command: entry.CommandLine ?? ''
    }))
  }
  const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,command='], { timeout: 20_000 })
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      if (!match) return []
      const [, pid, ppid, command] = match
      return [{ pid: Number(pid), ppid: Number(ppid), command }]
    })
}

function normalizeProcessPath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: string | undefined
  let started = false
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote) {
      if (quote === '"' && char === '\\' && command[index + 1] === '"') {
        token += '"'
        index++
      } else if (char === quote) {
        quote = undefined
      } else {
        token += char
      }
    } else if (char === '"') {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token)
      token = ''
      started = false
    } else {
      token += char
      started = true
    }
  }
  if (quote) return []
  if (started) tokens.push(token)
  return tokens
}

function fixtureProcesses(processes: FixtureProcess[], instance: string): FixtureProcess[] {
  const fixture = normalizeProcessPath(resolve('tests/e2e/smoke/fixtures/mcpArmingServer.mjs'))
  return processes.filter(({ command }) => {
    const args = tokenizeCommandLine(command)
    if (!args.length) return false
    const name = posix.basename(normalizeProcessPath(args[0]))
    return (
      (name === 'node' || name === 'node.exe') &&
      args.some((arg) => normalizeProcessPath(arg) === fixture) &&
      args.includes(instance)
    )
  })
}

async function waitForFixtureSnapshot(
  expectations: ReadonlyArray<{ instance: string; expected: number }>,
  timeoutMs = 30_000
): Promise<Map<string, FixtureProcess[]>> {
  const deadline = Date.now() + timeoutMs
  let processes: FixtureProcess[]
  let matches: Map<string, FixtureProcess[]>
  do {
    processes = await listProcesses()
    matches = new Map(expectations.map(({ instance }) => [instance, fixtureProcesses(processes, instance)]))
    if (expectations.every(({ instance, expected }) => matches.get(instance)!.length === expected)) return matches
    await setTimeout(100)
  } while (Date.now() < deadline)
  const fixture = normalizeProcessPath(resolve('tests/e2e/smoke/fixtures/mcpArmingServer.mjs'))
  const lines = processes
    .filter(({ command }) => normalizeProcessPath(command).includes(fixture))
    .map(({ pid, ppid, command }) => `${pid} ${ppid} ${command}`)
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for fixture snapshot:\n${expectations
      .map(({ instance, expected }) => `${instance}: expected ${expected}, observed ${matches.get(instance)!.length}`)
      .join('\n')}\nFixture process lines:\n${lines.join('\n') || '(none)'}`
  )
}

async function waitForProcessExit(pid: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let processes: FixtureProcess[]
  let matches: FixtureProcess[]
  do {
    processes = await listProcesses()
    matches = processes.filter((entry) => entry.pid === pid)
    if (matches.length === 0) return
    await setTimeout(100)
  } while (Date.now() < deadline)
  const fixture = normalizeProcessPath(resolve('tests/e2e/smoke/fixtures/mcpArmingServer.mjs'))
  const lines = processes
    .filter((entry) => entry.pid === pid || normalizeProcessPath(entry.command).includes(fixture))
    .map(({ pid, ppid, command }) => `${pid} ${ppid} ${command}`)
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for process ${pid} to exit: expected 0, observed ${matches.length}\nFixture process lines (including target pid):\n${lines.join('\n') || '(none)'}`
  )
}

async function killFixture(pid: number): Promise<'SIGKILL' | 'taskkill /F'> {
  if (process.platform === 'win32') {
    await promisify(execFile)('taskkill', ['/PID', String(pid), '/F'])
    return 'taskkill /F'
  }
  process.kill(pid, 'SIGKILL')
  return 'SIGKILL'
}

async function directoryListing(root: string): Promise<string[]> {
  const lines: string[] = []
  for (const directory of [
    root,
    ...(await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
  ]) {
    lines.push(`${directory}/`)
    try {
      lines.push(...(await readdir(directory)).map((name) => `  ${name}`))
    } catch (error) {
      lines.push(String(error))
    }
  }
  return lines
}

test('stdio drop and recovery preserve assistant MCP arming and retained timestamps', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(300_000)
  const attachJson = (name: string, value: unknown) =>
    testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
  const data = (request: Omit<DataRequest, 'id'>) =>
    page.evaluate((request) => window.api.dataApi.request(request), { ...request, id: randomUUID() })
  const fixture = resolve('tests/e2e/smoke/fixtures/mcpArmingServer.mjs')
  const profile = process.env.CS_DEV_PROFILE_ROOT?.trim()
  expect(profile, 'CS_DEV_PROFILE_ROOT must identify the launched disposable profile').toBeTruthy()
  expect(isAbsolute(profile!)).toBe(true)
  const databasePath = join(profile!, 'userData', 'data', 'cherrystudio.sqlite')
  if (!existsSync(databasePath)) {
    let listing: unknown
    try {
      listing = await directoryListing(profile!)
    } catch (error) {
      listing = String(error)
    }
    await attachJson('missing-database-directory-listing', { databasePath, profile, listing })
    throw new Error(`Application database not found: ${databasePath}; see missing-database-directory-listing`)
  }

  const serverIds: string[] = []
  let assistantId: string | undefined
  let topicId: string | undefined
  let db: Database.Database | undefined
  const cleanupErrors: string[] = []
  const statusSequence: { at: string; s: McpRuntimeStatus | null; t: McpRuntimeStatus | null }[] = []
  const tContinuityFailures: unknown[] = []
  const refreshAttempts: unknown[] = []
  const previous = await page.evaluate(
    async ({ privacyVersion }) => {
      const keys = ['app.privacy.policy_version', 'app.onboarding.provider_setup.status', 'app.language'] as const
      const snapshot = await Promise.all(keys.map((key) => window.api.preference.get(key)))
      await window.api.preference.setMultiple({
        'app.privacy.policy_version': privacyVersion,
        'app.onboarding.provider_setup.status': 'skipped',
        'app.language': 'en-US'
      })
      return snapshot
    },
    { privacyVersion: LATEST_PRIVACY_POLICY_VERSION }
  )

  try {
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const instances = [randomUUID(), randomUUID()]
    for (const [index, label] of ['S', 'T'].entries()) {
      const result = await data({
        method: 'POST',
        path: '/mcp-servers',
        body: {
          name: `MP24065 ${label}`,
          type: 'stdio',
          command: process.execPath,
          args: [fixture, instances[index]],
          env: { MP24065_INSTANCE: instances[index] },
          isActive: true,
          isTrusted: true
        }
      })
      expect(result.status, JSON.stringify(result)).toBe(201)
      serverIds.push(McpServerSchema.parse(result.data).id)
    }
    const [s, t] = serverIds
    const assistantName = `MP24065 assistant ${randomUUID()}`
    const topicName = `MP24065 recovery ${randomUUID()}`
    const assistant = await data({
      method: 'POST',
      path: '/assistants',
      body: {
        name: assistantName,
        modelId: null,
        mcpServerIds: [s, t]
      }
    })
    expect(assistant.status, JSON.stringify(assistant)).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const settings = await data({
      method: 'PATCH',
      path: `/assistants/${assistantId}`,
      body: { settings: { mcpMode: 'manual' } }
    })
    expect(settings.status, JSON.stringify(settings)).toBe(200)
    const topic = await data({ method: 'POST', path: '/topics', body: { name: topicName, assistantId } })
    expect(topic.status, JSON.stringify(topic)).toBe(201)
    topicId = TopicSchema.parse(topic.data).id

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(page.locator('[data-ui~="chat.composer"]:visible')).toBeVisible()

    const refresh = async (serverId: string) => {
      const result = await page.evaluate(async (serverId) => {
        try {
          await window.api.ipcApi.request('mcp.server.refresh_tools', { serverId })
          return { ok: true }
        } catch (error) {
          return { ok: false, error: String(error) }
        }
      }, serverId)
      refreshAttempts.push({ at: new Date().toISOString(), serverId, ...result })
    }
    const statuses = async (requireT = true) => {
      const value = await page.evaluate(
        async ([s, t]) => {
          const cache = await window.api.cache.getAllShared()
          return {
            s: cache[`mcp.status.${s}`]?.value as McpRuntimeStatus | undefined,
            t: cache[`mcp.status.${t}`]?.value as McpRuntimeStatus | undefined
          }
        },
        [s, t]
      )
      statusSequence.push({ at: new Date().toISOString(), s: value.s ?? null, t: value.t ?? null })
      if (requireT && value.t?.state !== 'connected') tContinuityFailures.push(statusSequence.at(-1))
      if (requireT) expect(tContinuityFailures, 'T must remain connected at every status sample').toEqual([])
      return value
    }
    for (const serverId of serverIds) await refresh(serverId)
    await expect
      .poll(
        async () => {
          const status = await statuses(false)
          return [status.s?.state, status.t?.state]
        },
        { timeout: 30_000 }
      )
      .toEqual(['connected', 'connected'])

    db = new Database(databasePath, { readonly: true, fileMustExist: true })
    const snapshot = async () => {
      const result = await data({ method: 'GET', path: `/assistants/${assistantId}` })
      expect(result.status, JSON.stringify(result)).toBe(200)
      return {
        rows: db!
          .prepare(`SELECT assistant_id, mcp_server_id, created_at, updated_at
          FROM assistant_mcp_server WHERE assistant_id = ? ORDER BY mcp_server_id`)
          .all(assistantId) as ArmingRow[],
        dataVersion: db!.pragma('data_version', { simple: true }),
        apiIds: [...AssistantSchema.parse(result.data).mcpServerIds].sort()
      }
    }
    const baseline = await snapshot()
    await attachJson('arming-baseline', { databasePath, assistantId, serverIds, instances, ...baseline })
    expect(baseline.rows.map((row) => row.mcp_server_id)).toEqual([...serverIds].sort())
    expect(baseline.apiIds).toEqual([...serverIds].sort())

    const logDirectory = join(profile!, 'logs')
    const logFiles = async () => {
      const files = await Promise.all(
        (await readdir(logDirectory))
          .filter((name) => /^app\.\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name))
          .map(async (name) => ({ path: join(logDirectory, name), ...(await stat(join(logDirectory, name))) }))
      )
      expect(files.length, `General app logs must exist under ${logDirectory}`).toBeGreaterThan(0)
      return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
    }
    const logOffsets = new Map((await logFiles()).map((file) => [file.path, file.size]))
    const auditLines = async () => {
      const files = await logFiles()
      const lines: string[] = []
      for (const file of files) {
        const start = logOffsets.get(file.path) ?? 0
        expect(file.size, `Log truncated during observation: ${file.path}`).toBeGreaterThanOrEqual(start)
        const length = file.size - start
        expect(length, `Log window exceeds retained tail: ${file.path}`).toBeLessThanOrEqual(8 * 1024 * 1024)
        const handle = await open(file.path, 'r')
        try {
          const buffer = Buffer.alloc(length)
          const { bytesRead } = await handle.read(buffer, 0, length, start)
          lines.push(
            ...buffer
              .subarray(0, bytesRead)
              .toString('utf8')
              .split('\n')
              .slice(0, -1)
              .filter((line) => line.includes('assistant.mcp-arming.changed') && line.includes(assistantId!))
          )
        } finally {
          await handle.close()
        }
      }
      return { newestFile: files[0].path, lines }
    }

    const preKillProcesses = await waitForFixtureSnapshot(instances.map((instance) => ({ instance, expected: 1 })))
    const children = instances.map((instance) => preKillProcesses.get(instance)!)
    await attachJson('pre-kill-processes', { instances, children })
    const processContext = `Fixture process lines:\n${children
      .flat()
      .map(({ command }) => command)
      .join('\n')}`
    expect(children[0], `S must have exactly one identifiable stdio child\n${processContext}`).toHaveLength(1)
    expect(children[1], `T must have exactly one identifiable stdio child\n${processContext}`).toHaveLength(1)
    const pid = children[0][0].pid
    const tPid = children[1][0].pid
    expect(pid).toBeGreaterThan(1)
    expect(tPid).toBeGreaterThan(1)
    expect(pid).not.toBe(tPid)
    const killedAt = new Date().toISOString()
    const mechanism = await killFixture(pid)
    await attachJson('kill-trace', { pid, tPid, killedAt, mechanism, lines: children.flat() })

    // No idle heartbeat exists, so drive the first failing request to observe the killed child disconnect.
    // Arming must remain untouched when the drop becomes observable.
    await expect
      .poll(
        async () => {
          const state = (await statuses()).s?.state
          if (state === 'connected') await refresh(s)
          return state !== undefined && state !== 'connected'
        },
        { timeout: 30_000, intervals: [100, 250, 500] }
      )
      .toBe(true)
    await waitForProcessExit(pid)
    const droppedProcesses = await waitForFixtureSnapshot([{ instance: instances[0], expected: 0 }])
    expect(droppedProcesses.get(instances[0])).toHaveLength(0)
    const afterDrop = await snapshot()
    await attachJson('arming-after-drop', afterDrop)
    expect(afterDrop.rows).toEqual(baseline.rows)
    expect(afterDrop.apiIds).toEqual(baseline.apiIds)
    await attachJson('drop-status-sequence', statusSequence)

    try {
      await refresh(s)
      await expect
        .poll(
          async () => {
            const state = (await statuses()).s?.state
            if (state !== 'connected') await refresh(s)
            return state
          },
          { timeout: 120_000, intervals: [250, 500, 1000] }
        )
        .toBe('connected')
    } catch (error) {
      try {
        const processes = await listProcesses()
        await attachJson('recovery-failure', {
          lastStatus: statusSequence.at(-1),
          refreshAttempts,
          processes: instances.map((instance) => ({ instance, matches: fixtureProcesses(processes, instance) }))
        })
      } catch (enumerationError) {
        await testInfo
          .attach('recovery-failure', { body: String(enumerationError), contentType: 'text/plain' })
          .catch(() => undefined)
      }
      throw error
    }
    const afterRecovery = await snapshot()
    await attachJson('arming-after-recovery', afterRecovery)
    expect(afterRecovery.rows).toEqual(baseline.rows)
    expect(afterRecovery.apiIds).toEqual(baseline.apiIds)
    const recoveryProcesses = await waitForFixtureSnapshot(instances.map((instance) => ({ instance, expected: 1 })))
    const recoveredS = recoveryProcesses.get(instances[0])!
    const survivingT = recoveryProcesses.get(instances[1])!
    await attachJson('recovered-processes', { instances, recoveredS, survivingT })
    expect(recoveredS).toHaveLength(1)
    expect(survivingT).toHaveLength(1)
    expect(recoveredS[0].pid).not.toBe(pid)
    expect(survivingT[0].pid).toBe(tPid)
    const recoveryLog = await auditLines()
    await attachJson('drop-recovery-audit-lines', recoveryLog)
    expect(recoveryLog.lines, 'Drop/recovery must not emit any arming delta for A').toEqual([])

    await expect(group).toBeVisible()
    await expect(chat.getByTestId('topic-list-row').filter({ hasText: topicName })).toBeVisible()
    await page.bringToFront()
    await page.waitForTimeout(250)
    await testInfo.attach('chat-after-recovery', {
      body: await captureMaskedScreenshot(page, getSensitiveConfigValues()),
      contentType: 'image/png'
    })

    const operationId = randomUUID()
    const unarm = await data({
      method: 'PATCH',
      path: `/assistants/${assistantId}`,
      body: { mcpServerIds: [t] },
      metadata: { timestamp: Date.now(), source: 'e2e.mp24065.manual-unarm', operationId }
    })
    expect(unarm.status, JSON.stringify(unarm)).toBe(200)
    const afterUnarm = await snapshot()
    await attachJson('arming-after-manual-unarm', afterUnarm)
    expect(afterUnarm.rows).toEqual(baseline.rows.filter((row) => row.mcp_server_id === t))
    expect(afterUnarm.apiIds).toEqual([t])
    await expect
      .poll(async () => (await auditLines()).lines.some((line) => line.includes(operationId)), { timeout: 15_000 })
      .toBe(true)
    const manualLog = await auditLines()
    await testInfo.attach('manual-unarm-audit-verbatim', {
      body: manualLog.lines.join('\n'),
      contentType: 'text/plain'
    })
    expect(manualLog.lines, 'Only the deliberate un-arm may change A in this window').toHaveLength(1)
    expect(JSON.parse(manualLog.lines[0])).toMatchObject({
      event: 'assistant.mcp-arming.changed',
      assistantId,
      beforeIds: [...serverIds].sort(),
      removedIds: [s],
      addedIds: [],
      afterIds: [t],
      source: 'e2e.mp24065.manual-unarm',
      actor: { kind: 'renderer' },
      operationId
    })
    await statuses()
  } catch (error) {
    await testInfo.attach('failure-body-text', {
      body: await page.evaluate(() => document.body.innerText).catch(String),
      contentType: 'text/plain'
    })
    throw error
  } finally {
    const cleanup = async (name: string, action: () => unknown) => {
      try {
        await action()
      } catch (error) {
        cleanupErrors.push(`${name}: ${String(error)}`)
      }
    }
    await cleanup('attach status sequence', () => attachJson('status-sequence', statusSequence))
    await cleanup('attach refresh attempts', () => attachJson('refresh-attempts', refreshAttempts))
    await cleanup('close read-only database', () => db?.close())
    if (assistantId) {
      await cleanup('archive assistant and topic', () =>
        page.evaluate(
          (assistantId) => window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true }),
          assistantId!
        )
      )
      if (topicId)
        await cleanup('delete topic', async () => {
          const result = await data({ method: 'DELETE', path: `/topics/${topicId}`, params: { permanent: true } })
          expect(result.status, JSON.stringify(result)).toBe(204)
        })
      await cleanup('delete assistant', async () => {
        const result = await data({ method: 'DELETE', path: `/assistants/${assistantId}`, params: { permanent: true } })
        expect(result.status, JSON.stringify(result)).toBe(200)
      })
    }
    for (const serverId of serverIds)
      await cleanup(`delete server ${serverId}`, async () => {
        const result = await data({ method: 'DELETE', path: `/mcp-servers/${serverId}` })
        if (result.status !== 200 && result.status !== 204) {
          await attachJson(`server-delete-fallback-${serverId}`, result)
          await page.evaluate((serverId) => window.api.ipcApi.request('mcp.server.remove', { serverId }), serverId)
        }
      })
    await cleanup('restore preferences', () =>
      page.evaluate(
        (previous) =>
          window.api.preference.setMultiple({
            'app.privacy.policy_version': previous[0] as UnifiedPreferenceType['app.privacy.policy_version'],
            'app.onboarding.provider_setup.status':
              previous[1] as UnifiedPreferenceType['app.onboarding.provider_setup.status'],
            'app.language': previous[2] as UnifiedPreferenceType['app.language']
          }),
        previous
      )
    )
    if (cleanupErrors.length) {
      testInfo.annotations.push({ type: 'cleanup-failure', description: cleanupErrors.join('\n') })
      await attachJson('cleanup-errors', cleanupErrors)
    }
  }
})
