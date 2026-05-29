#!/usr/bin/env node

/**
 * Data Consistency Validator
 *
 * Validates consistency between inventory.json and classification.json files.
 * Supports nested classification structures with children arrays.
 *
 * Checks:
 * - Missing classifications (data in inventory but not classified)
 * - Orphaned classifications (classified items not in inventory)
 * - Naming consistency (preferences should use dot-separated keys)
 * - Duplicate target keys
 *
 * Usage:
 *   node v2-refactor-temp/tools/data-classify/scripts/validate-consistency.js
 */

const fs = require('fs')
const path = require('path')

const {
  loadClassification,
  loadInventory,
  traverseClassifications,
  calculateStats,
  DATA_DIR
} = require('./lib/classificationUtils')

class DataValidator {
  constructor() {
    this.dataDir = DATA_DIR
  }

  /**
   * Main validation entry point
   */
  validate() {
    console.log('Starting data consistency validation...\n')

    let inventory, classification
    try {
      inventory = loadInventory(this.dataDir)
      classification = loadClassification(this.dataDir)
    } catch (error) {
      console.error(`Failed to load data files: ${error.message}`)
      process.exit(1)
    }

    const issues = []

    // Run all consistency checks
    issues.push(...this.checkMissingClassifications(inventory, classification))
    issues.push(...this.checkOrphanedClassifications(inventory, classification))
    issues.push(...this.checkNamingConsistency(classification))
    issues.push(...this.checkDuplicateTargets(classification))

    // Generate validation report
    this.generateReport(issues, classification)

    if (issues.length === 0) {
      console.log('Validation passed, no issues found')
    } else {
      const errors = issues.filter((i) => i.severity === 'error')
      const warnings = issues.filter((i) => i.severity === 'warning')
      console.log(`Found ${errors.length} errors, ${warnings.length} warnings`)
      if (errors.length > 0) {
        process.exit(1)
      }
    }
  }

  /**
   * Get all data keys from inventory
   */
  getAllInventoryKeys(inventory) {
    const keys = []

    for (const [source, data] of Object.entries(inventory)) {
      if (source === 'metadata') continue

      for (const [moduleOrTable, moduleData] of Object.entries(data)) {
        if (source === 'redux') {
          // Redux: keys are source.module.field
          for (const fieldName of Object.keys(moduleData)) {
            if (fieldName === '_meta') continue
            keys.push(`${source}.${moduleOrTable}.${fieldName}`)
          }
        } else {
          // Other sources: keys are source.tableName
          keys.push(`${source}.${moduleOrTable}`)
        }
      }
    }

    return keys
  }

  /**
   * Get all data keys from classification (supports nested structure)
   */
  getAllClassificationKeys(classification) {
    const keys = []

    traverseClassifications(classification.classifications, (item, source, category, fullKey) => {
      // Skip deleted items
      if (item.status === 'classified-deleted') return

      // Build full key path
      if (source === 'redux') {
        keys.push(`${source}.${category}.${fullKey}`)
      } else {
        keys.push(`${source}.${fullKey}`)
      }
    })

    return keys
  }

  /**
   * Check for data items not yet classified
   */
  checkMissingClassifications(inventory, classification) {
    const issues = []
    const inventoryKeys = this.getAllInventoryKeys(inventory)
    const classificationKeys = new Set(this.getAllClassificationKeys(classification))

    for (const key of inventoryKeys) {
      if (!classificationKeys.has(key)) {
        issues.push({
          type: 'missing_classification',
          severity: 'warning',
          key: key,
          message: `Data item "${key}" is not classified`
        })
      }
    }

    return issues
  }

