# FilePreview

`FilePreview` is a read-only preview host for local files. Callers provide a file path and decide where the preview appears. The matching plugin owns file I/O, format rendering, toolbar controls, and format-specific state.

The built-in plugins currently support images, PDF, Word (`.docx`), PowerPoint (`.pptx`), Markdown, and
text/source files.

## Path Contract

- Accept local absolute `FilePath` values only. POSIX and Windows paths are supported.
- Do not pass relative paths, `file://` URLs, HTTP URLs, Base64 values, or in-memory data.
- `FilePreview` lexically normalizes the path before resolving a plugin. It does not resolve symlinks or call `realpath`.
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
import type { FilePath } from '@shared/types/file'
import { useTranslation } from 'react-i18next'

interface FileDetailsProps {
  fileName: string
  filePath: FilePath
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

## Tab Preview

Use `useOpenFilePreviewTab` below `TabsProvider`. The hook normalizes the path, creates a URL-encoded `/app/file-preview?path=...` target, and uses the cross-platform basename as the tab title.

```tsx
import { Button } from '@cherrystudio/ui'
import { useOpenFilePreviewTab } from '@renderer/components/FilePreview'
import type { FilePath } from '@shared/types/file'
import { useTranslation } from 'react-i18next'

export function OpenPreviewButton({ filePath }: { filePath: FilePath }) {
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

The plugin component receives the normalized path, extracted filename, and a required refresh key:

```ts
interface FilePreviewPluginProps {
  filePath: FilePath
  fileName: string
  refreshKey: number
}
```

The preview component must use a default export, read the file, and compose the module's internal layout:

```tsx
import { FilePreviewLayout } from '../../FilePreviewLayout'
import type { FilePreviewPluginProps } from '../../types'
import { ExampleFilePreviewToolbar } from './ExampleFilePreviewToolbar'

export default function ExampleFilePreview({ filePath, fileName, refreshKey }: FilePreviewPluginProps) {
  // Load in an effect that depends on filePath and refreshKey. The plugin owns
  // file loading, view state, and toolbar actions here.

  return (
    <FilePreviewLayout.Frame>
      <ExampleFilePreviewToolbar disabled={false} />
      <FilePreviewLayout.Content>
        <div>{fileName}</div>
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

Keep the public `FilePreview` props minimal: `filePath`, optional `header`, and optional `refreshKey`. Follow these boundaries when adding formats or capabilities:

- Express format differences as independent plugins. Do not add booleans such as `isPdf` or `isImage` to `FilePreview`.
- The plugin owns its loading state, view state, and actions. Its toolbar receives only the state and callbacks required for rendering.
- Put every plugin toolbar in a separate `<Format>FilePreviewToolbar.tsx` component. When a plugin has no controls, omit the toolbar completely instead of rendering an empty row.
- Compose toolbar content with `FilePreviewToolbar`. Use `FilePreviewToolbarButton` for icon commands and an appropriate UI primitive such as `SegmentedControl` for mode selection.
- Keep the renderer and file-loading lifecycle inside the plugin directory. Do not wrap an existing page or legacy preview panel; migrate that caller to `FilePreview` later instead of coupling the new plugin back to it.
- Represent mutually exclusive plugin views with an explicit union such as `'preview' | 'source'`, not several interacting booleans.
- Keep plugin capabilities inside the plugin. Do not expose a toolbar slot to callers or make calling pages manage format-specific state.
- Treat `header` as host-owned navigation and identity content only. When it is absent, the plugin toolbar remains
  centered in its own row for Tab and standalone previews.

This composition lets the same plugin work in embedded and tab hosts without format-specific branches.

## File I/O, States, and Errors

- Plugins read files through `window.api`. Use `window.api.fs.readText` for text and `window.api.fs.read` for binary data.
- When a plugin needs metadata or a size guard before reading, use the file IPC API with `createFilePathHandle(filePath)`.
- Include `filePath` and `refreshKey` in loading effects. A new refresh key means the current file must be read again even when its path is unchanged.
- `FilePreview` owns invalid-path, unsupported-format, plugin-load, and synchronous render error states.
- A plugin owns its loading, empty, too-large, and read-error states. It must catch asynchronous failures from effects and event handlers so errors remain inside the preview region.
- Log read failures through `loggerService`, and expose enough diagnostic detail in the error state to make failures actionable.
- Cancel, disconnect, or destroy file reads, workers, listeners, and third-party instances when the component unmounts, `filePath` changes, or `refreshKey` changes.

## UI and Copy

- Build new UI with `@cherrystudio/ui` and Tailwind CSS, following the repository [DESIGN.md](../../../../DESIGN.md).
- Use Lucide icons in toolbars. Icon buttons require an accessible name and a tooltip.
- Put plugin-specific copy under `file_preview.*` i18n keys, reuse existing `common.*` or `preview.*` keys for shared controls, and update `en-us`, `zh-cn`, and `zh-tw`.
- Keep the toolbar at a stable height. Only `FilePreviewLayout.Content` should own content scrolling.

## Verification

A new plugin should have focused coverage for at least these cases:

- Its extensions resolve to the correct plugin without conflicting with existing extensions.
- The lazy component receives the normalized `filePath`, correct `fileName`, and current `refreshKey`.
- Loading, success, empty, and read-error states remain contained within the preview region.
- Toolbar actions, disabled states, and cleanup behavior work as expected.

Run the focused plugin and registry Vitest suites first, followed by the repository-required formatting and static checks.
