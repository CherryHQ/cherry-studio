import type { ExternalAppConfig } from '../types'

export const EXTERNAL_APPS = [
  { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'] },
  { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'] },
  { id: 'zed', name: 'Zed', protocol: 'zed://', tags: ['code-editor'] }
] as const satisfies ExternalAppConfig[]
