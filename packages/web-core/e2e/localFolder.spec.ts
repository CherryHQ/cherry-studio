import type { Page } from '@playwright/test'

import { PageChannel } from '../src/worker/protocol'
import { expect, reloadHarness, test } from './fixtures'

// The picker's folder is an OPFS directory here: the same handle API as a folder on disk, without the dialog.
const folderName = (testId: string) => `picked-${testId}-${Date.now().toString(36)}`

/** Creates the folder with `files`, as the user's own files, and adds it as a picked folder. */
function pickFolder(page: Page, name: string, files: Record<string, string> = {}): Promise<string> {
  return page.evaluate(
    async ({ name, files }) => {
      const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true })
      for (const [file, text] of Object.entries(files)) {
        const writable = await (await handle.getFileHandle(file, { create: true })).createWritable()
        await writable.write(text)
        await writable.close()
      }
      return harness.client.send<string>('local-folder.add', { handle })
    },
    { name, files }
  )
}

/** The folder's files as the browser sees them, outside the Worker's file system. */
function readFolder(page: Page, name: string): Promise<Record<string, string>> {
  return page.evaluate(async (name) => {
    const files: Record<string, string> = {}
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
      for await (const handle of (directory as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
        const path = `${prefix}${handle.name}`
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${path}/`)
        else files[path] = await (await (handle as FileSystemFileHandle).getFile()).text()
      }
    }
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle(name), '')
    return files
  }, name)
}

function fsCall<T = unknown>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(({ method, args }) => harness.client.send<T>('fsCall', { method, args }), { method, args })
}

function fsError(page: Page, method: string, ...args: unknown[]): Promise<string> {
  return page.evaluate(
    ({ method, args }) =>
      harness.client.send('fsCall', { method, args }).then(
        () => 'succeeded',
        (error: Error) => error.message
      ),
    { method, args }
  )
}

// WebKit keeps OPFS outside the profile directory, so the picked folders are removed after each test.
async function removeFolder(page: Page, name: string) {
  await page.evaluate(
    async (name) => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }),
    name
  )
}

test('works on the files of a picked folder in place', async ({ page, account }, testInfo) => {
  const name = folderName(testInfo.testId)
  await page.evaluate((account) => harness.client.open(account), account)
  try {
    const path = await pickFolder(page, name, { 'README.md': '# Notes' })
    expect(path).toMatch(new RegExp(`^/local/[0-9a-f]{8}/${name}$`))
    expect(await fsCall(page, 'readFile', `${path}/README.md`, 'utf8')).toBe('# Notes')

    await fsCall(page, 'mkdir', `${path}/src`, { recursive: true })
    await fsCall(page, 'writeFile', `${path}/src/a.txt`, 'a longer first version')
    // A shorter rewrite must not keep the old tail.
    await fsCall(page, 'writeFile', `${path}/src/a.txt`, 'second')
    expect(await readFolder(page, name)).toEqual({ 'README.md': '# Notes', 'src/a.txt': 'second' })
    expect(await fsCall(page, 'stat', `${path}/src/a.txt`)).toEqual({ size: 6, isFile: true, isDirectory: false })

    // A file another program creates is there at once.
    await page.evaluate(async (name) => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      const writable = await (await folder.getFileHandle('outside.txt', { create: true })).createWritable()
      await writable.write('written elsewhere')
      await writable.close()
    }, name)
    expect((await fsCall<string[]>(page, 'readdir', path)).sort()).toEqual(['README.md', 'outside.txt', 'src'])
    expect(await fsCall(page, 'readFile', `${path}/outside.txt`, 'utf8')).toBe('written elsewhere')

    await fsCall(page, 'rename', `${path}/src/a.txt`, `${path}/src/b.txt`)
    await fsCall(page, 'rm', `${path}/outside.txt`)
    expect(await readFolder(page, name)).toEqual({ 'README.md': '# Notes', 'src/b.txt': 'second' })
    expect(await fsError(page, 'readFile', `${path}/outside.txt`, 'utf8')).toContain('ENOENT')

    // Picking the same folder again keeps its path, and so its workspace.
    expect(await pickFolder(page, name)).toBe(path)
  } finally {
    await page.evaluate(() => harness.client.send('close'))
    await removeFolder(page, name)
  }
})

test('mounts a picked folder again when the account reopens, and asks for access the browser dropped', async ({
  page,
  account
}, testInfo) => {
  const name = folderName(testInfo.testId)
  await page.evaluate((account) => harness.client.open(account), account)
  try {
    const path = await pickFolder(page, name, { 'kept.txt': 'from the first visit' })
    await page.evaluate(() => harness.client.send('close'))

    await reloadHarness(page)
    await page.evaluate(() => harness.client.send('revokeFolderPermission', { revoked: true }))
    await page.evaluate((account) => harness.client.open(account), account)
    expect(await fsError(page, 'writeFile', `${path}/blocked.txt`, 'not written')).toContain(
      `Access to the local folder "${name}" must be allowed again`
    )
    expect(await fsError(page, 'readFile', `${path}/kept.txt`, 'utf8')).toContain('EACCES')
    expect(await readFolder(page, name)).toEqual({ 'kept.txt': 'from the first visit' })
    // The page is asked once, with the handle it needs for `requestPermission`.
    const requests = await page.evaluate(
      (channel) =>
        harness.broadcasts
          .filter((broadcast) => broadcast.channel === channel)
          .map(({ args: [request] }) => {
            const { id, name, handle } = request as { id: string; name: string; handle: FileSystemDirectoryHandle }
            return { id, name, kind: handle.kind }
          }),
      PageChannel.LocalFolderAccess
    )
    expect(requests).toEqual([{ id: path.split('/')[2], name, kind: 'directory' }])

    await page.evaluate(() => harness.client.send('revokeFolderPermission', { revoked: false }))
    await page.evaluate((id) => harness.client.send('local-folder.allow', { id }), requests[0].id)
    expect(await fsCall(page, 'readFile', `${path}/kept.txt`, 'utf8')).toBe('from the first visit')
    await fsCall(page, 'writeFile', `${path}/allowed.txt`, 'written after access was allowed')
    expect(await readFolder(page, name)).toEqual({
      'kept.txt': 'from the first visit',
      'allowed.txt': 'written after access was allowed'
    })
  } finally {
    await page.evaluate(() => harness.client.send('close'))
    await removeFolder(page, name)
  }
})
