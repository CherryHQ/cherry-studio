# Composer Rich Clipboard

This document describes the private clipboard format used to preserve composer
tokens when users copy and paste between Cherry Studio message surfaces and the
composer.

## Goals

- Preserve composer tokens across internal copy/paste for `skill`, `file`,
  `command`, `knowledge`, `reference`, `quote`, and `promptVariable` content.
- Keep regular clipboard behavior useful outside Cherry Studio through
  `text/plain` and `text/html`.
- Never expose unsanitized token JSON, parseable composer token metadata in
  `text/plain` / `text/html`, or local file paths in any clipboard payload.
- Preserve existing rich HTML copy, such as markdown table copy, when no composer
  token fragment is present.

## Clipboard Shape

Rich composer copies write three payloads:

| Format | Purpose |
| --- | --- |
| `text/plain` | Human-readable fallback text. |
| `text/html` | Human-readable HTML without parseable composer token metadata. |
| `web application/x-cherry-composer-fragment+json` | Private Cherry Studio token fragment. |

The private fragment is versioned JSON with ordered text/token segments. Token
payloads are sanitized before writing. File token payloads never carry a local
path or original path-derived id. A restorable file token carries only an
unguessable handle plus display fields; the corresponding file metadata stays in
the current renderer session's in-memory restoration context.

The restoration context has two parts: the file restoration handle registry and
the session cache. The session cache holds the fragment of the last rich copy
written through the async clipboard API, keyed by its plain text, so pasting
that copy restores tokens without reading the system clipboard.

## Flow

```mermaid
flowchart TD
  A["Copy selected composer content or message parts"] --> B["Project text and composer tokens"]
  B --> C["Write text/plain"]
  B --> D["Write safe text/html"]
  B --> E["Write private web custom format with handles when supported"]
  E --> E2["Record fragment in the session cache"]
  E --> F["Paste into ComposerSurface"]
  C --> F
  F --> G{"Private fragment in paste event data?"}
  G -->|Yes| H["Resolve supported tokens and file handles"]
  G -->|No| G2{"Pasted text matches the session cache?"}
  G2 -->|Yes| H
  G2 -->|No| I["Parse plain text markers or insert plain text"]
  H --> J["Update editor content"]
  H --> K["Merge restored FileMetadata into composer files"]
  I --> J
```

## Synchronous Paste

Paste handling is fully synchronous and never calls `navigator.clipboard.read()`.
Fragments written through the async clipboard API are not visible in paste event
`DataTransfer` data, so `writeComposerRichClipboardContent` records the written
fragment in the session cache and a paste whose plain text matches the last rich
copy (after line-ending normalization) restores from there. Alternatives were
rejected: reading the system clipboard on paste makes every external paste async
and reads unrelated clipboard data; writing through a synthetic copy event needs
the deprecated `execCommand`; fingerprinting `text/html` leaks an origin marker.
The accepted cost is that `quote` and `promptVariable` tokens from message
copies lose token identity after an app restart or in another Cherry Studio
instance; `skill` and `knowledge` tokens still restore through plain text
markers.

## Restore Rules

- `skill` and `knowledge` tokens are restored only through the current surface's
  resolver, so Chat and Agent keep their existing token ownership boundaries.
- `reference` tokens, plus any private token kind without a restore rule such as
  `command`, fall back to visible text.
- `file` tokens are restored only when the private payload has a handle that
  resolves in the current renderer session's restoration context. Restored files
  are deduplicated by `id:path`.
- File handles are not trusted clipboard data. They only locate restoration
  context already held in this renderer session; missing, unknown, expired,
  cross-window, post-restart, or forged handles fall back to visible text.
- A file token copied from a user message is restorable only when the message file
  part carries a file token source that exactly matches the text token source.
  Filename, display name, and token label are never used as fallback identity.
- Path-derived file token ids are never written to the clipboard. If the current
  renderer session has the original file metadata, the token may still be
  restored through a handle.
- `quote` and `promptVariable` tokens are restored from sanitized token fields.
- Unsupported, unsafe, or unresolved token segments fall back to their visible
  text.
- A fragment is restored only from the paste event's clipboard data or from the
  session cache; paste never reads the system clipboard.
- If the browser cannot write the private custom format, clipboard writing falls
  back to `text/html` plus `text/plain`, then to plain text when `ClipboardItem`
  is unavailable. Every such fallback clears the session cache.

## Boundaries

- `MessageListActions.copyRichContent` is the shared action surface for rich
  clipboard writes. Message components request the capability; page/window
  adapters provide it.
- `composerClipboard.ts` owns private fragment parsing, serialization, HTML
  escaping, the restoration context (file restoration handles and the session
  cache), and system clipboard write helpers.
- `ComposerSurface` owns editor copy/cut/paste event handling and delegates
  fragment parsing/projection to utilities. Cut performs the same rich copy and
  then deletes the selection, so cut tokens stay restorable instead of degrading
  to the default token-stripped clipboard HTML.
- Normal OS file paste and drag/drop are separate flows that use the browser or
  Electron file APIs. They do not restore files from private composer fragments.
- File restoration does not re-read the file or re-run supported-extension
  checks. Later send/file-processing paths remain responsible for file
  availability.
- File part `mediaType` inference is not part of this feature. Keep that change
  separate if MIME normalization is needed.

## Focused Verification

Use focused checks for this feature instead of full-suite runs during local
iteration:

```bash
pnpm vitest run src/renderer/components/chat/composer/__tests__/ComposerSurface.test.tsx src/renderer/utils/message/__tests__/composerClipboard.test.ts
pnpm vitest run src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx src/renderer/components/chat/messages/utils/__tests__/messageSelection.test.ts src/renderer/components/chat/messages/hooks/__tests__/useMessagePlatformActions.test.tsx src/renderer/components/chat/messages/hooks/__tests__/useMessageSelectionController.test.tsx
```
