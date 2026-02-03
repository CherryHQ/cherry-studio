/**
 * Shared utilities for data classification tools
 *
 * This module provides common functions used across multiple scripts:
 * - Loading and saving classification data
 * - Extracting preferences data with deduplication
 * - Traversing nested classification structures
 */

const fs = require('fs')
const path = require('path')

/**
 * Default data directory path
 */
const DATA_DIR = path.resolve(__dirname, '../../data')

/**
 * Load classification.json file
 * @param {string} [dataDir] - Optional custom data directory
 * @returns {Object} Parsed classification data
 */
function loadClassification(dataDir = DATA_DIR) {
  const classificationFile = path.join(dataDir, 'classification.json')

  if (!fs.existsSync(classificationFile)) {
    throw new Error(`Classification file not found: ${classificationFile}`)
  }

  const content = fs.readFileSync(classificationFile, 'utf8')
  return JSON.parse(content)
}

/**
 * Save classification data to file with backup
 * @param {Object} classification - Classification data to save
 * @param {string} [dataDir] - Optional custom data directory
 */
function saveClassification(classification, dataDir = DATA_DIR) {
  const classificationFile = path.join(dataDir, 'classification.json')

  // Create backup if file exists
  if (fs.existsSync(classificationFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(dataDir, `classification.backup.${timestamp}.json`)
    fs.copyFileSync(classificationFile, backupPath)
    console.log(`Backup created: ${backupPath}`)
  }

  fs.writeFileSync(classificationFile, JSON.stringify(classification, null, 2), 'utf8')
  console.log(`Classification saved: ${classificationFile}`)
}

/**
 * Load inventory.json file
 * @param {string} [dataDir] - Optional custom data directory
 * @returns {Object} Parsed inventory data
 */
function loadInventory(dataDir = DATA_DIR) {
  const inventoryFile = path.join(dataDir, 'inventory.json')

  if (!fs.existsSync(inventoryFile)) {
    throw new Error(`Inventory file not found: ${inventoryFile}`)
  }

  const content = fs.readFileSync(inventoryFile, 'utf8')
  return JSON.parse(content)
}

/**
 * Source priority for deduplication
 * Higher number = higher priority
 */
const SOURCE_PRIORITY = {
  redux: 3,
  localStorage: 2,
  electronStore: 1
}

/**
 * Extract preferences data from classification with deduplication
 * Supports nested structures with children
 *
 * @param {Object} classification - Classification data object
 * @returns {Object} Object with categorized preferences data:
 *   - all: all deduplicated items
 *   - electronStore: items from electronStore
 *   - redux: items from redux
 *   - localStorage: items from localStorage
 */
function extractPreferencesData(classification) {
  const allPreferencesData = []
  const sources = ['electronStore', 'redux', 'localStorage']

  // Recursive function to extract items including children
  const extractItems = (items, source, category, parentKey = '') => {
    if (!Array.isArray(items)) return

    items.forEach((item) => {
      // Handle items with children
      if (item.children && Array.isArray(item.children)) {
        extractItems(item.children, source, category, `${parentKey}${item.originalKey}.`)
        return
      }

      // Handle regular items
      if (item.category === 'preferences' && item.status === 'classified' && item.targetKey) {
        allPreferencesData.push({
          ...item,
          source,
          sourceCategory: category,
          originalKey: parentKey + item.originalKey,
          fullPath: `${source}/${category}/${parentKey}${item.originalKey}`
        })
      }
    })
  }

  // Extract from all sources
  sources.forEach((source) => {
    if (classification.classifications[source]) {
      Object.keys(classification.classifications[source]).forEach((category) => {
        const items = classification.classifications[source][category]
        extractItems(items, source, category)
      })
    }
  })

  // Handle duplicate targetKeys with priority-based selection
  const targetKeyGroups = {}
  allPreferencesData.forEach((item) => {
    if (!targetKeyGroups[item.targetKey]) {
      targetKeyGroups[item.targetKey] = []
    }
    targetKeyGroups[item.targetKey].push(item)
  })

  // Deduplicate using source priority
  const deduplicatedData = []
  Object.keys(targetKeyGroups).forEach((targetKey) => {
    const items = targetKeyGroups[targetKey]
    if (items.length > 1) {
      // Sort by priority and select highest
      items.sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source])
    }
    deduplicatedData.push(items[0])
  })

  // Group by source
  const result = {
    electronStore: [],
    redux: [],
    localStorage: [],
    all: deduplicatedData
  }

  deduplicatedData.forEach((item) => {
    if (result[item.source]) {
      result[item.source].push(item)
    }
  })

  return result
}

