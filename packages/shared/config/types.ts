export type LoaderReturn = {
  entriesAdded: number
  uniqueId: string
  uniqueIds: string[]
  loaderType: string
}

export type InstallExtensionOptions = {
  extensionId: string
  session?: Electron.Session
  extensionsPath?: string
  allowFileAccess?: boolean
}

export type ChromeWebStoreOptions = {
  session?: Electron.Session
  extensionsPath?: string
  loadExtensions?: boolean
  allowUnpackedExtensions?: boolean
  autoUpdate?: boolean
}

export type Extension = {
  id: string
  name: string
  version: string
  path: string
  description?: string
  enabled: boolean
  icon?: string
  permissions?: string[]
  installDate?: string
  updateDate?: string
  size?: number
  homepageUrl?: string
  source: 'store' | 'unpacked'
}
