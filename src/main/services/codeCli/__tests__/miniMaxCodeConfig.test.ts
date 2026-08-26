import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { AbsoluteFilePathSchema } from '@shared/types/file'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  activateMiniMaxCodeModel,
  resolveMiniMaxCodeConfigPath,
  restoreMiniMaxCodeSelection
} from '../miniMaxCodeConfig'

const tempDirectories: string[] = []

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-mcode-config-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('MiniMax Code config selection', () => {
  it('uses the same public data directory overrides and home fallback as mcode', () => {
    expect(
      resolveMiniMaxCodeConfigPath(
        { MINIMAX_DATA_DIR: '/custom/minimax', MAVIS_DATA_DIR: '/custom/mavis', HOME: '/shell/home' },
        '/system/home'
      )
    ).toBe(path.resolve('/custom/minimax', 'config.yaml'))
    expect(resolveMiniMaxCodeConfigPath({ MAVIS_DATA_DIR: '/custom/mavis' }, '/system/home')).toBe(
      path.resolve('/custom/mavis', 'config.yaml')
    )
    expect(resolveMiniMaxCodeConfigPath({ HOME: '/shell/home' }, '/system/home')).toBe(
      path.join('/shell/home', '.minimax', 'config.yaml')
    )
    expect(resolveMiniMaxCodeConfigPath({}, '/system/home')).toBe(path.join('/system/home', '.minimax', 'config.yaml'))
  })

  it('atomically selects a custom model and can restore only the previous selection fields', async () => {
    const dataDir = await createTempDirectory()
    const configPath = path.join(dataDir, 'config.yaml')
    await fs.writeFile(
      configPath,
      [
        '# keep this comment',
        'theme: dark',
        'defaultModel: minimax/MiniMax-M2.7',
        'defaultModelVariant: high',
        'custom_provider:',
        '  existing:',
        '    name: Existing',
        ''
      ].join('\n')
    )

    const receipt = await activateMiniMaxCodeModel(
      { MINIMAX_DATA_DIR: dataDir },
      '/unused',
      'custom_provider:cherry-deepseek',
      'deepseek-reasoner'
    )
    const selected = await fs.readFile(configPath, 'utf8')
    expect(selected).toContain('# keep this comment')
    expect(parse(selected)).toMatchObject({
      theme: 'dark',
      defaultModel: 'custom_provider:cherry-deepseek/deepseek-reasoner',
      custom_provider: { existing: { name: 'Existing' } }
    })
    expect(parse(selected)).not.toHaveProperty('defaultModelVariant')
    if (process.platform !== 'win32') {
      expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600)
    }

    await fs.writeFile(configPath, selected.replace('theme: dark', 'theme: light'))
    await restoreMiniMaxCodeSelection(receipt)
    const restored = await fs.readFile(configPath, 'utf8')
    expect(parse(restored)).toMatchObject({
      theme: 'light',
      defaultModel: 'minimax/MiniMax-M2.7',
      defaultModelVariant: 'high',
      custom_provider: { existing: { name: 'Existing' } }
    })
  })

  it('rejects invalid YAML without changing the file', async () => {
    const dataDir = await createTempDirectory()
    const configPath = AbsoluteFilePathSchema.parse(path.join(dataDir, 'config.yaml'))
    const invalid = 'defaultModel: [unterminated\n'
    await fs.writeFile(configPath, invalid)

    await expect(
      activateMiniMaxCodeModel(
        { MINIMAX_DATA_DIR: dataDir },
        '/unused',
        'custom_provider:cherry-deepseek',
        'deepseek-reasoner'
      )
    ).rejects.toThrow(/Invalid MiniMax Code config YAML/)
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(invalid)
  })

  it('does not overwrite a selection changed by another mcode process before rollback', async () => {
    const dataDir = await createTempDirectory()
    const configPath = path.join(dataDir, 'config.yaml')
    await fs.writeFile(configPath, 'defaultModel: minimax/MiniMax-M2.7\n')
    const receipt = await activateMiniMaxCodeModel(
      { MINIMAX_DATA_DIR: dataDir },
      '/unused',
      'custom_provider:cherry-deepseek',
      'deepseek-reasoner'
    )
    await fs.writeFile(configPath, 'defaultModel: custom_provider:user/model\n')

    await expect(restoreMiniMaxCodeSelection(receipt)).rejects.toThrow(
      'MiniMax Code model selection changed before rollback'
    )
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe('defaultModel: custom_provider:user/model\n')
  })
})
