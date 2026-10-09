# File preview

Portable React DOM previews for PDF, DOCX, PPTX, XLSX and images (including SVG).
The package owns rendering, controls, structural selections, workers and translations.
Hosts own file access, permissions, navigation, external opening and logging.
HTML, Markdown and source-code previews remain in the desktop application.

This workspace package remains private until publication is configured. Its packed
artifact can be installed independently of the Cherry Studio workspace.

```tsx
import type { PreviewSource } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'
import '@cherrystudio/file-preview/styles.css'

function FilePanel({ source }: { source: PreviewSource }) {
  return <Preview source={source} locale="zh-cn" />
}
```

Give the parent a defined height. Each source opens an independent `PreviewDocument`.
The preview closes it after failure, replacement, refresh or unmount, including a late
open that completes after cancellation. A document's size and revision stay fixed;
its reader must reject version changes, short reads and reads after close. Close must
be idempotent. Range offsets and lengths are safe integers within the document size.
DOCX, PPTX, XLSX and images request the whole document as one `[0, size)` range, so
a host can serve it with a single read; PDF requests partial ranges.
Readers should honor abort signals where their transport supports cancellation. The
package discards a read result after cancellation; it cannot stop host I/O that has
already started or interrupt synchronous engine parsing. Returned byte views remain
host-owned: the package does not mutate or detach them. XLSX copies the requested
bytes before transferring its own buffer to the parsing worker.

`refreshKey` is an optional number. Changing it closes the current document and opens
a fresh session, including after a failure. `header` accepts host-owned navigation
and file-identity content for the fixed top row; the format toolbar shares that row.
Without a header, format controls render above the document. Give `source` and
`resources` stable references so layout, locale and theme updates retain the session.

`onSelection` reports `{ sourceId, revision, anchor, excerpt }`, or `null` when a
pick is cleared. Anchors use worksheet A1 ranges, body paragraph ordinals, PDF pages
and PPTX slides. The host owns held selections across refreshes and file switches.
`revision` is opaque to the package and only distinguishes document versions. Hosts
map selections back to their own file identity; the package never parses it.
Excerpts use NFC normalization, collapse the shared JavaScript/Python whitespace set
to single spaces, and trim both ends. They are limited to 2000 UTF-16 code units,
without splitting a surrogate pair; an empty normalized excerpt produces `null`.
Callback references are stabilized inside `Preview`, so inline callbacks do not
reopen documents or repeat a selection notification merely because the host rendered.

Recognized `source.mediaType` values take precedence over the filename extension;
missing or unrecognized media types fall back to the extension. `supportsPreview`
and `canSelectPreview` accept the same optional media type as their second argument.

`onDiagnostic` is the logging channel for engine warnings and errors. A terminal
failure emits one diagnostic and calls `onError` once for that session; `onError`
notifies host state and should not log the same error again. Expected `too_large`
failures are warnings. Non-terminal problems, such as a failed PPTX slide or PDF
outline navigation, emit diagnostics while the rest of the document remains usable.

`onError` receives a `PreviewError` with a stable `code` and an optional underlying
`cause`. Error messages are diagnostic details, not localized UI copy.

| Code | Meaning |
| --- | --- |
| `invalid_range` | Invalid document size, offset or read length |
| `short_read` | The reader returned fewer or more bytes than requested |
| `source_changed` | The host detected a revision change during reading |
| `closed` | A read was attempted after the host document closed |
| `too_large` | A preview source or PDF range exceeded its safety limit |
| `load_error` | Opening, parsing or rendering failed for another reason |

`onRequestOpen` delegates external opening to the host only after the user activates
an open button. Its reason is `unsupported` for unrecognized formats or `too_large`
for size-limit fallbacks; rendering or refreshing an unsupported source never opens
another application automatically. DOCX/PPTX above 25 MiB, XLSX above 20 MiB and
images above 64 MiB show their limits. PDF has a 16 MiB assembled-range cap, without
a whole-document size limit. These states offer an external-open button when the
host supplies the callback.
`resources.baseUrl` optionally overrides the bundled worker/font/CMap directory;
include a trailing slash. Relative URLs resolve against the host page.
`readPdfResource` takes precedence over resource URLs for PDF fonts and CMaps,
including font substitution. Electron provides it for file-scheme pages.
PDF workers belong to individual previews and never change pdf.js global options.
Cleanup awaits the pdf.js loading task's destruction before terminating its worker,
allowing document fonts to be released. There is no forced teardown timeout: an
already-unresponsive worker can leave that destruction promise pending.
Translations use an independent i18next instance with resources for all 13 desktop
languages; other locales fall back to English.

`FilePreviewLayout.Shell` owns the shared header and toolbar placement.
`FilePreviewLayout`, `FilePreviewToolbar` and its portal provider/host are also used
by desktop-only formats; `FilePreviewToolbarButton` is available for icon commands.
The registry is static; formats cannot be registered at runtime.

