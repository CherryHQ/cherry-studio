import { debounce } from 'es-toolkit/compat'

type SelectionChangeHandler = (selection: Selection | null) => void
type ViewerHandlers = { selection: SelectionChangeHandler; copy: (event: ClipboardEvent) => void }

export class CodeViewerSelectionManager {
  private readonly viewers = new Map<HTMLElement, ViewerHandlers>()
  private activeViewer: HTMLElement | null = null
  private retained: { viewer: HTMLElement; start: Node; end: Node } | null = null
  private ownerDocument: Document | null = null
  private readonly handleSelectionChange = debounce(() => this.dispatchSelectionChange(), 100)
  private readonly handlePointerDown = () => this.clearSelection()
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const selectsAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'
    const extendsSelection =
      event.shiftKey &&
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
    if (event.key === 'Escape' || selectsAll || extendsSelection) this.clearSelection()
  }
  private readonly handleFocus = (event: FocusEvent) => {
    if (event.target instanceof Node && !this.activeViewer?.contains(event.target)) this.clearSelection()
  }
  private readonly handleCopy = (event: ClipboardEvent) => {
    if (event.defaultPrevented) return
    const selection = this.ownerDocument?.defaultView?.getSelection() ?? null
    const viewer =
      this.findViewer(selection) ?? (this.retainsCollapsedSelection(selection) ? this.retained?.viewer : null)
    if (viewer) this.viewers.get(viewer)?.copy(event)
  }

  register(viewer: HTMLElement, handler: SelectionChangeHandler, copy: (event: ClipboardEvent) => void): () => void {
    const previousHandler = this.viewers.get(viewer)
    const handlers = { selection: handler, copy }
    this.viewers.set(viewer, handlers)

    if (!previousHandler && this.viewers.size === 1) {
      this.ownerDocument = viewer.ownerDocument
      this.ownerDocument.addEventListener('selectionchange', this.handleSelectionChange)
      this.ownerDocument.addEventListener('pointerdown', this.handlePointerDown, true)
      this.ownerDocument.addEventListener('keydown', this.handleKeyDown, true)
      this.ownerDocument.addEventListener('focusin', this.handleFocus)
      this.ownerDocument.addEventListener('copy', this.handleCopy)
    }

    return () => {
      if (this.viewers.get(viewer) !== handlers) return

      this.release(viewer)
      this.viewers.delete(viewer)

      if (this.viewers.size === 0 && this.ownerDocument) {
        this.ownerDocument.removeEventListener('selectionchange', this.handleSelectionChange)
        this.ownerDocument.removeEventListener('pointerdown', this.handlePointerDown, true)
        this.ownerDocument.removeEventListener('keydown', this.handleKeyDown, true)
        this.ownerDocument.removeEventListener('focusin', this.handleFocus)
        this.ownerDocument.removeEventListener('copy', this.handleCopy)
        this.handleSelectionChange.cancel()
        this.ownerDocument = null
      }
    }
  }

  retain(viewer: HTMLElement): void {
    const selection = this.ownerDocument?.defaultView?.getSelection() ?? null
    if (this.findViewer(selection) !== viewer) return
    if (this.activeViewer !== viewer) this.clearSelection()
    const range = selection!.getRangeAt(0)
    this.activeViewer = viewer
    this.retained = { viewer, start: range.startContainer, end: range.endContainer }
  }

  release(viewer: HTMLElement): void {
    if (this.activeViewer === viewer) this.clearSelection()
  }

  private clearSelection(): void {
    if (this.activeViewer) this.viewers.get(this.activeViewer)?.selection(null)
    this.activeViewer = null
    this.retained = null
  }

  private retainsCollapsedSelection(selection: Selection | null): boolean {
    const retained = this.retained
    return Boolean(
      retained &&
      selection?.rangeCount &&
      selection.isCollapsed &&
      retained.viewer.contains(selection.getRangeAt(0).commonAncestorContainer) &&
      (!retained.start.isConnected || !retained.end.isConnected)
    )
  }

  private dispatchSelectionChange(): void {
    const selection = this.ownerDocument?.defaultView?.getSelection() ?? null
    const nextViewer = this.findViewer(selection)
    if (!nextViewer && this.retainsCollapsedSelection(selection)) return

    if (this.activeViewer && this.activeViewer !== nextViewer) {
      this.clearSelection()
    }

    this.activeViewer = nextViewer
    if (nextViewer) {
      this.viewers.get(nextViewer)?.selection(selection)
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
