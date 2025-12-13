#!/usr/bin/env node

/**
 * Data Inventory Extractor
 *
 * Extracts data inventory from Cherry Studio source code and manages
 * incremental updates to classification.json with backup protection.
 *
 * Features:
 * - Extracts Redux, ElectronStore, LocalStorage, and Dexie data
 * - Preserves existing classifications during updates
 * - Creates automatic backups before modifications
 * - Supports nested data structures with children
 *
 * Usage:
 *   node v2-refactor-temp/tools/data-classify/scripts/extract-inventory.js
 */

const fs = require('fs')
const path = require('path')

const {
  loadClassification,
  saveClassification,
  normalizeType,
  inferTypeFromValue,
  calculateStats,
  DATA_DIR
} = require('./lib/classificationUtils')

// Redux store modules configuration
const REDUX_STORE_MODULES = {
  assistants: { file: 'assistants.ts', interface: 'AssistantsState' },
  backup: { file: 'backup.ts', interface: 'BackupState' },
  copilot: { file: 'copilot.ts', interface: 'CopilotState' },
  inputTools: { file: 'inputTools.ts', interface: 'InputToolsState' },
  knowledge: { file: 'knowledge.ts', interface: 'KnowledgeState' },
  llm: { file: 'llm.ts', interface: 'LlmState' },
  mcp: { file: 'mcp.ts', interface: 'McpState' },
  memory: { file: 'memory.ts', interface: 'MemoryState' },
  messageBlock: { file: 'messageBlock.ts', interface: 'MessageBlockState' },
  migrate: { file: 'migrate.ts', interface: 'MigrateState' },
  minapps: { file: 'minapps.ts', interface: 'MinappsState' },
  newMessage: { file: 'newMessage.ts', interface: 'NewMessageState' },
  nutstore: { file: 'nutstore.ts', interface: 'NutstoreState' },
  paintings: { file: 'paintings.ts', interface: 'PaintingsState' },
  preprocess: { file: 'preprocess.ts', interface: 'PreprocessState' },
  runtime: { file: 'runtime.ts', interface: 'RuntimeState' },
  selectionStore: { file: 'selectionStore.ts', interface: 'SelectionState' },
  settings: { file: 'settings.ts', interface: 'SettingsState' },
  shortcuts: { file: 'shortcuts.ts', interface: 'ShortcutsState' },
  tabs: { file: 'tabs.ts', interface: 'TabsState' },
  toolPermissions: { file: 'toolPermissions.ts', interface: 'ToolPermissionsState' },
  translate: { file: 'translate.ts', interface: 'TranslateState' },
  websearch: { file: 'websearch.ts', interface: 'WebSearchState' },
  codeTools: { file: 'codeTools.ts', interface: 'CodeToolsState' },
  ocr: { file: 'ocr.ts', interface: 'OcrState' },
  note: { file: 'note.ts', interface: 'NoteState' }
}

class DataExtractor {
  constructor(rootDir = '../../../../') {
    this.rootDir = path.resolve(__dirname, rootDir)
    this.dataDir = DATA_DIR
    console.log('Root directory:', this.rootDir)
    console.log('Data directory:', this.dataDir)
  }

  /**
   * Main extraction entry point
   */
  async extract() {
    console.log('Starting data inventory extraction...\n')

    const inventory = {
      metadata: {
        generatedAt: new Date().toISOString(),
        version: '2.0.0',
        description: 'Cherry Studio data inventory'
      },
      redux: await this.extractReduxData(),
      electronStore: await this.extractElectronStoreData(),
      localStorage: await this.extractLocalStorageData(),
      dexie: await this.extractDexieData()
    }

    // Load existing classification and merge
    let existingClassification
    try {
      existingClassification = loadClassification(this.dataDir)
    } catch {
      existingClassification = { classifications: {} }
    }

    const updatedData = this.mergeWithExisting(inventory, existingClassification)

    // Save results
    this.saveInventory(updatedData.inventory)
    saveClassification(updatedData.classification, this.dataDir)

    console.log('\nData extraction complete!')
    this.printSummary(updatedData)
  }