For a bundled web application, copy the package's `dist/assets/` directory to a
public directory (for example, Vite's `public/preview-assets/`) and point the preview
at its deployed URL:

```tsx
const resources = { baseUrl: '/preview-assets/' }

<Preview source={source} resources={resources} locale="zh-cn" />
```

Keep the workers, `cmaps/` and `standard_fonts/` together. Worker entry URLs must be
same-origin with the application; CORS permission alone does not allow a cross-origin
`new Worker()` entry. A cross-origin asset host needs a same-origin worker entry or
a host-provided `createWorker`. Font and CMap requests separately require the server's
cross-origin permissions when loaded from another origin.
When no base URL is provided, the bundler handles the native worker URLs; hosts
must still deploy the PDF resource directories or provide `readPdfResource`.

## WebView and inline hosts

A page whose bundle has no URL, such as inline HTML loaded into a mobile WebView, cannot
resolve the bundled workers or PDF resources. Supply both through `resources`:

```tsx
import pdfWorker from '@cherrystudio/file-preview/assets/pdf.worker.js?raw'
import xlsxWorker from '@cherrystudio/file-preview/assets/xlsx.worker.js?raw'

const workerSources = { pdf: pdfWorker, xlsx: xlsxWorker }
const workerUrls: Partial<Record<'pdf' | 'xlsx', string>> = {}
const resources = {
  createWorker: (kind: 'pdf' | 'xlsx') => {
    workerUrls[kind] ??= URL.createObjectURL(new Blob([workerSources[kind]], { type: 'text/javascript' }))
    return new Worker(workerUrls[kind], { type: 'module' })
  },
  readPdfResource: (kind: 'cmap' | 'standard_font', name: string) => bridge.readPdfResource(kind, name)
}
```

Cache one object URL per worker kind for the host resource lifetime. After all previews
using these resources have unmounted and the host disposes this resource set, release
the URLs with `for (const url of Object.values(workerUrls)) URL.revokeObjectURL(url)`.
Terminating an individual worker does not revoke its object URL.

`createWorker` takes precedence over `baseUrl` for both workers. Each worker file is
self-contained. Give inline HTML a base URL, such as react-native-webview's
`source={{ html, baseUrl: 'https://file-preview.local/' }}`: in an opaque `about:blank`
origin, browsers refuse module workers created from blob URLs. `readPdfResource` serves names from `assets/cmaps/` (without `.bcmap`)
and `assets/standard_fonts/`.

PDF and DOCX zoom with a two-finger pinch, and images pinch-zoom in their viewport.
PPTX and XLSX zoom through the toolbar. A spreadsheet touch selects a cell on tap, and
swiping scrolls without selecting. Disable page zoom in the host page
(`<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`)
so a pinch outside these surfaces does not scale the whole preview.

### Opt-in host layout and font compatibility

All `options` are opt-in. Omitting them preserves desktop rendering: a PDF sidebar,
DOCX at 100% with its existing font handling, translucent spreadsheet headers, and
the existing viewport inset. The package does not detect the host platform.

```tsx
<Preview
  source={source}
  resources={resources}
  options={{
    bottomInset: 'content',
    pdf: { outlineLayout: useOverlayOutline ? 'overlay' : 'panel' },
    docx: { initialZoom: 'fit-width', normalizeSymbolBullets: true },
    xlsx: { opaqueHeaders: true }
  }}
/>
```

The host chooses `useOverlayOutline` from its actual available width, including
landscape orientation. Overlay mode covers the preview without shrinking its pages;
Escape, the close button, the backdrop, and selecting an internal destination dismiss
it. Explicitly selecting either PDF layout also keeps page-width zoom in sync with
container resizing; manual zoom is preserved.

DOCX `fit-width` includes the document wrapper and widest page, permits scales below
50%, and never enlarges beyond 100%. It follows container resizing until the user
zooms using the toolbar or a pinch; Reset resumes fitting. No orientation message is
needed for DOCX. `normalizeSymbolBullets` is read when opening the document: it maps
known single-character Symbol/Wingdings bullet markers to Unicode and removes their
legacy font override. Other fonts, unknown symbols and numbered lists are preserved.

`bottomInset: 'content'` adds trailing space inside PDF, DOCX and PPTX document scroll
containers, in unscaled host CSS pixels. Both PDF outline layouts receive trailing
scroll space too. XLSX is the fixed-control exception: its sheet tabs, status and zoom
controls reserve the inset below the whole footer so host overlays cannot cover them.
The grid does not add a second inset. Other formats retain their existing inset behavior.
`opaqueHeaders` composites the muted XLSX header color over an opaque version of
`--background`, including the frozen corner, so cells cannot show through alpha colors.

Keep `source` and `resources` references stable during layout, locale and theme updates.
Changing `options` does not reopen the source. Font compatibility takes effect on the
next document open or explicit refresh; it does not reparse an open document.

## Styling

`className` and `style` apply to the preview's single theme root. Internal frames inherit
its tokens. Add `dark` for the dark theme, and set these custom properties to retheme it.
Root overrides win over the packaged values, and PDF observes this same root for theme changes.

| Property | Used for |
| --- | --- |
| `--background`, `--foreground` | Surfaces and text |
| `--primary` | Picks, focus and active controls |
| `--muted`, `--muted-foreground` | Secondary surfaces, icons and labels |
| `--border`, `--border-subtle`, `--ring` | Dividers, outlines and focus rings |
| `--file-preview-toolbar-button-size` | Toolbar button size, default `1.75rem` |
| `--file-preview-bottom-inset` | Bottom space; content mode adds document scroll space or protects the fixed XLSX footer |

## Building

```sh
pnpm --dir packages/file-preview pack --pack-destination /path/to/artifacts
```

`pack` runs the production build first, so the tarball never carries a stale `dist`.

The library build uses Vite to process native worker URLs and Tailwind CSS, plus
`rolldown-plugin-dts` for declaration bundles. Every third-party library except `zod`
is bundled, including UI components and the patched docx-preview and pptx-renderer, so they are dev
dependencies; consumers install only `zod` and the React peers. CSS excludes Tailwind preflight
and scopes selectors to `.file-preview-root`.
