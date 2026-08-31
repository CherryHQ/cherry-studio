import { getPathBasename } from '@renderer/components/chat/panes/artifactPanePath'
import { createComposerSecureRandomId } from '@renderer/utils/message/composerFileTokenSource'

import type { ComposerDraftToken } from './tokens'

export function createComposerFolderToken(path: string): ComposerDraftToken {
  return {
    id: createComposerSecureRandomId('folder-token'),
    kind: 'folder',
    label: getPathBasename(path),
    description: path,
    promptText: path
  }
}
