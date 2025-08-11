# How to Do i18n Gracefully

> [!WARNING]
> This document is machine translated from Chinese. While we strive for accuracy, there may be some imperfections in the translation.

## Enhance Development Experience with the i18n Ally Plugin

i18n Ally is a powerful VSCode extension that provides real-time feedback during development, helping developers detect missing or incorrect translations earlier.

The plugin has already been configured in the project — simply install it to get started.

### Advantages During Development

- **Real-time Preview**: Translated texts are displayed directly in the editor.
- **Error Detection**: Automatically tracks and highlights missing translations or unused keys.
- **Quick Navigation**: Jump to key definitions with Ctrl/Cmd + click.
- **Auto-completion**: Provides suggestions when typing i18n keys.

### Demo

![demo-1](./.assets.how-to-i18n/demo-1.png)

![demo-2](./.assets.how-to-i18n/demo-2.png)

![demo-3](./.assets.how-to-i18n/demo-3.png)

## i18n Conventions

### **Avoid Flat Structure at All Costs**

Never use flat structures like `"add.button.tip": "Add"`. Instead, adopt a clear nested structure:

```json
// Wrong - Flat structure
{
  "add.button.tip": "Add",
  "delete.button.tip": "Delete"
}

// Correct - Nested structure
{
  "add": {
    "button": {
      "tip": "Add"
    }
  },
  "delete": {
    "button": {
      "tip": "Delete"
    }
  }
}
```

#### Why Use Nested Structure?

1. **Natural Grouping**: Related texts are logically grouped by their context through object nesting.
2. **Plugin Requirement**: Tools like i18n Ally require either flat or nested format to properly analyze translation files.

### **Avoid Template Strings in `t()`**

**We strongly advise against using template strings for dynamic interpolation.** While convenient in general JavaScript development, they cause several issues in i18n scenarios.

#### 1. **Plugin Cannot Track Dynamic Keys**

Tools like i18n Ally cannot parse dynamic content within template strings, resulting in:

- No real-time preview
- No detection of missing translations
- No navigation to key definitions

```javascript
// Not recommended - Plugin cannot resolve
const message = t(`fruits.${fruit}`)
```

#### 2. **No Real-time Rendering in Editor**

Template strings appear as raw code instead of the final translated text in IDEs, degrading the development experience.

#### 3. **Harder to Maintain**

Since the plugin cannot track such usages, developers must manually verify the existence of corresponding keys in language files.

### Recommended Approach

To avoid missing keys, all dynamically translated texts should first maintain a `FooKeyMap`, then retrieve the translation text through a function.

For example:

```ts
// src/renderer/src/i18n/label.ts
const themeModeKeyMap = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
} as const

export const getThemeModeLabel = (key: string): string => {
  return themeModeKeyMap[key] ? t(themeModeKeyMap[key]) : key
}
```

By avoiding template strings, you gain better developer experience, more reliable translation checks, and a more maintainable codebase.

## Automation Scripts

The project includes several scripts to automate i18n-related tasks:

### `check:i18n` - Validate i18n Structure

This script checks:

- Whether all language files use nested structure
- For missing or unused keys
- Whether keys are properly sorted

```bash
yarn check:i18n
```

### `sync:i18n` - Synchronize JSON Structure and Sort Order

This script uses `zh-cn.json` as the source of truth to sync structure across all language files, including:

1. Adding missing keys, with placeholder `[to be translated]`
2. Removing obsolete keys
3. Sorting keys automatically

```bash
yarn sync:i18n
```

### `auto:i18n` - Automatically Translate Pending Texts

This script fills in texts marked as `[to be translated]` using machine translation.

Typically, after adding new texts in `zh-cn.json`, run `sync:i18n`, then `auto:i18n` to complete translations.

Before using this script, set the required environment variables:

```bash
API_KEY="sk-xxx"
BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1/"
MODEL="qwen-plus-latest"
```

Alternatively, add these variables directly to your `.env` file.

```bash
yarn auto:i18n
```

### `update:i18n` - Object-level Translation Update

Updates translations in language files under `src/renderer/src/i18n/translate` at the object level, preserving existing translations and only updating new content.

**Not recommended** — prefer `auto:i18n` for translation tasks.

```bash
yarn update:i18n
```

### Workflow

1. During development, first add the required text in `zh-cn.json`
2. Confirm it displays correctly in the Chinese environment
3. Run `yarn sync:i18n` to propagate the keys to other language files
4. Run `yarn auto:i18n` to perform machine translation
5. Grab a coffee and let the magic happen!

## Best Practices

1. **Use Chinese as Source Language**: All development starts in Chinese, then translates to other languages.
2. **Run Check Script Before Commit**: Use `yarn check:i18n` to catch i18n issues early.
3. **Translate in Small Increments**: Avoid accumulating a large backlog of untranslated content.
4. **Keep Keys Semantically Clear**: Keys should clearly express their purpose, e.g., `user.profile.avatar.upload.error`
