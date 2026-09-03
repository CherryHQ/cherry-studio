# FilePreview

`FilePreview` is the canonical read-only preview host for local files. Callers provide a file path and decide where the preview appears. The host validates the path target and selects the preview strategy; the matching plugin owns file I/O, format rendering, toolbar controls, and format-specific state.

The built-in plugins currently support HTML, images (`.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.avif`, `.ico`, `.svg` — SVG renders via `<img>`, which never executes embedded scripts), browser-playable video (`.mp4`, `.webm`, `.m4v`), PDF, Word (`.docx`), PowerPoint (`.pptx`), spreadsheets (`.xlsx`), Markdown (`.md`, `.markdown`, `.mdx`), and text/source files. Files outside the text extension whitelist still use the text plugin when content sniffing identifies them as text.

## Path Contract

- Accept local absolute `AbsoluteFilePath` values only. POSIX and Windows paths are supported.
- Do not pass relative paths, `file://` URLs, HTTP URLs, Base64 values, or in-memory data.
- `FilePreview` lexically normalizes the path before resolving a plugin. It does not resolve symlinks or call `realpath`.
- `FilePreview` starts the extension plugin module load alongside `getMetadata`, but metadata still decides whether the
  candidate can render. Directories and inaccessible paths never reach a file plugin component.
- When a path comes from IPC or another untyped string source, validate it with `normalizeFilePreviewPath`. Do not bypass runtime validation with a type assertion.

```ts
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'

const filePath = normalizeFilePreviewPath(physicalPath)
```

## Embedded Preview

Import `FilePreview` from the module root and place it in a parent with a defined available height. The component fills its parent, and the plugin content area handles scrolling.

```tsx
import { Button } from '@cherrystudio/ui'
import { FilePreview } from '@renderer/components/FilePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { useTranslation } from 'react-i18next'

interface FileDetailsProps {
  fileName: string
  filePath: AbsoluteFilePath
  onBack: () => void
  refreshKey?: number
}

export function FileDetails({ fileName, filePath, onBack, refreshKey }: FileDetailsProps) {
  const { t } = useTranslation()

  return (
    <section className="flex min-h-0 flex-1">
      <FilePreview
        filePath={filePath}
        refreshKey={refreshKey}
        header={
          <>
            <Button onClick={onBack}>{t('common.back')}</Button>
            <span className="truncate">{fileName}</span>
          </>
        }
      />
    </section>
  )
}
```

The embedded host owns page-level interactions such as back, close, and file selection. Pass those controls as
`header` content when they should share the fixed top row with the plugin toolbar. `FilePreview` keeps caller content
on the left and portals the active plugin toolbar to the right. Do not pass format controls through `header` or add
`embedded`, `showBackButton`, or page-specific callbacks to `FilePreview`.

When an embedded host owns in-app file navigation, wrap the preview in `FilePreviewNavigationProvider` and provide
the workspace root and its absolute-path opener. The Markdown plugin then resolves schemeless links relative to that
workspace root and returns the absolute target to the host. Absolute links and relative links that lexically escape
with `..` can resolve outside that root; this provider does not enforce workspace containment, so the host owns any
access policy. Without this capability, previews retain Streamdown's default safe link treatment.

Use `type="artifact"` for an explicit development-artifact surface whose host owns editing. Markdown and HTML then
stay in rendered preview mode and omit their preview/source switch, while HTML uses the interactive artifact sandbox
so generated applications can run scripts. This does not hide format-specific controls such as PDF zoom or image
transforms.

All other callers default to `type="file"`. That type treats local HTML as untrusted, renders it with the
script-less sandbox and strict CSP, and keeps the plugin-owned preview/source switch. Do not mark an arbitrary local
file as an artifact merely to enable scripts.

## Tab Preview

Use `useOpenFilePreviewTab` below `TabsProvider`. The hook normalizes the path, creates a URL-encoded `/app/file-preview?path=...` target, and uses the cross-platform basename as the tab title.

