interface ObsidianAPI {
  getVaults: () => Promise<Array<{ path: string; name: string }>>
  getFiles: (vaultName: string) => Promise<Array<{ path: string; type: 'folder' | 'markdown'; name: string }>>
}

interface Window {
  obsidian: ObsidianAPI
  root: HTMLElement
}