  /**
   * Extract Redux store data from source files
   */
  async extractReduxData() {
    console.log('Extracting Redux Store data...')
    const reduxData = {}

    for (const [moduleName, moduleInfo] of Object.entries(REDUX_STORE_MODULES)) {
      const filePath = path.join(this.rootDir, `src/renderer/src/store/${moduleInfo.file}`)

      if (!fs.existsSync(filePath)) {
        console.warn(`  Warning: ${moduleInfo.file} not found`)
        continue
      }

      const content = fs.readFileSync(filePath, 'utf8')
      const stateInterface = this.extractStateInterface(content, moduleInfo.interface)
      const initialState = this.extractInitialState(content)

      reduxData[moduleName] = {
        _meta: {
          file: `src/renderer/src/store/${moduleInfo.file}`,
          interface: moduleInfo.interface
        }
      }

      // Add fields from interface and initial state
      const fields = Object.keys(stateInterface).length > 0 ? stateInterface : initialState

      for (const [fieldName, fieldInfo] of Object.entries(fields)) {
        if (fieldName === '_meta') continue

        reduxData[moduleName][fieldName] = {
          file: `src/renderer/src/store/${moduleInfo.file}`,
          type: fieldInfo.type || inferTypeFromValue(initialState[fieldName]),
          defaultValue: initialState[fieldName] ?? fieldInfo.defaultValue ?? null
        }
      }
    }

    console.log(`  Found ${Object.keys(reduxData).length} Redux modules`)
    return reduxData
  }

  /**
   * Extract Electron Store configuration keys
   */
  async extractElectronStoreData() {
    console.log('Extracting Electron Store data...')
    const electronStoreData = {}

    const configManagerPath = path.join(this.rootDir, 'src/main/services/ConfigManager.ts')
    if (!fs.existsSync(configManagerPath)) {
      console.warn('  Warning: ConfigManager.ts not found')
      return electronStoreData
    }

    const content = fs.readFileSync(configManagerPath, 'utf8')
    const configKeys = this.extractConfigKeys(content)

    for (const key of configKeys) {
      electronStoreData[key] = {
        file: 'src/main/services/ConfigManager.ts',
        enum: `ConfigKeys.${key}`,
        type: 'unknown',
        defaultValue: null
      }
    }

    console.log(`  Found ${configKeys.length} ConfigKeys`)
    return electronStoreData
  }

