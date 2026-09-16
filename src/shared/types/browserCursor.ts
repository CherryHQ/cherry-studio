export interface BrowserCursorIdentity {
  sessionId: string
  tabId: string
}

export type BrowserCursorState = BrowserCursorIdentity & {
  sequence: number
} & (
    | { kind: 'hidden' }
    | {
        kind: 'move' | 'pressed'
        documentId: string
        x: number
        y: number
        animate: boolean
        scale: number
      }
  )

export interface BrowserCursorArrival extends BrowserCursorIdentity {
  sequence: number
  documentId: string
}
