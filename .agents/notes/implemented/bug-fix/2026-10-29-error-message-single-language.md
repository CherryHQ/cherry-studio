# Agent Note: Show error text in one language

Status: implemented

English | [中文](2026-10-29-error-message-single-language.zh.md)

## Problem

Error toasts, inline alerts, fallback pages, and copy with an interpolated cause joined a translated summary to the raw cause, for example `添加失败: Request failed with status code 500`. Under a non-English UI the result mixed two languages. Some sites showed only the raw English cause while a translated message existed, and some translations had no Traditional Chinese text.

## Decision

`formatErrorMessageWithPrefix` and `localizedErrorDetail` in `src/renderer/utils/error.ts` append a cause only when it reads in the UI language; otherwise the user sees the translated summary alone. `readsInLanguage` in `src/shared/utils/languageScript.ts` decides by script: Chinese, Japanese, Russian, Greek, and Thai need their own script, English accepts Latin text, and other Latin-script languages cannot be told apart from English, so they hide the cause. `LocalizedError` marks a renderer error whose message is already translated, and it is always shown.

Call sites that showed `err.message`, `formatErrorMessage(err)`, `t(key) + cause`, or `` `${t(key)}: ${cause}` `` use the helper. Generic prefixes such as `common.error` and raw-only sites gained specific copy. Keys that interpolated a cause (`{{message}}`, `{{error}}`, `{{reason}}`, `{{details}}`) no longer do; main-process copy uses `readsInLanguage` before it adds a CLI or provider diagnostic. Error detail basic information shows the translated summary without `(raw)`. Fallback pages and unknown-category toasts keep raw text behind a collapsed details control. Technical details, copy actions, and logs still carry the raw cause.

## Alternatives considered

- Hide every cause: rejected because translated main-process messages, such as PDF page limits, would disappear.
- Mark every translated error with a type: rejected because main-process errors cross IPC as plain `Error` and `IpcError` messages; the script check covers them without a wire change.
- Translate raw provider and system messages: rejected because they are not under the application's control.

## Consequences

Under German, French, and other Latin-script UIs, a translated main-process cause without `LocalizedError` is hidden; the summary still names the failed action. A cause that mixes the UI script with English, such as a Chinese sentence carrying an English path, passes the script check. Removing an interpolated cause changed existing values in every locale; the changes are deletions or punctuation edits, and the new keys carry translations for all 15 locales.

## Verification

- Regression — `src/renderer/utils/__tests__/error.test.ts`: a Chinese UI hides an English cause and keeps a Chinese one, English hides a Chinese cause, German hides an indistinguishable cause, `LocalizedError` is always shown, and stored strings follow the same rule.
- Regression — `src/shared/utils/__tests__/languageScript.test.ts`: script detection for Chinese, Japanese, Russian, English, and German.
- Regression — `vitest related` over the changed sources, plus `i18n-check` across all renderer and main catalogs.
