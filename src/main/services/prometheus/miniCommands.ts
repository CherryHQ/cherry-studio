import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'

import { readIntegrationConfig, readSecrets, integrationDirectory } from './integrationConfig'

export async function writeMiniConfiguration(): Promise<void> {
  const config = readIntegrationConfig()
  const secrets = await readSecrets()
  await fs.mkdir(integrationDirectory(), { recursive: true, mode: 0o700 })
  await fs.writeFile(
    path.join(integrationDirectory(), 'mini-runtime.json'),
    JSON.stringify({
      PROMETHEUS_PACK_ROOT: application.getPath('feature.prometheus.pack.runtime'),
      PROMETHEUS_COMMAND_DIRECTORY: application.getPath('feature.prometheus.commands'),
      PROMETHEUS_SERVICE_DIRECTORY: path.join(integrationDirectory(), 'services'),
      PROMETHEUS_SERVICE_MODE: (['surrealdb', 'memory', 'liter'] as const)
        .map((service) => `${service}:${config.services[service].ownership}`)
        .join(','),
      SURREAL_MEMORY_URL: new URL('/', config.services.memory.endpoint).href.replace(/\/$/, ''),
      SURREAL_MEMORY_TOKEN: secrets.memoryToken ?? '',
      LITER_LLM_BASE_URL: `${config.services.liter.endpoint.replace(/\/$/, '')}/v1`,
      LITER_LLM_MASTER_KEY: secrets.literKey ?? '',
      LITER_LLM_CONFIG: path.join(integrationDirectory(), 'services', 'liter-llm-proxy.toml'),
      PROMETHEUS_KBD_JUDGE_MODEL: 'kbd-judge',
      PROMETHEUS_KBD_CRITIC_MODEL: 'kbd-critic'
    }),
    { mode: 0o600 }
  )
}

export async function installMiniCommands(directory: string): Promise<void> {
  const root = application.getPath('feature.prometheus.pack.runtime')
  const configFile = path.join(integrationDirectory(), 'mini-runtime.json')
  const host = JSON.stringify({ owner: 'the-boss', configuration: configFile })
  const runner = `const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configFile)}, 'utf8'));
const [command, ...args] = process.argv.slice(2);
const root = ${JSON.stringify(root)};
const filename = command === 'openspec' ? path.join(root, 'node_modules/@fission-ai/openspec/bin/openspec.js') : path.resolve(root, 'scripts', command || '');
if (command !== 'openspec' && (!filename.startsWith(path.join(root, 'scripts') + path.sep) || !filename.endsWith('.mjs'))) throw new Error('Select a packaged mini .mjs script');
const result = spawnSync(process.execPath, [filename, ...args], { cwd: process.cwd(), env: { ...process.env, ...config }, stdio: 'inherit', windowsHide: true });
if (result.error) { process.stderr.write(result.error.message + '\\n'); process.exit(1); }
process.exit(result.status ?? 1);
`
  const node = process.platform === 'win32' ? 'node.exe' : 'node'
  // Agent sessions get cherry.bin on PATH, not the user-registered command directory.
  for (const target of [directory, application.getPath('cherry.bin')]) {
    await fs.writeFile(path.join(target, 'prometheus-host.json'), host)
    await fs.writeFile(path.join(target, 'mini-runner.cjs'), runner)
    for (const name of ['boss-mini', 'openspec']) {
      const argument = name === 'openspec' ? 'openspec ' : ''
      if (process.platform === 'win32') {
        await fs.writeFile(
          path.join(target, `${name}.cmd`),
          `@echo off\r\n"%~dp0node.exe" "%~dp0mini-runner.cjs" ${argument}%*\r\n`
        )
      }
      // Git Bash resolves only extensionless names, so Windows needs this shim too.
      await fs.writeFile(
        path.join(target, name),
        `#!/bin/sh\ncommand_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$command_dir/${node}" "$command_dir/mini-runner.cjs" ${argument}"$@"\n`,
        { mode: 0o755 }
      )
    }
  }
  await writeMiniConfiguration()
}

export function renderMiniSkill(bytes: Buffer, relative: string): Buffer {
  if (!relative.endsWith('.md')) return bytes
  return Buffer.from(bytes.toString('utf8').replace(/\bnode scripts\/([a-zA-Z0-9_./-]+\.mjs)\b/g, 'boss-mini $1'))
}
