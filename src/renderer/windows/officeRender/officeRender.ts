import {
  headlessLoadDocument,
  headlessSettle,
  headlessShowPage,
  type HeadlessDocumentKind,
  type HeadlessDocumentInfo,
  type HeadlessPageFrame
} from '@cherrystudio/file-preview/headless'

/**
 * Driver surface for the main-process `preview_document` tool: main resolves
 * `window.officeRender` and calls these over `webContents.executeJavaScript`.
 * Presence of this global doubles as the page-ready flag.
 */
window.officeRender = {
  load: headlessLoadDocument,
  showPage: headlessShowPage,
  settle: headlessSettle
}

declare global {
  interface Window {
    officeRender: {
      load: (kind: HeadlessDocumentKind, base64: string) => Promise<HeadlessDocumentInfo>
      showPage: (kind: HeadlessDocumentKind, index: number) => Promise<HeadlessPageFrame>
      settle: () => Promise<void>
    }
  }
}
