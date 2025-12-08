#!/usr/bin/env tsx

import fs from 'fs'
import path from 'path'

// Read the models.json file
const modelsPath = path.join(__dirname, '../data/models.json')
const catalogData = JSON.parse(fs.readFileSync(modelsPath, 'utf8'))

console.log('Total models before filtering:', catalogData.models?.length || 0)

// Check if models array exists
if (!catalogData.models || !Array.isArray(catalogData.models)) {
  console.error('❌ No models array found in the file')
  process.exit(1)
}

// Filter out models ending with 'search'
const filteredModels = catalogData.models.filter((model: any) => {
  if (model.id && model.id.endsWith('search')) {
    console.log('Removing model:', model.id)
    return false
  }
  return true
})

console.log('Total models after filtering:', filteredModels.length)

// Update the data with filtered models
const updatedData = {
  ...catalogData,
  models: filteredModels
}

// Write the filtered data back to the file
fs.writeFileSync(modelsPath, JSON.stringify(updatedData, null, 2), 'utf8')

console.log('✅ Successfully removed models ending with "search"')