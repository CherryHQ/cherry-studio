import type { Page } from '@playwright/test'

import { composerInput, gotoApp, send, setUpAssistant, test } from './appPage'
import { expect } from './fixtures'

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
  // The two calls run together, so their results come back in either order.
  await expect(
    page.getByText(/^tools said: (from the web agent \| notes\.txt:1: .*|notes\.txt:1: .* \| from the web agent)$/)
  ).toBeVisible()
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

test('lists the files the agent writes in the file tree and previews them', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')

  await send(page, 'please call write {"path":"notes/first.txt","content":"the first file"}')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByText('notes', { exact: true }).click()
  await page.getByText('first.txt', { exact: true }).click()
  await expect(page.getByText('the first file', { exact: true })).toBeVisible()

  // A file written while the tree is open shows up without reopening it.
  await page.getByRole('button', { name: 'Back' }).click()
  await send(page, 'please call write {"path":"second.txt","content":"the second file"}')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText('second.txt', { exact: true })).toBeVisible()
})

test("saves an edit to the agent's file from the file pane", async ({ page }) => {
  const written = await writeInNewSession(page, 'edit-me.txt', 'before')
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByText('edit-me.txt', { exact: true }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(' and after')

  await expect.poll(async () => (await readWorkspaceFiles(page))[written]).toBe('before and after')
  await expect(page.getByLabel('Unsaved')).toHaveCount(0)
})

/** Has the agent write `content` at `filePath` in a new session and returns the file's workspace path. */
async function writeInNewSession(page: Page, filePath: string, content: string): Promise<string> {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')
  await send(page, `please call write {"path":"${filePath}","content":"${content}"}`)
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  const written = Object.keys(await readWorkspaceFiles(page)).find((path) => path.endsWith(`/${filePath}`))
  expect(written).toBeDefined()
  return written!
}

/** Archives the agent's only session from its row in the agent list. */
async function archiveSession(page: Page) {
  // "More" on the agent lists its sessions.
  await page.getByRole('button', { name: 'More' }).first().click()
  const row = page.getByTestId('agent-session-row')
  await row.getByRole('button', { name: 'Archive', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveCount(0)
}

async function openArchive(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
}

test('reads a tool result too large for the message list after a reload', async ({ page }) => {
  await gotoApp(page, 'Work')
  await setUpAssistant(page)
  await gotoApp(page, 'Work')
  // Over the 32 KB above which the message list sends a reference instead of the result.
  const content = Array.from({ length: 1000 }, (_, line) => `line ${line} of the long file`.padEnd(40, '.')).join('\\n')
  await composerInput(page).click()
  await page.keyboard.insertText(`please call write {"path":"long.txt","content":"${content}"}`)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:/)).toBeVisible()
  await send(page, 'please call read {"path":"long.txt"}')
  // The mock's reply repeats the result.
  await expect(page.getByText('line 999 of the long file').last()).toBeVisible()
  // A reload before the turn is saved would interrupt it.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const api = window.api as unknown as { dataApi: { request(request: object): Promise<{ data: any }> } }
        const get = async (path: string) =>
          (await api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path })).data
        const [session] = (await get('/agent-sessions')).items
        return (await get(`/agent-sessions/${session.id}/messages`)).items[0].status
      })
    )
    .toBe('success')

  await gotoApp(page, 'Work')
  const result = await page.evaluate(async () => {
    const api = window.api as unknown as {
      dataApi: { request(request: object): Promise<{ data: any }> }
      ipcApi: { request(route: string, input: unknown): Promise<{ ok: boolean; data: any }> }
    }
    const get = async (path: string, params?: object) =>
      (await api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path, params })).data
    const [session] = (await get('/agent-sessions')).items
    // As the session's message list loads (`useAgentSessionParts`).
    const { items } = await get(`/agent-sessions/${session.id}/messages`, { deferToolOutputs: true })
    for (const { data } of items) {
      for (const part of data.parts ?? []) {
        const ref = part.output?.$deferredToolResult
        if (ref) return { response: await api.ipcApi.request('ai.tool.get_result', ref) }
      }
    }
    return null
  })
  expect(result?.response.ok).toBe(true)
  expect(result?.response.data.found).toBe(true)
  expect(JSON.stringify(result?.response.data.output)).toContain('line 999 of the long file')
})

test('archives a session with its files and restores it from the archive', async ({ page }) => {
  // Longer than the 100 characters a plain tar header holds for a name.
  const filePath = `${'nested-folder/'.repeat(8)}notes.txt`
  const written = await writeInNewSession(page, filePath, 'kept in the archive')

  const sessionFolder = written.split('/').slice(0, 2).join('/')
  // What the session's folder holds once the Worker has finished with it, read again while it is busy.
  const settled = () =>
    expect.poll(async () => {
      const files = await readWorkspaceFiles(page).catch(() => ({}))
      return { names: Object.keys(files).filter((path) => path.startsWith(sessionFolder)), written: files[written] }
    })

  // The session leaves the list before its workspace is packed.
  await archiveSession(page)
  await settled().toEqual({ names: [`${sessionFolder}.tar.gz`], written: undefined })

  await openArchive(page)
  await page.getByRole('tabpanel').getByRole('button', { name: 'Restore' }).click()
  await settled().toEqual({ names: [written], written: 'kept in the archive' })
})

test('deletes an archived session and its files permanently', async ({ page }) => {
  const written = await writeInNewSession(page, 'notes.txt', 'deleted for good')
  const sessionFolder = written.split('/').slice(0, 2).join('/')

  await archiveSession(page)
  await openArchive(page)
  await page.getByRole('tabpanel').getByRole('button', { name: 'Delete Permanently' }).click()
  await page
    .getByRole('dialog')
    .or(page.getByRole('alertdialog'))
    .getByRole('button', { name: /Delete/ })
    .click()
  await expect(page.getByRole('tabpanel').getByRole('button', { name: 'Restore' })).toHaveCount(0)
  await expect
    .poll(async () => {
      const files = await readWorkspaceFiles(page).catch(() => undefined)
      return files && Object.keys(files).filter((path) => path.startsWith(sessionFolder))
    })
    .toEqual([])
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

  // Nothing in the sandbox reaches the network, the app's storage or another context.
  const globals = ['fetch', 'XMLHttpRequest', 'indexedDB', 'navigator', 'postMessage']
  const code = `[${globals.map((name) => `typeof ${name}`).join(', ')}].join(' ')`
  await send(page, `please call js_execute ${JSON.stringify({ code })}`)
  await page.getByRole('button', { name: /^Allow/ }).click()
  await expect(page.getByText(/^tools said:\s*undefined undefined undefined undefined undefined$/)).toBeVisible()

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