/**
 * Traverse nested classification structure
 * Calls callback for each item (including nested children)
 *
 * @param {Object} classifications - The classifications object
 * @param {Function} callback - Function to call for each item: (item, source, category, fullKey) => void
 */
function traverseClassifications(classifications, callback) {
  const traverse = (items, source, category, parentKey = '') => {
    if (!Array.isArray(items)) return

    for (const item of items) {
      const fullKey = parentKey ? `${parentKey}.${item.originalKey}` : item.originalKey

      // Call callback for this item
      callback(item, source, category, fullKey)

      // Recurse into children
      if (item.children && Array.isArray(item.children)) {
        traverse(item.children, source, category, fullKey)
      }
    }
  }

  // Iterate through all sources and categories
  for (const [source, sourceData] of Object.entries(classifications)) {
    if (typeof sourceData === 'object' && sourceData !== null) {
      for (const [category, items] of Object.entries(sourceData)) {
        if (Array.isArray(items)) {
          traverse(items, source, category, '')
        }
      }
    }
  }
}

/**
 * Get all flat keys from nested classification structure
 * Used for comparison and validation
 *
 * @param {Object} classifications - The classifications object
 * @returns {string[]} Array of full keys in format "source.category.field" or "source.category.parent.child"
 */
function getAllClassificationKeys(classifications) {
  const keys = []

  traverseClassifications(classifications, (item, source, category, fullKey) => {
    // Build the complete key path
    if (source === 'redux') {
      keys.push(`${source}.${category}.${fullKey}`)
    } else {
      keys.push(`${source}.${fullKey}`)
    }
  })

  return keys
}

/**
 * Calculate statistics from nested classification structure
 *
 * @param {Object} classifications - The classifications object
 * @returns {Object} Statistics object with counts by status and category
 */
function calculateStats(classifications) {
  const stats = {
    byStatus: {
      pending: 0,
      classified: 0,
      'classified-deleted': 0
    },
    byCategory: {},
    total: 0
  }

  traverseClassifications(classifications, (item) => {
    stats.total++

    // Count by status
    if (item.status) {
      stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1
    }

    // Count by category (only for classified items)
    if (item.status === 'classified' && item.category) {
      stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1
    }
  })

  return stats
}

/**
 * Normalize type string to standard format
 *
 * @param {string} type - Type string to normalize
 * @returns {string} Normalized type string
 */
function normalizeType(type) {
  if (!type || type === 'unknown') {
    return 'unknown'
  }

  const cleanType = String(type).toLowerCase().trim()

  // Handle union types - extract primary type
  if (cleanType.includes('|')) {
    const types = cleanType.split('|').map((t) => t.trim())
    const nonNullTypes = types.filter((t) => t !== 'null' && t !== 'undefined')
    if (nonNullTypes.length > 0) {
      return normalizeType(nonNullTypes[0])
    }
    return normalizeType(types[0])
  }

  // Map to standard types
  if (cleanType === 'string' || cleanType.includes('string')) return 'string'
  if (cleanType === 'number' || cleanType.includes('number')) return 'number'
  if (cleanType === 'boolean' || cleanType.includes('boolean')) return 'boolean'
  if (cleanType === 'array' || cleanType.includes('[]')) return 'array'
  if (cleanType === 'object' || cleanType.includes('object') || cleanType.includes('record')) return 'object'
  if (cleanType === 'null') return 'null'
  if (cleanType === 'undefined') return 'undefined'
  if (cleanType.includes('entitytable') || cleanType === 'table') return 'table'

  return 'unknown'
}

/**
 * Infer type from a value
 *
 * @param {*} value - Value to infer type from
 * @returns {string} Inferred type string
 */
function inferTypeFromValue(value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return 'unknown'
}

module.exports = {
  DATA_DIR,
  loadClassification,
  saveClassification,
  loadInventory,
  extractPreferencesData,
  traverseClassifications,
  getAllClassificationKeys,
  calculateStats,
  normalizeType,
  inferTypeFromValue,
  SOURCE_PRIORITY
}
