---
description: i18n workflow covering locale catalogs, the en-us source of truth, automation scripts, and translation practices
sources:
  - src/renderer/i18n
  - src/main/i18n/locales
  - scripts/i18n-sync.ts
  - scripts/i18n-glossary.json
---

# Internationalization (i18n) Guide

## Enhance Development Experience with the i18n Ally Plugin

i18n Ally is a powerful VSCode extension that provides real-time feedback during development, helping developers detect missing or incorrect translations earlier.

The plugin has already been configured in the project — simply install it to get started.

### Advantages During Development

- **Real-time Preview**: Translated texts are displayed directly in the editor.
- **Error Detection**: Automatically tracks and highlights missing translations or unused keys.
- **Quick Navigation**: Jump to key definitions with Ctrl/Cmd + click.
- **Auto-completion**: Provides suggestions when typing i18n keys.

### Demo

![demo-1](../../assets/images/i18n/demo-1.png)

![demo-2](../../assets/images/i18n/demo-2.png)

![demo-3](../../assets/images/i18n/demo-3.png)

## i18n Conventions

### Use Nested Keys

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

```ts
// Not recommended - Plugin cannot resolve
const message = t(`fruits.${fruit}`)
```

#### 2. **No Real-time Rendering in Editor**

Template strings appear as raw code instead of the final translated text in IDEs, degrading the development experience.

#### 3. **Harder to Maintain**

Since the plugin cannot track such usages, developers must manually verify the existence of corresponding keys in language files.

### Recommended Approach

For a finite dynamic set, keep an explicit value-to-key map and pass the selected static key to `t()`. This keeps every catalog key discoverable by the editor and unused-key scanner.

For example:

```ts
// src/renderer/i18n/label.ts
const themeModeKeyMap = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system'
} as const

export const getThemeModeLabelKey = (mode: keyof typeof themeModeKeyMap) => themeModeKeyMap[mode]

const label = t(getThemeModeLabelKey(themeMode))
```

By avoiding template strings, you gain better developer experience, more reliable translation checks, and a more maintainable codebase.

## Catalogs and Source Locale

Renderer and main-process translations are independent catalogs:

- `src/renderer/i18n/locales/`
- `src/main/i18n/locales/`

Both catalogs use `en-us.json` as the source of truth by default. Set `TRANSLATION_BASE_LOCALE` only when intentionally validating a different base. Add new keys and the canonical English text to `en-us.json`; add an accurate `zh-cn` value as semantic context for translators.

## Automation Scripts

| Command | Purpose | Modifies files |
|---|---|---|
| `pnpm i18n:sync` | Synchronize every locale with the base locale and sort keys | Yes |
| `pnpm i18n:check` | Check catalog structure, key alignment, sorting, main-process key coverage, and translated values | No |
| `pnpm i18n:unused` | Report renderer keys that are not referenced by source code | No |
| `pnpm i18n:remove-unused` | Remove selected unused renderer keys from every renderer locale | Yes |
| `pnpm i18n:hardcoded` | Report likely hardcoded user-visible strings | No |
| `pnpm i18n:hardcoded:strict` | Run the hardcoded-string check in CI mode | No |

`i18n:extract` and `i18n:lint` are not part of the canonical workflow. Do not use them to rewrite catalogs unless their extraction scope has been reviewed for the current change.

### Synchronize and Check Catalog Structure

`i18n:sync` uses `en-us.json` as the default source of truth for both catalogs. It:

1. Adds missing keys with a `[to be translated]` placeholder
2. Removes obsolete keys
3. Sorts keys automatically

```bash
pnpm i18n:sync
pnpm i18n:check
```

### `i18n:unused` - Find Unused Keys

This script scans renderer source code and reports keys that are present in the renderer catalog but not found in source code. It does not scan or modify the main-process catalog.

This command only prints a report and does not modify any files:

```bash
pnpm i18n:unused
```

The report includes:

- Total unused key count
- Unused key count by top-level namespace
- A few example keys from each namespace

For machine-readable output, use JSON mode:

```bash
pnpm i18n:unused --json
```

#### Cleaning Unused Keys

Use `i18n:remove-unused` when you want to delete unused keys. Cleaning is opt-in and only runs through this remove command.

Run interactive cleanup:

```bash
pnpm i18n:remove-unused
```

The prompt lists top-level namespaces, such as `common`, `settings`, or `translate`. Select one or more namespaces to delete only the unused leaf keys in those groups.

