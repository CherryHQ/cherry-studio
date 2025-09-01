import { codeLangExts, customTextExts } from '../packages/shared/config/constant'

console.log('Running sanity check for custom extensions...')

// Create a Set for efficient lookup of extensions from the linguist database.
const linguistExtsSet = new Set(codeLangExts)

const overlappingExtsByCategory = new Map<string, string[]>()
let totalOverlaps = 0

// Iterate over each category and its extensions in our custom map.
for (const [category, exts] of customTextExts.entries()) {
  const categoryOverlaps = exts.filter((ext) => linguistExtsSet.has(ext))

  if (categoryOverlaps.length > 0) {
    overlappingExtsByCategory.set(category, categoryOverlaps.sort())
    totalOverlaps += categoryOverlaps.length
  }
}

// Report the results.
if (totalOverlaps === 0) {
  console.log('\n✅ Check passed!')
  console.log('The `customTextExts` map contains no extensions that are already in `codeLangExts`.')
  console.log('\nCustom extensions checked:')
  for (const [category, exts] of customTextExts.entries()) {
    console.log(`  - Category '${category}' (${exts.length}):`)
    console.log(`    ${exts.sort().join(', ')}`)
  }
  console.log('\n')
} else {
  console.error('\n⚠️ Check failed: Overlapping extensions found!')
  console.error(
    'The following extensions in `customTextExts` are already present in `codeLangExts` (from languages.ts).'
  )
  console.error('Please remove them from `customTextExts` in `packages/shared/config/constant.ts` to avoid redundancy.')
  console.error(`\nFound ${totalOverlaps} overlapping extensions in ${overlappingExtsByCategory.size} categories:`)

  for (const [category, exts] of overlappingExtsByCategory.entries()) {
    console.error(`  - Category '${category}': ${exts.join(', ')}`)
  }

  console.error('\n')
  process.exit(1) // Exit with an error code for CI/CD purposes.
}
