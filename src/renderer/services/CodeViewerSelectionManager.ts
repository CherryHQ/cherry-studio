import { debounce } from 'es-toolkit/compat'

type SelectionChangeHandler = (selection: Selection | null) => void

export class CodeViewerSelectionManager {
  private readonly viewers = new Map<HTMLElement, SelectionChangeHandler>()
  private activeViewer: HTMLElement | null = null
  private ownerDocument: Document | null = null
  private readonly handleSelectionChange = debounce(() => this.dispatchSelectionChange(), 100)

  register(viewer: HTMLElement, handler: SelectionChangeHandler): () => void {
    const previousHandler = this.viewers.get(viewer)
    this.viewers.set(viewer, handler)

    if (!previousHandler && this.viewers.size === 1) {
      this.ownerDocument = viewer.ownerDocument
      this.ownerDocument.addEventListener('selectionchange', this.handleSelectionChange)
    }

    return () => {
      if (this.viewers.get(viewer) !== handler) return

      this.viewers.delete(viewer)
      if (this.activeViewer === viewer) {
        this.activeViewer = null
      }

      if (this.viewers.size === 0 && this.ownerDocument) {
        this.ownerDocument.removeEventListener('selectionchange', this.handleSelectionChange)
        this.handleSelectionChange.cancel()
        this.ownerDocument = null
      }
    }
  }

  private dispatchSelectionChange(): void {
    const selection = this.ownerDocument?.defaultView?.getSelection() ?? null
    const nextViewer = this.findViewer(selection)

    if (this.activeViewer && this.activeViewer !== nextViewer) {
      this.viewers.get(this.activeViewer)?.(null)
    }

    this.activeViewer = nextViewer
    if (nextViewer) {
      this.viewers.get(nextViewer)?.(selection)
    }
  }

  private findViewer(selection: Selection | null): HTMLElement | null {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

    const selectionRoot = selection.getRangeAt(0).commonAncestorContainer
    let matchedViewer: HTMLElement | null = null

    for (const viewer of this.viewers.keys()) {
      if (viewer.contains(selectionRoot) && (!matchedViewer || matchedViewer.contains(viewer))) {
        matchedViewer = viewer
      }
    }

    return matchedViewer
  }
}

export const codeViewerSelectionManager = new CodeViewerSelectionManager()
