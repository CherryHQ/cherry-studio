import { vi } from 'vitest'

/**
 * Factory for `vi.mock('node:fs', ...)` that stubs the sync and promise
 * surface area typical tests need to control (existsSync, readFileSync,
 * mkdirSync, etc.) while preserving every other real export via
 * `vi.importActual`.
 *
 * The global `tests/main.setup.ts` keeps `node:fs` fully real so that
 * third-party libraries (e.g. the Drizzle migrator) can read files
 * normally. Tests that need deterministic fs behaviour declare a local
 * override using this helper:
 *
 *   import { createNodeFsMock } from '@test-helpers/mocks/nodeFsMock'
 *
 *   vi.mock('node:fs', async () => createNodeFsMock())
 *
 *   // ...
 *   vi.mocked(fs.existsSync).mockReturnValue(true)
 */
export async function createNodeFsMock() {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  const mocked = {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
    renameSync: vi.fn(),
    createReadStream: vi.fn(),
    createWriteStream: vi.fn(),
    promises: {
      ...actual.promises,
      access: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
      rmdir: vi.fn()
    }
  }
  return { ...mocked, default: mocked }
}
