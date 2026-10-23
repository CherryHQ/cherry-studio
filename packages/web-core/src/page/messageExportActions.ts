// Wraps the desktop message export actions: saving to a file downloads it (`fileDownloads.ts`); notes,
// knowledge bases, Word and the note apps (Notion, Yuque, Obsidian, Joplin, SiYuan) are desktop-only.
// The message menus show an entry only when its action is present.
import { useMessageExportActions as useDesktopMessageExportActions } from '@renderer/components/chat/messages/hooks/useMessageExportActions'

export function useMessageExportActions(
  params: Parameters<typeof useDesktopMessageExportActions>[0]
): ReturnType<typeof useDesktopMessageExportActions> {
  const { saveTextFile, saveImage, exportMessageAsMarkdown, exportMessages } = useDesktopMessageExportActions(params)
  return { saveTextFile, saveImage, exportMessageAsMarkdown, exportMessages }
}
