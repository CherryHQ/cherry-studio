/**
 * Global type declarations for Cherry Studio
 */

declare global {
  interface Window {
    topView?: {
      push: (item: { element: React.FC | React.ReactNode; id: string }) => void
      pop: () => void
      hide: () => void
    }
    modal?: {
      confirm: (options: {
        title?: string
        content?: string
        okText?: string
        cancelText?: string
        okButtonProps?: { danger?: boolean }
        centered?: boolean
        onOk?: () => void
      }) => void
    }
    contextMenu?: {
      showMenu: (options: {
        items: Array<{ label: string; onClick?: () => void; type?: string; danger?: boolean }>
      }) => void
    }
  }
}

export {}
