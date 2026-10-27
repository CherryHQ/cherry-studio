import { FILE_TYPE } from '@renderer/types/file'
import type { NotesTreeNode } from '@renderer/types/note'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { createComposerFileTokenSourceId } from '@renderer/utils/message/composerFileTokenSource'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { DirectoryTreeOptions } from '@shared/utils/file'

export const NOTES_TREE_OPTIONS: DirectoryTreeOptions = {
  extensions: ['.md'],
  respectGitignore: false,
  includeHidden: false
}

export function noteToComposerAttachment(note: Pick<NotesTreeNode, 'externalPath' | 'name'>): ComposerAttachment {
  const fileName = note.externalPath.split(/[\\/]/).at(-1) || `${note.name}.md`

  return {
    fileTokenSourceId: createComposerFileTokenSourceId(),
    path: AbsoluteFilePathSchema.parse(note.externalPath),
    name: fileName,
    origin_name: fileName,
    ext: '.md',
    size: 0,
    type: FILE_TYPE.TEXT
  }
}