  /**
   * Extract localStorage usage from source files
   */
  async extractLocalStorageData() {
    console.log('Extracting LocalStorage data...')
    const localStorageData = {}

    const { glob } = require('glob')
    const files = await glob('src/**/*.ts', { cwd: this.rootDir })

    for (const file of files) {
      const filePath = path.join(this.rootDir, file)
      const content = fs.readFileSync(filePath, 'utf8')

      // Find localStorage.getItem and localStorage.setItem calls
      const getItemRegex = /localStorage\.getItem\(['"]([^'"]+)['"]\)/g
      const setItemRegex = /localStorage\.setItem\(['"]([^'"]+)['"],/g

      let match
      while ((match = getItemRegex.exec(content)) !== null) {
        if (!localStorageData[match[1]]) {
          localStorageData[match[1]] = {
            file: file,
            type: 'string',
            defaultValue: null
          }
        }
      }

      while ((match = setItemRegex.exec(content)) !== null) {
        if (!localStorageData[match[1]]) {
          localStorageData[match[1]] = {
            file: file,
            type: 'string',
            defaultValue: null
          }
        }
      }
    }

    console.log(`  Found ${Object.keys(localStorageData).length} localStorage keys`)
    return localStorageData
  }

  /**
   * Extract Dexie database tables
   */
  async extractDexieData() {
    console.log('Extracting Dexie data...')
    const dexieData = {}

    const databasePath = path.join(this.rootDir, 'src/renderer/src/databases/index.ts')
    if (!fs.existsSync(databasePath)) {
      console.warn('  Warning: databases/index.ts not found')
      return dexieData
    }

    const content = fs.readFileSync(databasePath, 'utf8')

    // Match table definitions like: tableName: EntityTable<TypeName>
    const tableRegex = /(\w+):\s*EntityTable<([^>]+)>/g
    let match

    while ((match = tableRegex.exec(content)) !== null) {
      dexieData[match[1]] = {
        file: 'src/renderer/src/databases/index.ts',
        type: `EntityTable<${match[2]}>`,
        schema: null
      }
    }

    console.log(`  Found ${Object.keys(dexieData).length} Dexie tables`)
    return dexieData
  }

  /**
   * Extract TypeScript interface fields
   */
  extractStateInterface(content, interfaceName) {
    const fields = {}

    // Match interface definition
    const interfaceMatch = content.match(new RegExp(`export interface ${interfaceName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))

    if (!interfaceMatch) return fields

    const interfaceBody = interfaceMatch[1]
    const lines = interfaceBody.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue

      // Match field: type pattern
      const fieldMatch = trimmed.match(/^(\w+)(\?)?:\s*([^;]+)/)
      if (fieldMatch) {
        const fieldName = fieldMatch[1]
        let fieldType = fieldMatch[3].trim().replace(/[,;]$/, '')

        fields[fieldName] = {
          type: normalizeType(fieldType),
          defaultValue: null
        }
      }
    }

    return fields
  }

  /**
   * Extract initial state values from TypeScript file
   */
  extractInitialState(content) {
    const state = {}

    // Match initialState definition
    const stateMatch = content.match(/(?:export )?const initialState[^=]*=\s*\{([\s\S]*?)\n\}(?=\s*\n|$)/m)

    if (!stateMatch) return state

    // Simple field extraction
    const stateBody = stateMatch[1]
    const lines = stateBody.split('\n')
    let currentField = null
    let currentValue = ''
    let braceCount = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//')) continue

      if (currentField) {
        currentValue += ' ' + trimmed
        braceCount += (trimmed.match(/\{/g) || []).length
        braceCount -= (trimmed.match(/\}/g) || []).length

        if (braceCount === 0 && (trimmed.endsWith(',') || trimmed === '}')) {
          state[currentField] = this.parseValue(currentValue.replace(/,$/, '').trim())
          currentField = null
          currentValue = ''
        }
        continue
      }

      const fieldMatch = trimmed.match(/^(\w+):\s*(.+)/)
      if (fieldMatch) {
        const fieldName = fieldMatch[1]
        const fieldValue = fieldMatch[2]

        braceCount = (fieldValue.match(/\{/g) || []).length - (fieldValue.match(/\}/g) || []).length

        if (braceCount === 0 && (fieldValue.endsWith(',') || fieldValue.endsWith('}'))) {
          state[fieldName] = this.parseValue(fieldValue.replace(/,$/, '').trim())
        } else {
          currentField = fieldName
          currentValue = fieldValue
        }
      }
    }

    return state
  }

  /**
   * Extract ConfigKeys enum values
   */
  extractConfigKeys(content) {
    const keys = []
    const enumMatch = content.match(/export enum ConfigKeys \{([^}]+)\}/g)

    if (enumMatch) {
      const enumContent = enumMatch[0]
      const keyRegex = /(\w+)\s*=/g
      let match

      while ((match = keyRegex.exec(enumContent)) !== null) {
        keys.push(match[1])
      }
    }

    return keys
  }

  /**
   * Parse a value string to appropriate type
   */
  parseValue(valueStr) {
    const trimmed = valueStr.trim()

    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (trimmed === 'null') return null
    if (trimmed === 'undefined') return undefined
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
    if (/^-?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed)

    // Handle strings
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1)
    }

    // Handle arrays and objects - return as string for complex values
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed.replace(/'/g, '"'))
      } catch {
        return trimmed
      }
    }

    return trimmed
  }

  /**
   * Merge new inventory with existing classification
   */
  mergeWithExisting(newInventory, existingClassification) {
    const updatedClassifications = this.convertToNestedStructure(newInventory, existingClassification)

    // Calculate statistics
    const stats = calculateStats(updatedClassifications)

    const updatedClassification = {
      metadata: {
        version: '2.0.0',
        lastUpdated: new Date().toISOString(),
        totalItems: stats.total,
        classified: stats.byStatus.classified || 0,
        pending: stats.byStatus.pending || 0,
        deleted: stats.byStatus['classified-deleted'] || 0
      },
      classifications: updatedClassifications
    }

    return {
      inventory: newInventory,
      classification: updatedClassification
    }
  }

  /**
   * Convert flat inventory to nested classification structure
   */
  convertToNestedStructure(newInventory, existingClassification) {
    const nestedClassifications = {}
    const existing = existingClassification?.classifications || {}

    for (const [source, data] of Object.entries(newInventory)) {
      if (source === 'metadata') continue

      if (!nestedClassifications[source]) {
        nestedClassifications[source] = {}
      }

      if (source === 'redux') {
        // Redux: group by module
        for (const [moduleName, moduleData] of Object.entries(data)) {
          if (!nestedClassifications[source][moduleName]) {
            nestedClassifications[source][moduleName] = []
          }

          for (const fieldName of Object.keys(moduleData)) {
            if (fieldName === '_meta') continue

            const fieldData = moduleData[fieldName]
            const existingItem = this.findExisting(existing, source, moduleName, fieldName)

            nestedClassifications[source][moduleName].push({
              originalKey: fieldName,
              type: existingItem?.type || normalizeType(fieldData?.type),
              defaultValue: existingItem?.defaultValue ?? fieldData?.defaultValue ?? null,
              status: existingItem?.status || 'pending',
              category: existingItem?.category || null,
              targetKey: existingItem?.targetKey || null,
              ...(existingItem?.children ? { children: existingItem.children } : {})
            })
          }
        }
      } else {
        // Other sources: direct mapping
        for (const [tableName, tableData] of Object.entries(data)) {
          if (!nestedClassifications[source][tableName]) {
            nestedClassifications[source][tableName] = []
          }

          const existingItem = this.findExisting(existing, source, tableName, null)

          nestedClassifications[source][tableName].push({
            originalKey: tableName,
            type: existingItem?.type || (source === 'dexie' ? 'table' : normalizeType(tableData?.type)),
            defaultValue: existingItem?.defaultValue ?? tableData?.defaultValue ?? null,
            status: existingItem?.status || 'pending',
            category: existingItem?.category || null,
            targetKey: existingItem?.targetKey || null
          })
        }
      }
    }

    return nestedClassifications
  }

  /**
   * Find existing classification item
   */
  findExisting(existing, source, moduleOrTable, field) {
    if (!existing[source]) return null

    const sourceData = existing[source]
    const items = sourceData[moduleOrTable]

    if (!Array.isArray(items)) return null

    // For redux: find by field name in module items
    if (field) {
      for (const item of items) {
        if (item.originalKey === field) return item
        if (item.children) {
          const child = item.children.find((c) => c.originalKey === field)
          if (child) return child
        }
      }
    } else {
      // For other sources: find by table name
      return items.find((item) => item.originalKey === moduleOrTable)
    }

    return null
  }

  /**
   * Save inventory to file
   */
  saveInventory(inventory) {
    const inventoryPath = path.join(this.dataDir, 'inventory.json')
    fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), 'utf8')
    console.log(`\nInventory saved: ${inventoryPath}`)
  }

  /**
   * Print extraction summary
   */
  printSummary(updatedData) {
    const { inventory, classification } = updatedData

    console.log('\n========== Extraction Summary ==========')
    console.log(`Redux modules: ${Object.keys(inventory.redux || {}).length}`)
    console.log(`Electron Store keys: ${Object.keys(inventory.electronStore || {}).length}`)
    console.log(`LocalStorage keys: ${Object.keys(inventory.localStorage || {}).length}`)
    console.log(`Dexie tables: ${Object.keys(inventory.dexie || {}).length}`)
    console.log('----------------------------------------')
    console.log(`Total items: ${classification.metadata.totalItems}`)
    console.log(`Classified: ${classification.metadata.classified}`)
    console.log(`Pending: ${classification.metadata.pending}`)
    if (classification.metadata.deleted > 0) {
      console.log(`Deleted: ${classification.metadata.deleted}`)
    }
    console.log('========================================\n')
  }
}

// Run script
if (require.main === module) {
  const extractor = new DataExtractor()
  extractor.extract().catch(console.error)
}

module.exports = DataExtractor
