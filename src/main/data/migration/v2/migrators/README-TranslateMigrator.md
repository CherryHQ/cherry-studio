# TranslateMigrator

The `TranslateMigrator` handles migration of translate history and custom languages from Dexie/IndexedDB to SQLite.

## Data Sources

| Data | Source | File/Path |
|------|--------|-----------|
| Translate history records | Dexie `translate_history` table | `translate_history.json` |
| Custom translate languages | Dexie `translate_languages` table | `translate_languages.json` |

## Translate History

### Data Quality Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| Missing required fields | `!id`, `!sourceText`, `!targetText`, `!sourceLanguage`, `!targetLanguage` | Skip record, increment skippedCount, log warning |
| Invalid/missing createdAt | `new Date(value).getTime()` returns NaN or falsy | Fallback to `Date.now()` |
| Missing star field | `old.star` is undefined | Default to `false` |
| Missing updatedAt | Not present in old data | Set to same value as createdAt |

### Field Mappings

| Source (Dexie) | Target (translateHistoryTable) | Notes |
|----------------|-------------------------------|-------|
| `id` | `id` | Direct copy |
| `sourceText` | `sourceText` | Direct copy |
| `targetText` | `targetText` | Direct copy |
| `sourceLanguage` | `sourceLanguage` | Direct copy |
| `targetLanguage` | `targetLanguage` | Direct copy |
| `star` | `star` | Default `false` if missing |
| `createdAt` | `createdAt` | ISO string → integer timestamp, fallback `Date.now()` |
| (none) | `updatedAt` | Generated, same value as createdAt |

**Dropped fields**: None

## Translate Languages

### Data Quality Handling

| Issue | Detection | Handling |
|-------|-----------|----------|
| Missing required fields | `!id`, `!langCode`, `!value`, `!emoji` | Skip record, increment skippedCount, log warning |

### Field Mappings

| Source (Dexie) | Target (translateLanguageTable) | Notes |
|----------------|--------------------------------|-------|
| `id` | `id` | Direct copy |
| `langCode` | `langCode` | Direct copy, unique constraint |
| `value` | `value` | Direct copy |
| `emoji` | `emoji` | Direct copy |
| (none) | `createdAt` | Generated as `Date.now()`, consistent across batch |
| (none) | `updatedAt` | Generated as `Date.now()`, consistent across batch |

**Dropped fields**: None

## Implementation Files

- `TranslateMigrator.ts` - Single migrator class handling both tables with prepare/execute/validate phases

## Code Quality

All implementation code includes detailed comments:
- File-level comments: Describe purpose, data sources, and transformations
- Function-level comments: Purpose and transformation logic
- Validation comments: Skip conditions and fallback behavior
