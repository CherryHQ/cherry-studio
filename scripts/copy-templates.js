const fs = require('fs')
const path = require('path')

const CLAUDE_COMPONENTS_SOURCE_DIR = path.join(
  __dirname,
  '../external/claude-code-templates/cli-tool/components'
)
const ANTHROPICS_SKILLS_SOURCE_DIR = path.join(
  __dirname,
  '../external/anthropics-skills'
)
const TARGET_DIR = path.join(__dirname, '../resources/data/claude-code-plugins')
const TARGET_SKILLS_DIR = path.join(TARGET_DIR, 'skills')
const SKIP_NAMES = new Set(['.git', 'node_modules'])

function copyDirectory(source, target, options = {}) {
  const { filter, onFileCopy } = options

  // Create target directory if it doesn't exist
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
  }

  // Read all items in the source directory
  const items = fs.readdirSync(source, { withFileTypes: true })

  for (const item of items) {
    if (filter && !filter(item)) {
      continue
    }

    const sourcePath = path.join(source, item.name)
    const targetPath = path.join(target, item.name)

    if (item.isDirectory()) {
      // Recursively copy subdirectories
      copyDirectory(sourcePath, targetPath, options)
    } else {
      if (onFileCopy) {
        onFileCopy(sourcePath, targetPath)
      }

      // Copy file
      fs.copyFileSync(sourcePath, targetPath)
      const relativePath = path.relative(TARGET_DIR, targetPath) || item.name
      console.log(`   Copied: ${relativePath}`)
    }
  }
}

function main() {
  console.log('📦 Copying Claude Code templates...')
  console.log(`   Source: ${CLAUDE_COMPONENTS_SOURCE_DIR}`)
  console.log(`   Target: ${TARGET_DIR}`)

  // Check if submodule exists
  if (!fs.existsSync(CLAUDE_COMPONENTS_SOURCE_DIR)) {
    console.error('❌ Error: Git submodule not found!')
    console.error('   Please run: git submodule update --init --recursive')
    process.exit(1)
  }

  if (!fs.existsSync(ANTHROPICS_SKILLS_SOURCE_DIR)) {
    console.error('❌ Error: Anthropics skills submodule not found!')
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
    copyDirectory(CLAUDE_COMPONENTS_SOURCE_DIR, TARGET_DIR, {
      filter: (item) => !SKIP_NAMES.has(item.name),
    })
    console.log('✅ Claude templates copied successfully!')
  } catch (error) {
    console.error('❌ Error copying templates:', error.message)
    process.exit(1)
  }

  console.log('🔁 Merging Anthropics skill examples...')
  try {
    copyDirectory(ANTHROPICS_SKILLS_SOURCE_DIR, TARGET_SKILLS_DIR, {
      filter: (item) => !SKIP_NAMES.has(item.name),
      onFileCopy: (_sourcePath, targetPath) => {
        if (fs.existsSync(targetPath)) {
          console.warn(`   ⚠️ Overwriting existing entry: ${path.relative(TARGET_DIR, targetPath)}`)
        }
      },
    })
    console.log('✅ Anthropics skills merged successfully!')
  } catch (error) {
    console.error('❌ Error copying Anthropics skills:', error.message)
    process.exit(1)
  }
}

main()