```tsx
import { Button } from '@cherrystudio/ui'
import { useOpenFilePreviewTab } from '@renderer/components/FilePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { useTranslation } from 'react-i18next'

export function OpenPreviewButton({ filePath }: { filePath: AbsoluteFilePath }) {
  const { t } = useTranslation()
  const openFilePreviewTab = useOpenFilePreviewTab()

  return <Button onClick={() => openFilePreviewTab(filePath)}>{t('common.open_in_new_tab')}</Button>
}
```

The hook does not set `forceNew`. Equivalent normalized paths produce the same URL and reuse an existing tab. Reopening an existing tab increments its internal refresh key so the mounted plugin reloads the file. Pass the file's display name as the optional second argument when it differs from the physical path basename. The returned string is the tab ID when the caller needs it.

Embedded and tab previews are host composition choices, not `FilePreview` display variants. If users can switch between them, keep that choice in the calling page: set the current `filePath` for embedded mode or call `openFilePreviewTab(filePath)` for tab mode. Do not move this mode state into `FilePreview`.

## Plugin Structure

Each format is an independent plugin under `plugins/<format>/`:

```text
plugins/example/
├── ExampleFilePreview.tsx
├── ExampleFilePreviewToolbar.tsx   # Create only when the plugin has controls
├── __tests__/
│   └── ExampleFilePreview.test.tsx
└── exampleFilePreviewPlugin.ts
```

The plugin descriptor declares only its identity, extensions, and lazy entry point:

```ts
import type { FilePreviewPlugin } from '../../types'

export const exampleFilePreviewPlugin = {
  id: 'example',
  extensions: ['example', 'example2'],
  load: () => import('./ExampleFilePreview')
} satisfies FilePreviewPlugin
```

Descriptor rules:

- `id` must be stable and unique within the registry.
- `extensions` must be lowercase and omit the leading dot. Use `pdf`, not `.pdf` or `PDF`.
- One extension can belong to only one plugin. Duplicate extensions throw when the registry is created.
- `load` must resolve to a module with a default React component export. Keep large rendering libraries inside the lazy module rather than the descriptor.
- The registry is static configuration. There is no runtime registration, priority, or caller override API.

The plugin component receives the normalized path, extracted filename, preflighted file metadata, and a required refresh key:

```ts
interface FilePreviewPluginProps {
  filePath: AbsoluteFilePath
  fileName: string
  metadata: FilePreviewFileMetadata
  refreshKey: number
  type?: 'artifact' | 'file'
}
```

The preview component must use a default export, read the file, and compose the module's internal layout:

```tsx
import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { ExampleFilePreviewToolbar } from './ExampleFilePreviewToolbar'

export default function ExampleFilePreview({ filePath, fileName, metadata, refreshKey }: FilePreviewPluginProps) {
  // Load in an effect that depends on filePath and refreshKey. The plugin owns
  // file loading, view state, and toolbar actions here.

  return (
    <FilePreviewLayout.Frame>
      <ExampleFilePreviewToolbar disabled={false} />
      <FilePreviewLayout.Content>
        <div>{fileName} ({metadata.size} bytes)</div>
      </FilePreviewLayout.Content>
    </FilePreviewLayout.Frame>
  )
}
```

After implementing the plugin, explicitly import it in `filePreviewRegistry.ts` and add it to `extensionPlugins`:

```ts
export const filePreviewRegistry = createFilePreviewRegistry({
  extensionPlugins: [imageFilePreviewPlugin, exampleFilePreviewPlugin]
})
```

## Composition Rules

Keep the public `FilePreview` props minimal: `filePath`, optional `header`, optional `refreshKey`, and optional `type`.
Follow these boundaries when adding formats or capabilities:

- Express format differences as independent plugins. Do not add booleans such as `isPdf` or `isImage` to `FilePreview`.
- The plugin owns its loading state, view state, and actions. Its toolbar receives only the state and callbacks required for rendering.
- Put every plugin toolbar in a separate `<Format>FilePreviewToolbar.tsx` component. When a plugin has no controls, omit the toolbar completely instead of rendering an empty row.
- Compose toolbar content with `FilePreviewToolbar`. Use `FilePreviewToolbarButton` for icon commands and an appropriate UI primitive such as `SegmentedControl` for mode selection.
- Keep the renderer and file-loading lifecycle inside the plugin directory. Do not wrap an existing page or legacy preview panel; migrate that caller to `FilePreview` later instead of coupling the new plugin back to it.
- Represent mutually exclusive plugin views with an explicit union such as `'preview' | 'source'`, not several interacting booleans.
- Keep plugin capabilities inside the plugin. Do not expose a toolbar slot to callers or make calling pages manage format-specific state.
- `type="file"` is the default for arbitrary paths and must keep untrusted HTML script-less.
- Use `type="artifact"` only for a development-artifact surface that intentionally runs generated HTML and owns the
  source/edit experience. Plugins without an artifact-specific policy ignore it; their format controls remain visible.
