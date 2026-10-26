import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as Platform from '@main/core/platform'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { CodeCli } from '@shared/types/codeCli'

import { readCliConfigFiles, writeCliConfigFiles } from '../configWriter'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  isWin: true
}))
vi.mock('@main/utils/shellEnv', () => ({ getRawShellEnv: vi.fn() }))

it('reads and writes the Windows CLI override directory regardless of environment key casing', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'cli-env-case-'))
  const configured = path.join(home, 'configured')
  vi.mocked(application.getPath).mockReturnValue(home)
  vi.mocked(getRawShellEnv).mockResolvedValue({ Codex_Home: configured })
  try {
    await writeCliConfigFiles(CodeCli.OPENAI_CODEX, [{ target: 'codex-config', content: 'model = "selected"\n' }])
    const [file] = await readCliConfigFiles(['codex-config'])
    expect(file.path).toBe(path.join(configured, 'config.toml'))
    expect(await readFile(file.path, 'utf8')).toBe('model = "selected"\n')
    await expect(readFile(path.join(home, '.codex', 'config.toml'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
