#!/usr/bin/env node

/**
 * Generated Code Quality Validator
 *
 * Validates the quality and correctness of auto-generated code files.
 * Checks generated preferences schema and migration mapping files.
 *
 * Validates:
 * - preferenceSchemas.ts - Interface definitions and default values
 * - PreferencesMappings.ts - Source to target key mappings
 *
 * Usage:
 *   node v2-refactor-temp/tools/data-classify/scripts/validate-generation.js
 */

const fs = require('fs')
const path = require('path')

class GenerationValidator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../../../')

    // Updated paths to match actual project structure
    this.preferencesFile = path.join(this.projectRoot, 'packages/shared/data/preference/preferenceSchemas.ts')
    this.mappingsFile = path.join(
      this.projectRoot,
      'src/main/data/migration/v2/migrators/mappings/PreferencesMappings.ts'
    )

    this.results = {
      preferences: { valid: false, errors: [], warnings: [] },
      mappings: { valid: false, errors: [], warnings: [] }
    }
  }

  /**
   * Main validation entry point
   */
  validate() {
    console.log('Validating generated code quality...\n')

    this.validatePreferencesFile()
    this.validateMappingsFile()
    this.printSummary()

    return this.results
  }

  /**
   * Validate preferenceSchemas.ts file
   */
  validatePreferencesFile() {
    console.log('Validating preferenceSchemas.ts...')

    if (!fs.existsSync(this.preferencesFile)) {
      this.results.preferences.errors.push(`File not found: ${this.preferencesFile}`)
      return
    }

    try {
      const content = fs.readFileSync(this.preferencesFile, 'utf8')

      // Check for auto-generation marker
      if (!content.includes('AUTO-GENERATED CONTENT START')) {
        this.results.preferences.errors.push('Missing auto-generated content marker')
      }

      // Check for interface definition (updated name)
      if (!content.includes('export interface PreferenceSchemas')) {
        this.results.preferences.errors.push('Missing PreferenceSchemas interface definition')
      }

      // Check for ESLint configuration
      if (!content.includes('/* eslint')) {
        this.results.preferences.warnings.push('Missing ESLint configuration comment')
      }

      // Check for imports
      if (!content.includes("from '@shared/data/preference/preferenceTypes'")) {
        this.results.preferences.warnings.push('Missing preferenceTypes import')
      }

      // Count preference keys
      const keyMatches = content.match(/'[\w.]+'/g)
      if (keyMatches) {
        const keyCount = keyMatches.length
        console.log(`  Found ${keyCount} preference keys`)

        if (keyCount < 50) {
          this.results.preferences.warnings.push(`Low preference key count: ${keyCount} (expected 100+)`)
        }
      } else {
        this.results.preferences.warnings.push('Could not parse preference key count')
      }

      // Check key naming convention
      const invalidKeys = []
      const keyPattern = /^\s*'([^']+)':/gm
      let match
      while ((match = keyPattern.exec(content)) !== null) {
        const key = match[1]
        // Keys should be dot-separated lowercase
        if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(key)) {
          invalidKeys.push(key)
        }
      }

      if (invalidKeys.length > 0 && invalidKeys.length <= 5) {
        this.results.preferences.warnings.push(
          `Found ${invalidKeys.length} keys not matching naming convention: ${invalidKeys.slice(0, 3).join(', ')}...`
        )
      } else if (invalidKeys.length > 5) {
        this.results.preferences.warnings.push(`Found ${invalidKeys.length} keys not matching naming convention`)
      }

      if (this.results.preferences.errors.length === 0) {
        this.results.preferences.valid = true
        console.log('  preferenceSchemas.ts validation passed')
      }
    } catch (error) {
      this.results.preferences.errors.push(`Failed to read file: ${error.message}`)
    }
  }

  /**
   * Validate PreferencesMappings.ts file
   */
  validateMappingsFile() {
    console.log('\nValidating PreferencesMappings.ts...')

    if (!fs.existsSync(this.mappingsFile)) {
      this.results.mappings.errors.push(`File not found: ${this.mappingsFile}`)
      return
    }

    try {
      const content = fs.readFileSync(this.mappingsFile, 'utf8')

      // Check for auto-generation marker
      if (!content.includes('AUTO-GENERATED CONTENT')) {
        this.results.mappings.warnings.push('Missing auto-generated content marker')
      }

      // Check for ELECTRON_STORE_MAPPINGS export
      if (!content.includes('export const ELECTRON_STORE_MAPPINGS')) {
        this.results.mappings.errors.push('Missing ELECTRON_STORE_MAPPINGS export')
      }

      // Check for REDUX_STORE_MAPPINGS export
      if (!content.includes('export const REDUX_STORE_MAPPINGS')) {
        this.results.mappings.errors.push('Missing REDUX_STORE_MAPPINGS export')
      }

      // Check for as const assertion for type safety
      if (!content.includes('as const')) {
        this.results.mappings.warnings.push('Missing "as const" assertion for type safety')
      }

      // Count mapping entries
      const originalKeyMatches = content.match(/originalKey:/g)
      if (originalKeyMatches) {
        const mappingCount = originalKeyMatches.length
        console.log(`  Found ${mappingCount} mapping entries`)

        if (mappingCount < 10) {
          this.results.mappings.warnings.push(`Low mapping count: ${mappingCount} (expected 50+)`)
        }
      }

      // Check for valid mapping structure
      const mappingPattern = /\{\s*originalKey:\s*'[^']+',\s*targetKey:\s*'[^']+'\s*\}/g
      const validMappings = content.match(mappingPattern)
      if (!validMappings || validMappings.length === 0) {
        this.results.mappings.warnings.push('Could not find valid mapping structures')
      }

      if (this.results.mappings.errors.length === 0) {
        this.results.mappings.valid = true
        console.log('  PreferencesMappings.ts validation passed')
      }
    } catch (error) {
      this.results.mappings.errors.push(`Failed to read file: ${error.message}`)
    }
  }

  /**
   * Print validation summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(50))
    console.log('Validation Summary')
    console.log('='.repeat(50))

    // Preferences results
    console.log(`\npreferenceSchemas.ts: ${this.results.preferences.valid ? 'PASSED' : 'FAILED'}`)
    for (const error of this.results.preferences.errors) {
      console.log(`  ERROR: ${error}`)
    }
    for (const warning of this.results.preferences.warnings) {
      console.log(`  WARNING: ${warning}`)
    }

    // Mappings results
    console.log(`\nPreferencesMappings.ts: ${this.results.mappings.valid ? 'PASSED' : 'FAILED'}`)
    for (const error of this.results.mappings.errors) {
      console.log(`  ERROR: ${error}`)
    }
    for (const warning of this.results.mappings.warnings) {
      console.log(`  WARNING: ${warning}`)
    }

    // Overall result
    const overallValid = this.results.preferences.valid && this.results.mappings.valid
    const totalErrors = this.results.preferences.errors.length + this.results.mappings.errors.length
    const totalWarnings = this.results.preferences.warnings.length + this.results.mappings.warnings.length

    console.log('\n' + '='.repeat(50))
    console.log(`Overall: ${overallValid ? 'PASSED' : 'FAILED'}`)
    console.log(`Errors: ${totalErrors}, Warnings: ${totalWarnings}`)

    if (overallValid) {
      console.log('\nGenerated code quality is acceptable!')
    } else {
      console.log('\nPlease fix the errors and regenerate the code.')
    }
  }
}

// Run script
if (require.main === module) {
  const validator = new GenerationValidator()
  const results = validator.validate()

  const hasErrors = results.preferences.errors.length > 0 || results.mappings.errors.length > 0
  process.exit(hasErrors ? 1 : 0)
}

module.exports = GenerationValidator