- Treat `header` as host-owned navigation and identity content only. When it is absent, the plugin toolbar remains
  centered in its own row for Tab and standalone previews.

This composition lets the same plugin work in embedded and tab hosts without format-specific branches.

## File I/O, States, and Errors

- Opening surfaces should classify a clicked path before choosing UI: open directories in the file browser without a preview selection; send concrete files to `FilePreview`; let missing or inaccessible file selections reach `FilePreview` so it can show the unavailable state.
- `FilePreview` uses this routing model:

| Target | Preview decision | Result |
| --- | --- | --- |
| Directory | No file plugin | File-browser surface; defensive folder state if passed directly |
| Existing file with a registered binary plugin | Registered plugin | Inline preview |
| Artifact HTML | HTML plugin with artifact policy | Interactive inline preview; host owns source/edit |
| Existing text file with a registered text plugin | Registered plugin after content sniff | Inline preview |
| Existing text file with no registered extension | Text fallback plugin | Source preview |
| Existing binary file with no registered plugin | Unsupported | Explanation plus safe default-app action |
| Missing or inaccessible path | Unavailable | Explanation without an open action |
| Invalid or non-absolute path | Invalid | Explanation without an open action |

- Use `window.api.fs.readText` for text. Use `window.api.fs.read` only for full binary reads that the plugin bounds
  using the preflighted file size. Large or on-demand binary formats must use typed `ipcApi.request('file.read', ...)`
  range reads instead of loading the entire file.
- Transports that combine multiple range reads must cap the assembled range before allocating it and reject responses
  whose `version` changes between reads or whose `version.size` differs from the preflighted `metadata.size`.
- The PDF transport caps each assembled pdf.js range at 16 MiB. This is not a PDF file-size limit: larger files can
  preview while every requested range stays within the cap. A PDF that requires a larger contiguous range must offer
  an explicit external-open fallback; removing this cap requires a transport that streams without renderer assembly.
- Use the preflighted `metadata` prop for size guards. Do not issue a second metadata request from a plugin.
- Include `filePath` and `refreshKey` in loading effects. A new refresh key means the current file must be read again even when its path is unchanged.
- `FilePreview` owns directory, invalid-path, unavailable-path, unsupported-format, plugin-load, and synchronous render error states.
- A plugin owns its loading, empty, too-large, and read-error states. It must catch asynchronous failures from effects and event handlers so errors remain inside the preview region.
- Log read failures through `loggerService`, and expose enough diagnostic detail in the error state to make failures actionable.
- Cancel, disconnect, or destroy file reads, workers, listeners, and third-party instances when the component unmounts, `filePath` changes, or `refreshKey` changes.

## UI and Copy

- Build new UI with `@cherrystudio/ui` and Tailwind CSS, following the repository [DESIGN.md](../../../../DESIGN.md).
- Use Lucide icons in toolbars. Icon buttons require an accessible name and a tooltip.
- Put plugin-specific copy under `file_preview.*` i18n keys, reuse existing `common.*` or `preview.*` keys for shared controls, and update `en-us` and `zh-cn`.
- Keep the toolbar at a stable height. Only `FilePreviewLayout.Content` should own content scrolling.

## Verification

A new plugin should have focused coverage for at least these cases:

- Its extensions resolve to the correct plugin without conflicting with existing extensions.
- The lazy component receives the normalized `filePath`, correct `fileName`, preflighted `metadata`, and current `refreshKey`.
- Loading, success, empty, and read-error states remain contained within the preview region.
- Toolbar actions, disabled states, and cleanup behavior work as expected.

Run the focused plugin and registry Vitest suites first, followed by the repository-required formatting and static checks.
