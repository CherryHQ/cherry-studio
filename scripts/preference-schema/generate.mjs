#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDir, '../..')
const registryPath = path.join(scriptDir, 'registry.json')
const outputPath = path.join(repositoryRoot, 'src/shared/data/preference/preferenceSchemas.ts')
const keyPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

function loadRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.entries)) {
    throw new Error('Unsupported Preference registry format')
  }

  const seen = new Set()
  for (const entry of registry.entries) {
    if (!keyPattern.test(entry.key)) throw new Error(`Invalid Preference key: ${entry.key}`)
    if (seen.has(entry.key)) throw new Error(`Duplicate Preference key: ${entry.key}`)
    if (typeof entry.type !== 'string' || !entry.type.trim()) throw new Error(`Missing type for ${entry.key}`)
    if (!Object.hasOwn(entry, 'defaultValue')) throw new Error(`Missing defaultValue for ${entry.key}`)
    if (typeof entry.description !== 'string' || !entry.description.trim()) {
      throw new Error(`Missing description for ${entry.key}`)
    }
    seen.add(entry.key)
  }
  return registry.entries.toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function formatDefaultValue(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') {
    if (value.startsWith('VALUE: ')) return value.slice(7)
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(formatDefaultValue).join(', ')}]`
  if (typeof value === 'object') {
    const fields = Object.entries(value).map(([key, field]) => `${key}: ${formatDefaultValue(field)}`)
    return `{ ${fields.join(', ')} }`
  }
  throw new Error(`Unsupported default value: ${String(value)}`)
}

function generate(entries) {
  const interfaceProperties = entries
    .map((entry) => `    // ${entry.description}\n    '${entry.key}': ${entry.type}`)
    .join('\n')
  const defaults = entries
    .map(
      (entry, index) =>
        `    '${entry.key}': ${formatDefaultValue(entry.defaultValue)}${index + 1 === entries.length ? '' : ','}`
    )
    .join('\n')

  const source = `/**
 * Auto-generated preferences configuration.
 *
 * This file is generated from scripts/preference-schema/registry.json.
 * Run \`pnpm preferences:generate\` after changing the registry and
 * \`pnpm preferences:check\` to verify that this file is current.
 *
 * All preference keys must use lowercase dot-separated segments. This is also
 * enforced by the data-schema-key/valid-key ESLint rule.
 *
 * === AUTO-GENERATED CONTENT START ===
 */

import { TRANSLATE_PROMPT } from '@shared/ai/prompts'
import * as PreferenceTypes from '@shared/data/preference/preferenceTypes'

/* eslint @typescript-eslint/member-ordering: ["error", {
  "interfaces": { "order": "alphabetically" },
  "typeLiterals": { "order": "alphabetically" }
}] */
export interface PreferenceSchemas {
  default: {
${interfaceProperties}
  }
}

/* eslint sort-keys: ["error", "asc", {"caseSensitive": true, "natural": false}] */
export const DefaultPreferences: PreferenceSchemas = {
  default: {
${defaults}
  }
}

// === AUTO-GENERATED CONTENT END ===
`
  const biomePath = path.join(repositoryRoot, 'node_modules/.bin/biome')
  const formatted = spawnSync(biomePath, ['format', '--stdin-file-path', outputPath], {
    input: source,
    encoding: 'utf8'
  })
  if (formatted.status !== 0) throw new Error(formatted.stderr || 'Biome could not format the generated schema')
  return formatted.stdout
}

const expected = generate(loadRegistry())
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
  if (current !== expected) {
    console.error('Preference schema is out of date. Run: pnpm preferences:generate')
    process.exit(1)
  }
  console.log('Preference schema is up to date.')
} else {
  fs.writeFileSync(outputPath, expected)
  console.log(`Generated ${path.relative(repositoryRoot, outputPath)}.`)
}
