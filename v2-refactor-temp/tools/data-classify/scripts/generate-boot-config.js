#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

/**
 * Manually maintained boot config items that aren't sourced from
 * classification.json. These get merged into the generator's normal
 * extraction pipeline so they flow through the same sort/emit code as
 * classification-derived items — the output schema is a single, flat,
 * fully auto-generated file.
 *
 * When classification.json learns to model new source kinds (e.g. a
 * 'configfile' category), these entries should move into classification.json
 * and this constant can shrink.
 */
const MANUAL_BOOT_CONFIG_ITEMS = [
  {
    source: 'configfile',
    sourceCategory: 'legacy-home',
    originalKey: 'appDataPath',
    targetKey: 'app.user_data_path',
    zodType: 'z.record(z.string(), z.string())',
    defaultValue: 'VALUE: {}',
    jsdoc: [
      'Custom user data directory, keyed by executable path.',
      '',
      'Conceptually a single setting ("where user data lives"); stored as a',
      'Record so the same machine can host multiple installations (stable / dev /',
      "portable) with independent user data locations — matching the v1 behavior",
      "of ~/.cherrystudio/config/config.json's `appDataPath` array.",
      '',
      'Key: normalized executable path from getNormalizedExecutablePath() —',
      "intentionally not `app.getPath('exe')` for Linux AppImage and Windows",
      'portable builds, whose raw exe paths are unstable across launches.',
      'Value: absolute path to the chosen userData directory.',
      '',
      'Migrated from v1 ~/.cherrystudio/config/config.json on first v1→v2 run',
      "via the 'configfile' source in BootConfigMigrator."
    ]
  },
  {
    source: 'preboot',
    sourceCategory: 'transient',
    originalKey: 'userDataRelocation',
    targetKey: 'temp.user_data_relocation',
    zodType:
      'z\n' +
      '    .union([\n' +
      '      z.object({\n' +
      "        status: z.literal('pending'),\n" +
      '        taskId: z.uuid(),\n' +
      '        from: z.string(),\n' +
      '        to: z.string(),\n' +
      '        copy: z.boolean()\n' +
      '      }),\n' +
      '      z.object({\n' +
      "        status: z.literal('failed'),\n" +
      '        taskId: z.uuid(),\n' +
      '        from: z.string(),\n' +
      '        to: z.string(),\n' +
      '        copy: z.boolean(),\n' +
      '        error: z.string(),\n' +
      '        failedAt: z.string()\n' +
      '      })\n' +
      '    ])\n' +
      '    .nullable()',
    defaultValue: null,
    jsdoc: [
      'In-flight relocation of the Electron userData directory tree',
      "(the directory returned by `app.getPath('userData')`).",
      '',
      'Lives under the `temp.*` top-level namespace — reserved for ephemeral',
      'runtime state: single in-flight operations meant to be cleared once',
      'consumed. **Never** backed up or synced: restoring a stale temp.* entry',
      'on a different machine or at a different time can cause silent data',
      'corruption (e.g. re-executing a relocation that already happened).',
      '',
      'Lifecycle:',
      '  - null: no relocation in progress (default).',
      "  - { status: 'pending', taskId, from, to, copy }: the relocation",
      '    request face (services/userDataRelocation) wrote this request and',
      '    the next preboot should execute it.',
      "  - { status: 'failed', taskId, from, to, copy, error, failedAt }:",
      '    a previous preboot attempt failed. The record stays in BootConfig',
      '    until the dedicated relocation window shows the error and the user',
      '    explicitly abandons it by restarting on the previous userData path.',
      '',
      'Note: "userData" here means the Electron OS directory',
      "(app.getPath('userData')), not the colloquial sense of user content.",
      'The copy includes everything under that directory — user files,',
      'Chromium runtime state, logs, etc.',
      '',
      'Consumer: src/main/services/userDataRelocation'
    ]
  }
]

class BootConfigGenerator {
  constructor() {
    this.dataDir = path.resolve(__dirname, '../data')
    this.targetFile = path.resolve(__dirname, '../../../../src/shared/data/bootConfig/bootConfigSchemas.ts')
    this.classificationFile = path.join(this.dataDir, 'classification.json')
  }

