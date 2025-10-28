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

### `i18n:check` - Validate i18n Structure

This script checks:

- Whether all language files use nested structure
- For missing or unused keys
- Whether keys are properly sorted

```bash
yarn i18n:check
```

### `i18n:sync` - Synchronize JSON Structure and Sort Order

By default, this script uses `en-us.json` as the source of truth to sync structure across all language files, including:

1. Adding missing keys, with placeholder `[to be translated]`
2. Removing obsolete keys
3. Sorting keys automatically

You can override this behavior by setting the `BASE_LOCALE` environment variable.

```bash
yarn i18n:sync
```

### `i18n:auto` - Automatically Translate Pending Texts

This script automatically translates texts marked as `[to be translated]` using machine translation. Similar to `i18n:sync`, it defaults to using `en-us.json` as the base, but you can override this behavior by setting the `BASE_LOCALE` environment variable.

Typically, after adding required texts to `en-us.json`, running `i18n:sync && i18n:auto` will automatically complete the translations.

Before using this script, you need to configure environment variables, for example:

```bash
API_KEY="sk-xxx"
BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1/"
MODEL="qwen-plus-latest"
```

You can also add environment variables by directly editing the `.env` file.

```bash
yarn i18n:auto
```

### Workflow

1. During development, first add the required text in `en-us.json`. You can use the quick fix functionality provided by the i18n-ally plugin to easily accomplish this.
2. Confirm the text displays correctly in the UI
3. Use `yarn i18n:sync` to sync the text to other language files
4. Use `yarn i18n:auto` to perform automatic translation
5. Grab a coffee and wait for the translation to complete!

## Best Practices

1. **Use English as Source Language**: All development starts in English, then translates to other languages.
2. **Run Check Script Before Commit**: Use `yarn i18n:check` to catch i18n issues early.
3. **Translate in Small Increments**: Avoid accumulating a large backlog of untranslated content.
4. **Keep Keys Semantically Clear**: Keys should clearly express their purpose, e.g., `user.profile.avatar.upload.error`
