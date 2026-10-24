import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { _electron as electron } from '@playwright/test'

import { claudeProjectDirectoryName } from '../../../src/main/ai/utils/claudeProject'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: testInfo.outputPath('profile') },
      timeout: 60_000
    })
    await provideApp(app)
    await app.close()
  }
})

function backdateTree(target: string): void {
  if (statSync(target).isDirectory()) {
    for (const entry of readdirSync(target)) backdateTree(path.join(target, entry))
  }
  const stale = (Date.now() - 60 * 60 * 1000) / 1000
  utimesSync(target, stale, stale)
}

function inventory(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) Object.assign(files, inventory(target))
    else files[target] = readFileSync(target, 'utf8')
  }
  return files
}

test('purge keeps surviving Claude projects and ordinary data, reclaims orphan UUIDs, and logs each removed path', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  const profile = testInfo.outputPath('profile')
  const shell = uiLocator(page, 'app.shell')
  const languageSelect = page.locator('[data-onboarding-language-select]')
  await expect(shell.or(languageSelect).first()).toBeVisible()
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click()
    await page.getByRole('option', { name: 'English', exact: false }).click()
    await page.getByRole('button', { name: 'Set up later', exact: true }).click()
  }
  await expect(shell.first()).toBeVisible({ timeout: 60_000 })

  const providerId = `orphan-sweep-${Date.now()}`
  const modelId = 'orphan-sweep-model'
  const provider = await page.evaluate(
    (providerId) =>
      window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: 'Orphan sweep fixture',
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'http://127.0.0.1:1/v1' } },
          apiKeys: [{ id: 'fixture-key', key: 'fixture-key', isEnabled: true }]
        }
      }),
    providerId
  )
  expect(provider.status).toBe(201)
  const model = await page.evaluate(
    ({ providerId, modelId }) =>
      window.api.dataApi.request({
        id: `${providerId}-model`,
        method: 'POST',
        path: '/models',
        body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
      }),
    { providerId, modelId }
  )
  expect(model.status).toBe(201)
  const created = await page.evaluate(
    (model) =>
      window.api.ipcApi.request('ai.agent.create', {
        type: 'claude-code',
        name: 'Orphan sweep fixture',
        model,
        instructions: 'Do not run tools.',
        configuration: { heartbeat_enabled: false }
      }),
    createUniqueModelId(providerId, modelId)
  )
  expect(created).toMatchObject({ ok: true })
  const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
  const response = await page.evaluate(
    (agentId) =>
      window.api.dataApi.request({
        id: 'orphan-sweep-session',
        method: 'POST',
        path: '/agent-sessions',
        body: { agentId, name: 'Unopened orphan sweep fixture', workspace: { type: 'system' } }
      }),
    agent.id
  )
  expect(response.status).toBe(201)
  const session = AgentSessionEntitySchema.parse(response.data)
  expect(session.deletedAt).toBeUndefined()
  mkdirSync(session.workspace.path, { recursive: true })
  const projectName = claudeProjectDirectoryName(session.workspace.path)
  // Check the SDK's persisted-name contract independently of the moved helper.
  const sanitized = session.workspace.path.replace(/[^a-zA-Z0-9]/g, '-')
  const hash = session.workspace.path.split('').reduce((value, unit) => (value * 31 + unit.charCodeAt(0)) | 0, 0)
  const expectedProjectName =
    sanitized.length <= 200 ? sanitized : `${sanitized.slice(0, 200)}-${Math.abs(hash).toString(36)}`
  expect(projectName).toBe(expectedProjectName)
  const projects = path.join(profile, 'userData', 'Data', 'Agents', '.claude', 'projects')
  const ownedProject = path.join(projects, projectName)
  expect(path.basename(ownedProject)).toBe(expectedProjectName)
  const unownedProject = path.join(projects, 'unowned-orphan-sweep-fixture')
  const ownedToken = '11111111-1111-1111-1111-111111111111'
  const orphanToken = '22222222-2222-2222-2222-222222222222'
  const directoryOnlyToken = '33333333-3333-3333-3333-333333333333'
  const retained = {
    [path.join(ownedProject, `${ownedToken}.jsonl`)]: 'owned transcript bytes',
    [path.join(ownedProject, ownedToken, 'subagents', 'agent-1.jsonl')]: 'owned subagent bytes',
    [path.join(unownedProject, 'memory', 'facts.md')]: 'ordinary memory bytes',
    [path.join(unownedProject, 'session-env', 'state.json')]: 'ordinary environment bytes',
    [path.join(unownedProject, 'memory.jsonl')]: 'ordinary memory transcript bytes'
  }
  const orphanFiles = {
    [path.join(unownedProject, `${orphanToken}.jsonl`)]: 'orphan transcript bytes',
    [path.join(unownedProject, orphanToken, 'subagents', 'agent-2.jsonl')]: 'orphan subagent bytes',
    [path.join(unownedProject, directoryOnlyToken, 'subagents', 'agent-3.jsonl')]: 'directory-only orphan bytes'
  }
  for (const [target, bytes] of Object.entries({ ...retained, ...orphanFiles })) {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  backdateTree(projects)
  const removedPaths = [
    path.join(unownedProject, `${orphanToken}.jsonl`),
    path.join(unownedProject, orphanToken),
    path.join(unownedProject, directoryOnlyToken)
  ]
  await testInfo.attach('before-inventory', {
    body: JSON.stringify(inventory(projects), null, 2),
    contentType: 'application/json'
  })
  const purge = await page.evaluate(() => window.api.ipcApi.request('trash.purge_now', undefined))
  expect.soft(purge).toMatchObject({ ok: true, data: { status: 'completed', reclaimed: true } })

  for (const [target, bytes] of Object.entries(retained)) {
    expect.soft(existsSync(target) ? readFileSync(target, 'utf8') : null, target).toBe(bytes)
  }
  for (const target of removedPaths) expect.soft(existsSync(target), target).toBe(false)
  const surviving = await page.evaluate(
    (id) =>
      window.api.dataApi.request({
        id: 'orphan-sweep-readback',
        method: 'GET',
        path: `/agent-sessions/${id}`
      }),
    session.id
  )
  expect.soft(surviving.status).toBe(200)
  expect
    .soft(surviving.data)
    .toMatchObject({ id: session.id, workspace: { id: session.workspace.id, path: session.workspace.path } })
  const messages = await page.evaluate(
    (id) =>
      window.api.dataApi.request({
        id: 'orphan-sweep-messages',
        method: 'GET',
        path: `/agent-sessions/${id}/messages`
      }),
    session.id
  )
  expect.soft(messages.status).toBe(200)
  expect.soft(messages.data).toMatchObject({ items: [] })
  await testInfo.attach('after-inventory', {
    body: JSON.stringify(inventory(projects), null, 2),
    contentType: 'application/json'
  })

  let matchedLines: string[] = []
  await expect.soft
    .poll(
      () => {
        const logs = path.join(profile, 'logs')
        if (!existsSync(logs)) return []
        matchedLines = readdirSync(logs)
          .filter((name) => /^app\..*\.log(?:\..*)?$/.test(name))
          .flatMap((name) =>
            readFileSync(path.join(logs, name), 'utf8')
              .split('\n')
              .filter((line) => {
                try {
                  const record = JSON.parse(line)
                  return (
                    record.level === 'info' &&
                    record.module === 'AgentOrphanSweep' &&
                    record.event === 'agent-orphan-sweep-runtime-removed' &&
                    record.runtime === 'claude-code'
                  )
                } catch {
                  return false
                }
              })
          )
        return matchedLines.flatMap((line) => JSON.parse(line).removedPaths as string[]).sort()
      },
      { timeout: 15_000 }
    )
    .toEqual([...removedPaths].sort())
  for (const line of matchedLines) {
    for (const retainedPath of Object.keys(retained)) expect.soft(line).not.toContain(retainedPath)
  }
  await testInfo.attach('runtime-removal-logs', { body: matchedLines.join('\n'), contentType: 'application/x-ndjson' })
  await page.bringToFront()
  await page.screenshot({ path: testInfo.outputPath('agent-orphan-sweep.png') })
  await testInfo.attach('visible-app', {
    path: testInfo.outputPath('agent-orphan-sweep.png'),
    contentType: 'image/png'
  })
})
