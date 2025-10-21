const fs = require('fs')
const path = require('path')

/**
 * Copies Claude Code templates from git submodule to resources directory
 * Source: external/claude-code-templates/cli-tool/components
 * Target: resources/data/components
 */

const SOURCE_DIR = path.join(__dirname, '../external/claude-code-templates/cli-tool/components')
const TARGET_DIR = path.join(__dirname, '../resources/data/components')

function copyDirectory(source, target) {
  // Create target directory if it doesn't exist
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
  }

  // Read all items in the source directory
  const items = fs.readdirSync(source, { withFileTypes: true })

  for (const item of items) {
    const sourcePath = path.join(source, item.name)
    const targetPath = path.join(target, item.name)

    if (item.isDirectory()) {
      // Recursively copy subdirectories
      copyDirectory(sourcePath, targetPath)
    } else {
      // Copy file
      fs.copyFileSync(sourcePath, targetPath)
      console.log(`Copied: ${item.name}`)
    }
  }
}

function main() {
  console.log('📦 Copying Claude Code templates...')
  console.log(`   Source: ${SOURCE_DIR}`)
  console.log(`   Target: ${TARGET_DIR}`)

  // Check if submodule exists
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('❌ Error: Git submodule not found!')
    console.error('   Please run: git submodule update --init --recursive')
    process.exit(1)
  }

  // Clean target directory if it exists
  if (fs.existsSync(TARGET_DIR)) {
    console.log('🧹 Cleaning existing templates...')
    fs.rmSync(TARGET_DIR, { recursive: true, force: true })
  }

  // Copy templates
  try {
    copyDirectory(SOURCE_DIR, TARGET_DIR)
    console.log('✅ Templates copied successfully!')
  } catch (error) {
    console.error('❌ Error copying templates:', error.message)
    process.exit(1)
  }
}

main()
