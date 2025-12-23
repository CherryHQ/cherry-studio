# Merge Strategies Documentation

## Overview

The merge utilities provide smart merging capabilities for importing and updating model/provider data while preserving manually curated information.

## Merge Strategies

### 1. FILL_UNDEFINED (Default)

Only fills in `undefined` values in the existing data. Best for initial imports or filling missing data.

```typescript
import { mergeModelsList, MergeStrategies } from './src/utils/merge-utils'

const merged = mergeModelsList(
  existingModels,
  incomingModels,
  MergeStrategies.FILL_UNDEFINED
)
```

**Example:**
```typescript
// Existing model
{
  id: 'gpt-4',
  description: 'Manually curated description',
  output_modalities: undefined,
  pricing: { input: 30, output: 60 }
}

// Incoming model
{
  id: 'gpt-4',
  description: 'Auto-generated description',
  output_modalities: ['TEXT'],
  pricing: { input: 30, output: 60 }
}

// Result
{
  id: 'gpt-4',
  description: 'Manually curated description',  // Preserved (not undefined)
  output_modalities: ['TEXT'],                  // Filled (was undefined)
  pricing: { input: 30, output: 60 }            // Preserved
}
```

### 2. UPDATE_DYNAMIC

Updates dynamic fields (pricing, metadata) while preserving manually curated content.

```typescript
const merged = mergeModelsList(
  existingModels,
  incomingModels,
  MergeStrategies.UPDATE_DYNAMIC
)
```

**Example:**
```typescript
// Existing model
{
  id: 'claude-3',
  description: 'Custom description',
  capabilities: ['FUNCTION_CALL'],
  pricing: { input: 3, output: 15 }
}

// Incoming model
{
  id: 'claude-3',
  description: 'New description',
  capabilities: ['FUNCTION_CALL', 'REASONING'],
  pricing: { input: 3, output: 15 }
}

// Result
{
  id: 'claude-3',
  description: 'Custom description',           // Preserved (neverOverwrite)
  capabilities: ['FUNCTION_CALL'],             // Preserved (neverOverwrite)
  pricing: { input: 3, output: 15 }            // Updated (alwaysOverwrite)
}
```

### 3. FULL_REPLACE

Completely replaces all existing data with incoming data.

```typescript
const merged = mergeModelsList(
  existingModels,
  incomingModels,
  MergeStrategies.FULL_REPLACE
)
```

**Use case:** Complete re-import from authoritative source.

### 4. PRESERVE_MANUAL

Preserves all manually edited fields, only updates system-maintained fields.

```typescript
const merged = mergeModelsList(
  existingModels,
  incomingModels,
  MergeStrategies.PRESERVE_MANUAL
)
```

**Example:**
```typescript
// Existing model (manually edited)
{
  id: 'gemini-pro',
  description: 'Carefully curated description',
  capabilities: ['FUNCTION_CALL', 'REASONING'],
  pricing: { input: 0.5, output: 1.5 },
  context_window: 128000
}

// Incoming model (new pricing)
{
  id: 'gemini-pro',
  description: 'Auto description',
  capabilities: ['FUNCTION_CALL'],
  pricing: { input: 0.125, output: 0.375 },
  context_window: 2000000
}

// Result
{
  id: 'gemini-pro',
  description: 'Carefully curated description',  // Preserved
  capabilities: ['FUNCTION_CALL', 'REASONING'],  // Preserved
  pricing: { input: 0.125, output: 0.375 },      // Updated (alwaysOverwrite)
  context_window: 2000000                        // Updated (alwaysOverwrite)
}
```

## Custom Merge Options

Create your own merge strategy:

```typescript
import { mergeModelsList, type MergeOptions } from './src/utils/merge-utils'

const customStrategy: MergeOptions = {
  preserveExisting: true,
  alwaysOverwrite: ['pricing', 'metadata'],
  neverOverwrite: ['description', 'capabilities']
}

const merged = mergeModelsList(
  existingModels,
  incomingModels,
  customStrategy
)
```

## Usage in Scripts

### Import Script Example

```typescript
#!/usr/bin/env tsx

import * as fs from 'fs'
import { mergeModelsList, MergeStrategies } from '../src/utils/merge-utils'

async function importModels() {
  // Fetch new models
  const newModels = await fetchFromAPI()

  // Load existing models
  const existingData = JSON.parse(fs.readFileSync('data/models.json', 'utf-8'))

  // Merge with FILL_UNDEFINED strategy
  const merged = mergeModelsList(
    existingData.models,
    newModels,
    MergeStrategies.FILL_UNDEFINED
  )

  // Save
  existingData.models = merged
  fs.writeFileSync('data/models.json', JSON.stringify(existingData, null, 2))

  console.log('✓ Import complete with smart merge')
}
```

## API Reference

### `mergeObjects<T>(existing, incoming, options)`

Deep merge two objects with configurable strategy.

**Parameters:**
- `existing: T` - Existing object
- `incoming: Partial<T>` - New object to merge
- `options: MergeOptions` - Merge configuration

**Returns:** `T` - Merged object

### `mergeModelsList(existingModels, incomingModels, options)`

Merge model arrays by ID.

**Parameters:**
- `existingModels: ModelConfig[]` - Current models
- `incomingModels: ModelConfig[]` - New models
- `options: MergeOptions` - Merge strategy

**Returns:** `ModelConfig[]` - Merged models array

### `mergeProvidersList(existingProviders, incomingProviders, options)`

Merge provider arrays by ID.

**Parameters:**
- `existingProviders: ProviderConfig[]` - Current providers
- `incomingProviders: ProviderConfig[]` - New providers
- `options: MergeOptions` - Merge strategy

**Returns:** `ProviderConfig[]` - Merged providers array

## Best Practices

1. **Use FILL_UNDEFINED for first import** - Safest option for initial data population
2. **Use UPDATE_DYNAMIC for regular updates** - Keeps pricing fresh while preserving curation
3. **Use PRESERVE_MANUAL after manual edits** - Protects your work while updating system fields
4. **Test merge before commit** - Preview changes before overwriting production data
5. **Document custom strategies** - Add comments explaining why specific fields are preserved

## Migration Guide

### From Simple Replace

**Before:**
```typescript
data.models = newModels  // Loses all existing data!
```

**After:**
```typescript
data.models = mergeModelsList(data.models, newModels, MergeStrategies.FILL_UNDEFINED)
```

### From Manual Merge Logic

**Before:**
```typescript
for (const newModel of newModels) {
  const existing = data.models.find(m => m.id === newModel.id)
  if (existing && existing.description) {
    newModel.description = existing.description
  }
  // ... lots of manual field checking
}
```

**After:**
```typescript
data.models = mergeModelsList(data.models, newModels, {
  preserveExisting: true,
  neverOverwrite: ['description']
})
```
