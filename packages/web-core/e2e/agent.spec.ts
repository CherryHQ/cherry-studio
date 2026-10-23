import type { Page } from '@playwright/test'

import type { DataRequest } from '@shared/data/api/types'

import { composerInput, gotoApp, removeAppData } from './appPage'
import { expect, test as harnessTest } from './fixtures'
import { MOCK_PROVIDER_PORT } from './mockProvider'

const test = harnessTest.extend<{ page: Page }>({
  page: async ({ context }, provide) => {
    await provide(context.pages()[0] ?? (await context.newPage()))
    await removeAppData(context)
  }
})

/** Points the built-in assistant at the mock endpoint in `default` mode, so file changes ask first. */
async function setUpAssistant(page: Page) {
  const run = Date.now().toString(36)
  await page.evaluate(
    async ({ baseUrl, providerId }) => {
      const request = async (method: DataRequest['method'], path: string, body?: unknown) => {
        const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
        if (response.error) throw new Error(`${method} ${path}: ${response.error.message}`)
        return response.data as { items: { id: string }[] }
      }
      await request('POST', '/providers', {
        providerId,
        name: 'Mock provider',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
        apiKeys: [{ id: crypto.randomUUID(), key: 'sk-web-trial', isEnabled: true }]
      })
      await request('POST', '/models', [
        {
          providerId,
          modelId: 'mock-chat',
          name: 'Mock chat',
          endpointTypes: ['openai-chat-completions'],
          capabilities: ['function-call']
        }
      ])
      for (const { id } of (await request('GET', '/agents')).items) {
        await request('PATCH', `/agents/${id}`, {
          model: `${providerId}::mock-chat`,
          configuration: { permission_mode: 'default' }
        })
      }
    },
    { baseUrl: `http://localhost:${MOCK_PROVIDER_PORT}`, providerId: `mock-${run}` }
  )
}

