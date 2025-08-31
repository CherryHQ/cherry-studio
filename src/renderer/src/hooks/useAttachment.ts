import { loggerService } from '@logger'
import TextFilePreviewPopup from '@renderer/components/Popups/TextFilePreview'
import { FileTypes } from '@renderer/types'

const logger = loggerService.withContext('FileAction')

/**
 * 处理附件点击事件：
 * 如果是文本文件，在 Preview 视图中打开，
 * 否则使用默认打开接口
 */
export function useAttachment() {
  const handleClick = async (path: string | undefined, fileType: FileTypes, t: (args: string) => string) => {
    if (path === undefined) return
    try {
      if (fileType === FileTypes.TEXT) {
        const content = await window.api.fs.readText(path)
        TextFilePreviewPopup.show(content)
      } else {
        window.api.file.openPath(path)
      }
    } catch (err) {
      logger.error(`Error opening ${path}:`, err as Error)
      window.modal.error({ content: t('files.click.error'), centered: true })
    }
  }
  return {
    handleClick
  }
}