  /**
   * Check for classified items not in current inventory
   */
  checkOrphanedClassifications(inventory, classification) {
    const issues = []
    const inventoryKeys = new Set(this.getAllInventoryKeys(inventory))

    traverseClassifications(classification.classifications, (item, source, category, fullKey) => {
      // Skip deleted items
      if (item.status === 'classified-deleted') return

      // Build full key path
      let fullKeyPath
      if (source === 'redux') {
        fullKeyPath = `${source}.${category}.${fullKey}`
      } else {
        fullKeyPath = `${source}.${fullKey}`
      }

      if (!inventoryKeys.has(fullKeyPath)) {
        issues.push({
          type: 'orphaned_classification',
          severity: 'warning',
          key: fullKeyPath,
          message: `Classified item "${fullKeyPath}" not found in current inventory`
        })
      }
    })

    return issues
  }

  /**
   * Check naming consistency for preferences
   */
  checkNamingConsistency(classification) {
    const issues = []

    traverseClassifications(classification.classifications, (item) => {
      if (item.status !== 'classified') return
      if (item.category !== 'preferences') return

      // Preferences should have dot-separated targetKey
      if (item.targetKey && !item.targetKey.includes('.')) {
        issues.push({
          type: 'naming_inconsistency',
          severity: 'warning',
          key: item.originalKey,
          message: `Preference targetKey "${item.targetKey}" should use dot-separated hierarchy (e.g., "ui.theme")`
        })
      }
    })

    return issues
  }

  /**
   * Check for duplicate target keys
   */
  checkDuplicateTargets(classification) {
    const issues = []
    const targetKeyMap = {}

    traverseClassifications(classification.classifications, (item, source, category, fullKey) => {
      if (item.status === 'classified-deleted') return

      const targetKey = item.targetKey || item.targetTable
      if (!targetKey) return

      const sourceKey = source === 'redux' ? `${source}.${category}.${fullKey}` : `${source}.${fullKey}`

      if (targetKeyMap[targetKey]) {
        issues.push({
          type: 'duplicate_target',
          severity: 'error',
          key: sourceKey,
          message: `Target key "${targetKey}" is used by both "${sourceKey}" and "${targetKeyMap[targetKey]}"`
        })
      } else {
        targetKeyMap[targetKey] = sourceKey
      }
    })

    return issues
  }

  /**
   * Generate validation report markdown file
   */
  generateReport(issues, classification) {
    const reportPath = path.join(this.dataDir, '../validation-report.md')
    const stats = calculateStats(classification.classifications)

    let report = `# Data Validation Report\n\n`
    report += `Generated: ${new Date().toISOString()}\n`
    report += `Issues found: ${issues.length}\n\n`

    if (issues.length === 0) {
      report += `## Validation Passed\n\nNo consistency issues found.\n\n`
    } else {
      const errors = issues.filter((i) => i.severity === 'error')
      const warnings = issues.filter((i) => i.severity === 'warning')

      if (errors.length > 0) {
        report += `## Errors (${errors.length})\n\n`
        for (const issue of errors) {
          report += `### ${issue.type}\n`
          report += `- **Item**: \`${issue.key}\`\n`
          report += `- **Issue**: ${issue.message}\n\n`
        }
      }

      if (warnings.length > 0) {
        report += `## Warnings (${warnings.length})\n\n`
        for (const issue of warnings) {
          report += `### ${issue.type}\n`
          report += `- **Item**: \`${issue.key}\`\n`
          report += `- **Issue**: ${issue.message}\n\n`
        }
      }
    }

    // Statistics section
    report += `## Classification Statistics\n\n`

    report += `### By Status\n\n`
    report += `- **Pending**: ${stats.byStatus.pending || 0}\n`
    report += `- **Classified**: ${stats.byStatus.classified || 0}\n`
    report += `- **Deleted**: ${stats.byStatus['classified-deleted'] || 0}\n\n`

    if (Object.keys(stats.byCategory).length > 0) {
      report += `### By Category\n\n`
      for (const [category, count] of Object.entries(stats.byCategory)) {
        report += `- **${category}**: ${count}\n`
      }
      report += `\n`
    }

    report += `### Total Items: ${stats.total}\n`

    fs.writeFileSync(reportPath, report, 'utf8')
    console.log(`Validation report saved: ${reportPath}`)
  }
}

// Run script
if (require.main === module) {
  const validator = new DataValidator()
  validator.validate()
}

module.exports = DataValidator