/** Sends a message from the agent composer. */
async function send(page: Page, text: string) {
  await composerInput(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

/** The files in the agents' system workspaces, read from OPFS beside the running app. */
function readWorkspaceFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const files: Record<string, string> = {}
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
      for await (const handle of (directory as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        const path = `${prefix}${handle.name}`
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${path}/`)
        else files[path] = await (await (handle as FileSystemFileHandle).getFile()).text()
      }
    }
    let directory = await navigator.storage.getDirectory()
    for (const name of ['cherry-studio', 'local', 'files', 'feature.agents.system_workspaces']) {
      directory = await directory.getDirectoryHandle(name)
    }
    await walk(directory, '')
    return files
  })
}

const fileNames = (files: Record<string, string>) => Object.keys(files).map((path) => path.split('/').at(-1))

test('offers the built-in Cherry Assistant and creates Pi agents only', async ({ page }) => {
  await gotoApp(page, 'Work')
  await expect(page.getByRole('button', { name: 'Cherry Assistant' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Add Agent' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Pi', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Claude Agent')).toHaveCount(0)
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  // Skills and knowledge bases are left out, so their steps are too.
  await expect(dialog.getByRole('button', { name: /^\d/ })).toHaveText(['1Basic info', '2System Prompt'])
})

test('writes a file only after approval and keeps the turn across a reload', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await send(page, 'please call write {"path":"notes.txt","content":"from the web agent"}')
  await expect(page.getByRole('button', { name: /^Allow/ })).toBeVisible()
  expect(fileNames(await readWorkspaceFiles(page))).not.toContain('notes.txt')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  expect(Object.entries(await readWorkspaceFiles(page))).toContainEqual([
    expect.stringMatching(/\/notes\.txt$/),
    'from the web agent'
  ])

  // Reads and searches inside the workspace run without asking.
  await send(page, 'please call read {"path":"notes.txt"} call grep {"pattern":"web agent"}')
  await expect(page.getByText(/^tools said:.*from the web agent.*\|.*notes\.txt:1: from the web agent/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Allow/ })).toHaveCount(0)

  await gotoApp(page, 'Work')
  await expect(page.getByText(/^tools said:/)).toHaveCount(2)
  await expect(page.getByText('notes.txt').first()).toBeVisible()
})

test('leaves no file when a write is denied', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await send(page, 'please call write {"path":"denied.txt","content":"never written"}')
  await page.getByRole('button', { name: /^Deny/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  expect(fileNames(await readWorkspaceFiles(page))).not.toContain('denied.txt')

  await send(page, 'please call ls {} call find {"pattern":"*.txt"}')
  await expect(page.getByText(/^tools said:.*\(empty directory\).*\|.*No files found matching pattern/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Allow/ })).toHaveCount(0)
})

test('runs Python in the page after approval', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await send(page, 'please call python_execute {"code":"import sys\\nprint(6 * 7, sys.version_info.major)"}')
  await page.getByRole('button', { name: /^Allow/ }).click()
  // Pyodide comes from jsDelivr on first use.
  await expect(page.getByText(/^tools said: 42 3$/)).toBeVisible({ timeout: 90_000 })
})

test("keeps Python out of the app's storage", async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  const code = [
    'from js import navigator',
    'try:',
    '    await navigator.storage.getDirectory()',
    "    print('opfs: open')",
    'except Exception:',
    "    print('opfs: denied')"
  ].join('\n')
  await send(page, `please call python_execute ${JSON.stringify({ code })}`)
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said: opfs: denied$/)).toBeVisible({ timeout: 90_000 })
})

test('runs JavaScript in a sandbox and stops an endless loop at its timeout', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await send(page, `please call js_execute {"code":"console.log('hi'); await Promise.resolve(6 * 7)"}`)
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said: hi\s+42$/)).toBeVisible()

  await send(page, 'please call js_execute {"code":"while (true) {}","timeout":2000}')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:.*timed out after 2000 ms/)).toBeVisible()
})

/** The composer's work directory selector, which shows the session's folder. */
const workspaceSelector = (page: Page) => page.getByRole('button', { name: /work directory|^picked-/ }).first()

test('works in a folder the user picks and keeps it across a reload', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Only Chromium-based browsers can pick a local folder')
  const name = `picked-${testInfo.testId}-${Date.now().toString(36)}`
  // The picker's folder is an OPFS directory: the same handle API as a folder on disk, without the dialog.
  await page.addInitScript((name) => {
    Object.assign(window, {
      showDirectoryPicker: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
    })
  }, name)
  const readPicked = () =>
    page.evaluate(async (name) => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      const files: Record<string, string> = {}
      for await (const handle of (folder as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        if (handle.kind === 'file') files[handle.name] = await (await (handle as FileSystemFileHandle).getFile()).text()
      }
      return files
    }, name)

  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await workspaceSelector(page).click()
  await page.getByText('Add new work directory').click()
  await expect(workspaceSelector(page)).toHaveText(name)

  await send(page, 'please call write {"path":"from-agent.txt","content":"written in the picked folder"}')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  expect(await readPicked()).toEqual({ 'from-agent.txt': 'written in the picked folder' })

  await gotoApp(page, 'Work')
  await expect(workspaceSelector(page)).toHaveText(name)
  await send(page, 'please call read {"path":"from-agent.txt"}')
  await expect(page.getByText(/^tools said: written in the picked folder/)).toBeVisible()
  await page.evaluate(
    async (name) => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }),
    name
  )
})

test('tells a browser without the folder picker to use Chrome or Edge', async ({ page }) => {
  // WebKit and Firefox have no picker; Chromium is made to match.
  await page.addInitScript(() => Object.assign(window, { showDirectoryPicker: undefined }))
  await gotoApp(page, 'Work')

  await workspaceSelector(page).click()
  await page.getByText('Add new work directory').click()
  await expect(page.getByText('Local folders need Chrome or Edge')).toBeVisible()
  await expect(workspaceSelector(page)).toHaveText('No work directory')
  const workspaces = await page.evaluate(async () => {
    const response = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'GET',
      path: '/agent-workspaces'
    })
    return (response.data as { type: string }[]).filter((workspace) => workspace.type === 'user')
  })
  expect(workspaces).toEqual([])
})
