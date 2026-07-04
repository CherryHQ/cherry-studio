import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, test as base } from '@playwright/test'
import * as cp from 'child_process'
import electronPath from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { goldenProfileDir, notesSeedDir } from '../utils/e2e-env'

/**
 * Point a copied profile's `feature.notes.path` preference at a notes directory (pre-launch).
 *
 * Runs `better-sqlite3` through Electron's own Node runtime (`ELECTRON_RUN_AS_NODE`) rather than
 * the Playwright test runner's plain Node process: the native module is only ever installed as a
 * single build, and `pnpm rebuild:electron` compiles it against Electron's ABI — loading it
 * straight from a plain-Node `require` throws a NODE_MODULE_VERSION mismatch.
 */
function setNotesPath(profileDir: string, notesDir: string): void {
  const script = `
    const Database = require('better-sqlite3')
    const db = new Database(process.argv[1])
    try {
      db.prepare("UPDATE preference SET value = ? WHERE scope = 'default' AND key = 'feature.notes.path'").run(process.argv[2])
    } finally {
      db.close()
    }
  `
  cp.execFileSync(
    electronPath as unknown as string,
    ['-e', script, path.join(profileDir, 'cherrystudio.sqlite'), JSON.stringify(notesDir)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  )
}

/**
 * Electron e2e fixture for agent-domain tests that need a seeded app state.
 *
 * Unlike the plain `electron.fixture`, this one:
 *  1. launches against a per-test COPY of the golden userData profile (isolated, never the
 *     developer's real profile), so prereqs like a pre-seeded `E2E_Test_KB` are available;
 *  2. exposes `picker` to stub the native open dialog in the MAIN process — no OS file/folder
 *     dialog, no `osascript`, zero product change.
 *
 * Launch detail: `args: ['.']` makes `app.getAppPath()` the repo root, so the `file://` renderer
 * (`out/renderer/...`) is inside `app.root` and passes IpcApi `validateSender` (untrusted-sender
 * rejection otherwise). The dev build appends a `Dev` suffix to the userData dir name, so the
 * golden is copied to both `<base>` and `<base>Dev` while `--user-data-dir` points at `<base>`.
 */
export interface PickerControl {
  /** Make the next native open dialog resolve to these paths instead of showing a dialog. */
  stub(filePaths: string[]): Promise<void>
  /** How many times the stubbed dialog has been invoked since the last `stub()`. */
  hits(): Promise<number>
}

export type SeededOptions = {
  /** Seed `feature.notes.path` to the notes seed dir so note-source tests see `e2e-seed-note`. */
  seedNotes: boolean
}

export type SeededFixtures = {
  /** Per-test copy of the golden userData profile (cleaned up after the test). */
  userDataDir: string
  electronApp: ElectronApplication
  mainWindow: Page
  picker: PickerControl
}

let runSeq = 0

export const test = base.extend<SeededOptions & SeededFixtures>({
  seedNotes: [false, { option: true }],

  userDataDir: async ({ seedNotes }, use) => {
    const golden = goldenProfileDir()
    const baseDir = path.join(os.tmpdir(), `cherry-e2e-${process.pid}-${runSeq++}-${Date.now()}`)
    const dirs = [baseDir, `${baseDir}Dev`]
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true })
      cp.execFileSync('cp', ['-R', golden, dir])
    }
    if (seedNotes) {
      const notesDir = notesSeedDir()
      for (const dir of dirs) setNotesPath(dir, notesDir)
    }
    await use(baseDir)
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  },

  electronApp: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: { ...process.env, NODE_ENV: 'development' },
      timeout: 60000
    })
    await use(app)
    await app.close()
  },

  mainWindow: async ({ electronApp }, use) => {
    let page: Page | undefined
    for (let i = 0; i < 120; i++) {
      page = electronApp.windows().find((w) => w.url().includes('/windows/main/index.html'))
      if (page) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!page) {
      throw new Error('Main window (/windows/main/index.html) did not appear within 60s')
    }
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  },

  picker: async ({ electronApp }, use) => {
    const control: PickerControl = {
      async stub(filePaths) {
        await electronApp.evaluate(({ dialog }, paths) => {
          const store = globalThis as unknown as { __pickerHits: number }
          store.__pickerHits = 0
          dialog.showOpenDialog = async () => {
            store.__pickerHits += 1
            return { canceled: false, filePaths: paths }
          }
          dialog.showOpenDialogSync = () => {
            store.__pickerHits += 1
            return paths
          }
        }, filePaths)
      },
      async hits() {
        return electronApp.evaluate(() => (globalThis as unknown as { __pickerHits?: number }).__pickerHits ?? 0)
      }
    }
    await use(control)
  }
})

export { expect } from '@playwright/test'
