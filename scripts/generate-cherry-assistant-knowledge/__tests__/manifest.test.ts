import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { appLanguageOptions } from '../../../src/renderer/i18n/languages'
import { CodeCli } from '../../../src/shared/types/codeCli'
import { COMMAND_DEFINITIONS } from '../../../src/shared/utils/command/definitions'
import { generateProductManifest, serializeProductManifest } from '../generators/manifest'

describe('generateProductManifest', () => {
  it('derives package metadata and routes from the current package', () => {
    const manifest = generateProductManifest()

    expect(manifest.schemaVersion).toBe(1)
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8')) as {
      name: string
      version: string
      description: string
      homepage: string
    }

    expect(manifest.package).toEqual({
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      homepage: packageJson.homepage
    })
    expect(manifest.routes.primary.length).toBeGreaterThan(0)
    expect(new Set(manifest.routes.all).size).toBe(manifest.routes.all.length)
    expect(manifest.routes.primary.every(({ path }) => manifest.routes.all.includes(path))).toBe(true)
  })

  it('includes registered commands and their default keybindings', () => {
    const manifest = generateProductManifest()

    expect(manifest.commands).toEqual(JSON.parse(JSON.stringify(COMMAND_DEFINITIONS)))
  })

  it('includes the shipped provider registry without a maintained category map', () => {
    const manifest = generateProductManifest()
    const registry = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../packages/provider-registry/data/providers.json'), 'utf-8')
    ) as { version: string; providers: Array<{ id: string; name: string }> }

    expect(manifest.providers).toEqual({
      version: registry.version,
      count: registry.providers.length,
      entries: registry.providers.map(({ id, name }) => ({ id, name }))
    })
  })

  it('includes the application language options shown by the current UI', () => {
    const manifest = generateProductManifest()

    expect(manifest.locales).toEqual(appLanguageOptions)
  })

  it('includes agent channels, schedule triggers, and Code CLI tools', () => {
    const manifest = generateProductManifest()

    expect(manifest.agents.channelTypes.length).toBeGreaterThan(0)
    expect(new Set(manifest.agents.channelTypes).size).toBe(manifest.agents.channelTypes.length)
    expect(manifest.agents.scheduleTriggerKinds.length).toBeGreaterThan(0)
    expect(new Set(manifest.agents.scheduleTriggerKinds).size).toBe(manifest.agents.scheduleTriggerKinds.length)
    expect(manifest.agents.codeCli.route).toBe(manifest.routes.primary.find(({ id }) => id === 'code_tools')?.path)
    expect(manifest.agents.codeCli.tools).toEqual(Object.values(CodeCli))
  })

  it('serializes the manifest as stable JSON', () => {
    const manifest = generateProductManifest()
    const serialized = serializeProductManifest(manifest)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized)).toEqual(manifest)
  })
})