Run non-interactive cleanup for specific namespaces:

```bash
pnpm i18n:remove-unused --groups common,settings
```

Run non-interactive cleanup for all unused keys:

```bash
pnpm i18n:remove-unused --all
```

Cleanup updates every file in `src/renderer/i18n/locales/`.

After deletion, the script prunes empty objects and sorts keys to keep the files consistent with the existing i18n format.

#### What Counts as Used

The scanner recognizes common static i18n patterns:

- `t("key")` and `i18n.t("key")`
- `<Trans i18nKey="key" />`
- Key fields such as `titleKey`, `labelKey`, `descriptionKey`, `messageKey`, and `i18nKey`
- Known label maps in `src/renderer/i18n/label.ts`
- Comment references like `t("key")`, which keeps i18n Ally-style explicit references valid
- Shortcut labels derived from `SHORTCUT_DEFINITIONS`
- Conditional translation calls such as `t(condition ? "a.key" : "b.key")`
- Static template-expression namespaces when they can be conservatively matched
- Exact full-key text matches anywhere in scanned source files

The exact text match is intentionally conservative: if a complete key string appears in source code, the key is treated as used. This may keep a few truly unused keys, but it avoids deleting keys that are referenced through helper maps, indirect calls, or dynamic code paths.

#### Safe Cleanup Workflow

1. Run `pnpm i18n:unused` and review the grouped report.
2. If a key looks suspicious, search for the exact key in source code before cleaning.
3. Clean only a small namespace at a time with `pnpm i18n:remove-unused --groups <namespace>`, or use `pnpm i18n:remove-unused --all` when the full report has already been reviewed.
4. Review the JSON diff.
5. Run `pnpm i18n:check` after cleanup.

### Translation Completion in Pull Requests

Every pull request that changes i18n source text must include all synchronized and translated locale files. Translation does not run in pull request CI, on a daily schedule, or during release preparation.

Use this workflow:

1. Add the key with canonical English text to `en-us.json` and an accurate Chinese reference to `zh-cn.json` in the relevant catalog.
2. Confirm the new text works in the English and Chinese environments.
3. Run `pnpm i18n:sync` to scaffold the key in every other locale.
4. Translate every `[to be translated]` value in both catalogs manually or with a translation tool available to you.
5. Review the locale diff, then run `pnpm i18n:check`.

If you use Claude Code, the following prompt can help:

```text
Complete the i18n translations introduced by this change.

- Treat en-us.json as the source of truth and zh-cn.json as a semantic reference.
- Inspect the git diff to identify new or changed keys.
- Update every non-base locale in src/renderer/i18n/locales and src/main/i18n/locales.
- Follow the wording and formality of nearby strings in each target locale.
- Follow scripts/i18n-glossary.json and keep protected product and protocol names unchanged.
- Preserve every {{interpolation}}, <component> tag, $t() reference, punctuation token, and key structure exactly.
- Do not add explanations or bracketed translator notes to locale values.
- Run pnpm i18n:sync before translating, then run pnpm i18n:check.
```

Pull request CI runs `i18n:sync` and fails when it produces an uncommitted diff. It then runs the read-only check:

```bash
pnpm i18n:check
```

The check rejects remaining placeholders, empty translations, missing interpolation variables, changed `<Trans>` component tags, changed `$t()` references, bracketed model notes, implausibly long explanations, and dropped protected terms. CI also runs the strict hardcoded-string check.

These deterministic checks cannot identify which translation method was used or determine whether a fluent translation preserves the intended meaning. Review semantic quality in the originating pull request.

Terminology lives in [`scripts/i18n-glossary.json`](../../../scripts/i18n-glossary.json) and is maintained by hand:

- `doNotTranslate` — product and protocol names that must survive verbatim. Enforced by `i18n:check`.
- `terms` — preferred translation per locale, plus a `note` disambiguating the English (for example `Agent` vs `Assistant`). Supplied to the model as guidance; not enforced, because most languages inflect these words.

Add an entry whenever a term is being translated inconsistently or the English is ambiguous out of context.

## Best Practices

1. **Use English as the Source Language**: Keep the canonical source text in `en-us.json` and provide `zh-cn` as translation context.
2. **Run Checks Before Commit**: Use `pnpm i18n:check` to catch i18n issues early.
3. **Translate in Small Increments**: Avoid accumulating a large backlog of untranslated content.
4. **Keep Keys Semantically Clear**: Keys should clearly express their purpose, e.g., `user.profile.avatar.upload.error`
