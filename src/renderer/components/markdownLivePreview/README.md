# Markdown live preview

The source-line schema, Markdown session, syntax decorations and editing keys are shared with Composer. Composer adds its own tokens, paste restoration and send behavior. `MarkdownLivePreview` is the document surface: it treats every character as file source and has no chat actions.

The document surface receives `value`, `onChange`, `label` and optional `readOnly`. Persistence belongs to its host. It never reads or writes files. `ArtifactPane` uses the existing file session for drafts, automatic/manual saving, conflicts and leave guards; source and live-preview modes share that session.

Inactive top-level blocks render through one full `AppMarkdown` document, so reference definitions and footnotes retain document context. A stable renderer portals each rendered block into a ProseMirror widget. Clicking noninteractive content reveals its source at the block start; selection and keyboard movement reveal the selected regions. Links, image previews and toolbar controls keep their existing actions. Composition delays draft publication and decoration replacement until committed text settles.

Source remains authoritative: paragraph nodes represent literal source lines, including carriage returns, trailing spaces and template-like text. Frontmatter is masked only for rendering. No Markdown serializer rewrites the file. The source-mode control also exposes frontmatter and malformed content.

Use the existing `markdown` and `static-markdown` styles. Widget containers use `display: contents` to retain margin collapse, and rich-text editor styles exclude this document surface. Local file hosts wrap the surface in `MarkdownFileHostProvider` to retain relative image and file-link resolution.

Focused tests live in `__tests__`; exercise the document component, source preservation, Composer syntax/key contracts and the consuming pane together. Electron validation must include focus transitions, composition, real file writes and light/dark layout comparison. Full-document parsing and rendering are not virtualized; use source mode for very large documents when editing latency matters.
