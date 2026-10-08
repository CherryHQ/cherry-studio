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
Signals cancel reads; synchronous engine parsing is not interruptible.

`onSelection` reports `{ sourceId, revision, anchor, excerpt }`, or `null` when a
pick is cleared. Anchors use worksheet A1 ranges, body paragraph ordinals, PDF pages
and PPTX slides. The host owns held selections across refreshes and file switches.
`revision` is opaque to the package and only distinguishes document versions. Hosts
map selections back to their own file identity; the package never parses it.

`onDiagnostic` routes engine warnings and errors to the host logger. `onRequestOpen`
delegates unsupported formats and the PDF range-limit fallback to the host.
`resources.baseUrl` optionally overrides the bundled worker/font/CMap directory;
include a trailing slash. Relative URLs resolve against the host page.
Electron provides `readPdfResource` for file-scheme pages.
PDF workers belong to individual previews and never change pdf.js global options.
Translations use an independent i18next instance with resources for all 13 desktop
languages; other locales fall back to English.

`FilePreviewLayout`, `FilePreviewToolbar`, `FilePreviewToolbarButton` and the toolbar
portal provider/host let desktop-only formats share the same chrome.
The registry is static; formats cannot be registered at runtime.

For a bundled web application, copy the package's `dist/assets/` directory to a
public directory (for example, Vite's `public/preview-assets/`) and point the preview
at its deployed URL:

```tsx
const resources = { baseUrl: '/preview-assets/' }

<Preview source={source} resources={resources} locale="zh-cn" />
```

Keep the workers, `cmaps/` and `standard_fonts/` together. Serve them from the same
origin as the application, or configure the server's cross-origin permissions.
When no base URL is provided, the bundler handles the native worker URLs; hosts
must still deploy the PDF resource directories or provide `readPdfResource`.

## WebView and inline hosts

A page whose bundle has no URL, such as inline HTML loaded into a mobile WebView, cannot
resolve the bundled workers or PDF resources. Supply both through `resources`:

```tsx
import pdfWorker from '@cherrystudio/file-preview/assets/pdf.worker.js?raw'
import xlsxWorker from '@cherrystudio/file-preview/assets/xlsx.worker.js?raw'

const workerSources = { pdf: pdfWorker, xlsx: xlsxWorker }
const resources = {
  createWorker: (kind: 'pdf' | 'xlsx') =>
    new Worker(URL.createObjectURL(new Blob([workerSources[kind]], { type: 'text/javascript' })), {
      type: 'module'
    }),
  readPdfResource: (kind: 'cmap' | 'standard_font', name: string) => bridge.readPdfResource(kind, name)
}
```

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

## Styling

`className` and `style` apply to the preview root. Add `dark` for the dark theme, and
set these custom properties to retheme it. Root overrides win over the packaged values.

| Property | Used for |
| --- | --- |
| `--background`, `--foreground` | Surfaces and text |
| `--primary` | Picks, focus and active controls |
| `--muted`, `--muted-foreground` | Secondary surfaces, icons and labels |
| `--border`, `--border-subtle`, `--ring` | Dividers, outlines and focus rings |
| `--file-preview-toolbar-button-size` | Toolbar button size, default `1.75rem` |
| `--file-preview-bottom-inset` | Trailing space under scrolling content |

## Building

```sh
pnpm --dir packages/file-preview pack --pack-destination /path/to/artifacts
```

`pack` runs the production build first, so the tarball never carries a stale `dist`.

The library build uses Vite to process native worker URLs and Tailwind CSS, plus
`rolldown-plugin-dts` for declaration bundles. Every third-party library except `zod`
is bundled, including UI components and the patched docx-preview, so they are dev
dependencies; consumers install only `zod` and the React peers. CSS excludes Tailwind preflight
and scopes selectors to `.file-preview-root`. Build and runtime verification must
be requested explicitly in this workspace.
