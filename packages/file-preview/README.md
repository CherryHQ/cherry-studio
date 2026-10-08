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

```sh
pnpm --dir packages/file-preview build
pnpm --dir packages/file-preview pack --pack-destination /path/to/artifacts
```

The library build uses Vite to process native worker URLs and Tailwind CSS, plus
`rolldown-plugin-dts` for declaration bundles. Every third-party library except `zod`
is bundled, including UI components and the patched docx-preview, so they are dev
dependencies; consumers install only `zod` and the React peers. CSS excludes Tailwind preflight
and scopes selectors to `.file-preview-root`. Build and runtime verification must
be requested explicitly in this workspace.