  generate() {
    console.log('Generating bootConfigSchemas.ts...')

    const classification = this.loadClassification()
    const bootConfigData = this.extractBootConfigData(classification)
    const content = this.generateTypeScriptCode(bootConfigData)
    this.writeFile(content)

    console.log('bootConfigSchemas.ts generated!')
    this.printSummary(bootConfigData)
  }

  loadClassification() {
    if (!fs.existsSync(this.classificationFile)) {
      throw new Error(`Classification file not found: ${this.classificationFile}`)
    }

    const content = fs.readFileSync(this.classificationFile, 'utf8')
    return JSON.parse(content)
  }

  extractBootConfigData(classification) {
    const allItems = []
    const sources = ['electronStore', 'redux', 'localStorage', 'dexieSettings']

    const extractItems = (items, source, category, parentKey = '') => {
      if (!Array.isArray(items)) return

      items.forEach((item) => {
        if (item.children && Array.isArray(item.children)) {
          extractItems(item.children, source, category, `${parentKey}${item.originalKey}.`)
          return
        }

        if (item.category === 'bootConfig' && item.status === 'classified' && item.targetKey) {
          allItems.push({
            ...item,
            source,
            sourceCategory: category,
            originalKey: parentKey + item.originalKey,
            fullPath: `${source}/${category}/${parentKey}${item.originalKey}`,
          })
        }
      })
    }

    sources.forEach((source) => {
      if (classification.classifications[source]) {
        Object.keys(classification.classifications[source]).forEach((category) => {
          const items = classification.classifications[source][category]
          extractItems(items, source, category)
        })
      }
    })

    console.log(`Extracted ${allItems.length} bootConfig items`)

    // Deduplicate by targetKey: redux(4) > dexieSettings(3) > localStorage(2) > electronStore(1)
    const targetKeyGroups = {}
    allItems.forEach((item) => {
      if (!targetKeyGroups[item.targetKey]) {
        targetKeyGroups[item.targetKey] = []
      }
      targetKeyGroups[item.targetKey].push(item)
    })

    const sourcePriority = { redux: 4, dexieSettings: 3, localStorage: 2, electronStore: 1 }
    const deduplicatedData = []

    Object.keys(targetKeyGroups).forEach((targetKey) => {
      const items = targetKeyGroups[targetKey]
      if (items.length > 1) {
        console.log(`Duplicate targetKey: ${targetKey}, ${items.length} items`)
        items.forEach((item) => console.log(`  - ${item.fullPath}`))

        items.sort((a, b) => sourcePriority[b.source] - sourcePriority[a.source])
        const selected = items[0]
        console.log(`  Selected: ${selected.fullPath}`)
        deduplicatedData.push(selected)
      } else {
        deduplicatedData.push(items[0])
      }
    })

    // Append manually maintained items (config-file source for v1 legacy
    // home config). These bypass classification.json deliberately — see the
    // MANUAL_BOOT_CONFIG_ITEMS comment at the top of this file.
    for (const manual of MANUAL_BOOT_CONFIG_ITEMS) {
      deduplicatedData.push({ ...manual, fullPath: `${manual.source}/${manual.sourceCategory}/${manual.originalKey}` })
    }

    console.log(`After deduplication + manual items: ${deduplicatedData.length} bootConfig items`)
    return deduplicatedData
  }

  /**
   * Map an item to its emitted zod schema expression.
   *
   * Only explicit `zodType` (manual items) and explicit simple `type`
   * (classification items) are accepted. Deliberately NEVER falls back to
   * `typeof defaultValue` like the old interface-type mapper did: a
   * 'VALUE: xxx' escape string would masquerade as a string default and
   * silently emit the wrong schema. Unknown types abort generation loudly.
   */
  mapZodType(item) {
    if (item.zodType) return item.zodType

    const ZOD_TYPE_MAP = { boolean: 'z.boolean()', string: 'z.string()', number: 'z.number()' }
    const mapped = ZOD_TYPE_MAP[item.type]
    if (!mapped) {
      throw new Error(
        `No zod mapping for bootConfig item '${item.targetKey}' (type: ${item.type}). ` +
          `Add an explicit zodType or a simple type (boolean/string/number).`
      )
    }
    return mapped
  }

