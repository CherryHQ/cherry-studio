import ObsidianExportDialog from '@renderer/components/ObsidianExportDialog'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { createRoot } from 'react-dom/client'

interface ObsidianExportOptions {
  title: string
  markdown: string
  processingMethod: string | '3' // 默认新增（存在就覆盖）
}

/**
 * 配置Obsidian 笔记属性弹窗
 * @param options.title 标题
 * @param options.markdown markdown内容
 * @param options.processingMethod 处理方式
 * @returns
 */
const showObsidianExportDialog = async (options: ObsidianExportOptions): Promise<boolean> => {
  const obsidianValut = store.getState().settings.obsidianValut
  const obsidianFolder = store.getState().settings.obsidianFolder

  if (!obsidianValut || !obsidianFolder) {
    window.message.error(i18n.t('chat.topics.export.obsidian_not_configured'))
    return false
  }

  return new Promise<boolean>((resolve) => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)

    const handleClose = (success: boolean) => {
      root.unmount()
      document.body.removeChild(div)
      resolve(success)
    }
    const obsidianTags = store.getState().settings.obsidianTages
    root.render(
      <ObsidianExportDialog
        title={options.title}
        markdown={options.markdown}
        obsidianTags={obsidianTags}
        processingMethod={options.processingMethod}
        open={true}
        onClose={handleClose}
      />
    )
  })
}

const ObsidianExportPopup = {
  show: showObsidianExportDialog
}

export default ObsidianExportPopup