  formatDefaultValue(value) {
    if (value === null || value === undefined) {
      return 'null'
    }
    if (typeof value === 'string') {
      if (value.startsWith('VALUE: ')) {
        return value.substring(7)
      }
      return `'${value.replace(/'/g, "\\'")}'`
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value)
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.formatDefaultValue(item)).join(', ')}]`
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value).map(([k, v]) => `${k}: ${this.formatDefaultValue(v)}`)
      return `{ ${entries.join(', ')} }`
    }
    return JSON.stringify(value)
  }

  generateTypeScriptCode(bootConfigData) {
    const sortedData = [...bootConfigData].sort((a, b) => a.targetKey.localeCompare(b.targetKey))

    const header = `/**
 * Auto-generated boot config schema
 * Generated at: ${new Date().toISOString()}
 *
 * This file is automatically generated from classification.json (plus a
 * small MANUAL_BOOT_CONFIG_ITEMS list in generate-boot-config.js for keys
 * that don't fit classification.json's model yet, e.g. config-file sources).
 *
 * The zod schema is the single source of truth: the BootConfigSchema type
 * is inferred from it, and BootConfigService validates file/set values
 * against it at runtime.
 *
 * To update this file, either modify classification.json or the manual list
 * in the generator, then run:
 * node v2-refactor-temp/tools/data-classify/scripts/generate-boot-config.js
 *
 * === AUTO-GENERATED CONTENT START ===
 */`

    // Namespace form required by eslint's import-zod/prefer-zod-namespace —
    // emitting `import { z }` would make every regeneration lint-dirty.
    const importCode = "import * as z from 'zod'"

    let schemaCode = 'export const bootConfigSchema = z.object({\n'
    sortedData.forEach((item, index) => {
      const zodExpr = this.mapZodType(item)
      // Optional JSDoc block (currently only emitted for manual items).
      if (Array.isArray(item.jsdoc) && item.jsdoc.length > 0) {
        if (index > 0) schemaCode += '\n'
        schemaCode += '  /**\n'
        for (const line of item.jsdoc) {
          schemaCode += line.length > 0 ? `   * ${line}\n` : '   *\n'
        }
        schemaCode += '   */\n'
      }
      schemaCode += `  // ${item.source}/${item.sourceCategory}/${item.originalKey}\n`
      const isLast = index === sortedData.length - 1
      schemaCode += `  '${item.targetKey}': ${zodExpr}${isLast ? '' : ','}\n`
    })
    schemaCode += '})'

    const typeCode = 'export type BootConfigSchema = z.infer<typeof bootConfigSchema>'

    let defaultsCode = 'export const DefaultBootConfig: BootConfigSchema = {\n'
    sortedData.forEach((item, index) => {
      const defaultVal = this.formatDefaultValue(item.defaultValue)
      const isLast = index === sortedData.length - 1
      defaultsCode += `  '${item.targetKey}': ${defaultVal}${isLast ? '' : ','}\n`
    })
    defaultsCode += '}'

    const footer = '// === AUTO-GENERATED CONTENT END ==='

    return [header, '', importCode, '', schemaCode, '', typeCode, '', defaultsCode, '', footer, ''].join('\n')
  }

  writeFile(content) {
    const targetDir = path.dirname(this.targetFile)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    fs.writeFileSync(this.targetFile, content, 'utf8')
    console.log(`Written to: ${this.targetFile}`)
  }

  printSummary(bootConfigData) {
    console.log(`\nSummary:`)
    console.log(`- Total items: ${bootConfigData.length}`)
    console.log(`- electronStore: ${bootConfigData.filter((p) => p.source === 'electronStore').length}`)
    console.log(`- redux: ${bootConfigData.filter((p) => p.source === 'redux').length}`)
    console.log(`- localStorage: ${bootConfigData.filter((p) => p.source === 'localStorage').length}`)
    console.log(`- dexieSettings: ${bootConfigData.filter((p) => p.source === 'dexieSettings').length}`)
    console.log(`- Output: ${this.targetFile}`)
  }
}

if (require.main === module) {
  try {
    const generator = new BootConfigGenerator()
    generator.generate()
  } catch (error) {
    console.error('Generation failed:', error.message)
    process.exit(1)
  }
}

module.exports = BootConfigGenerator
