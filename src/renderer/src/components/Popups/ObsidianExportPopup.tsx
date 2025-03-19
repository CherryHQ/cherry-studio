import ObsidianFolderSelector from '@renderer/components/ObsidianFolderSelector'
import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { exportMarkdownToObsidian } from '@renderer/utils/export'

interface ObsidianExportOptions {
  title: string
  markdown: string
}

// 用于显示 Obsidian 导出对话框
const showObsidianExportDialog = async (options: ObsidianExportOptions): Promise<boolean> => {
  const { title, markdown } = options
  const obsidianUrl = store.getState().settings.obsidianUrl
  const obsidianApiKey = store.getState().settings.obsidianApiKey

  if (!obsidianUrl || !obsidianApiKey) {
    window.message.error(i18n.t('chat.topics.export.obsidian_not_configured'))
    return false
  }

  try {
    // 创建一个状态变量来存储选择的路径
    let selectedPath = '/'
    let selectedIsMdFile = false

    // 显示文件夹选择对话框
    return new Promise<boolean>((resolve) => {
      window.modal.confirm({
        title: i18n.t('chat.topics.export.obsidian_select_folder'),
        content: (
          <ObsidianFolderSelector
            defaultPath={selectedPath}
            obsidianUrl={obsidianUrl}
            obsidianApiKey={obsidianApiKey}
            onPathChange={(path, isMdFile) => {
              selectedPath = path
              selectedIsMdFile = isMdFile
            }}
          />
        ),
        width: 600,
        icon: null,
        closable: true,
        maskClosable: true,
        centered: true,
        okButtonProps: { type: 'primary' },
        okText: i18n.t('chat.topics.export.obsidian_select_folder.btn'),
        onOk: () => {
          // 如果选择的是md文件，则使用选择的文件名而不是传入的标题
          const fileName = selectedIsMdFile ? selectedPath.split('/').pop()?.replace('.md', '') : title

          exportMarkdownToObsidian(fileName as string, markdown, selectedPath, selectedIsMdFile)
          resolve(true)
        },
        onCancel: () => {
          resolve(false)
        }
      })
    })
  } catch (error) {
    window.message.error(i18n.t('chat.topics.export.obsidian_fetch_failed'))
    console.error(error)
    return false
  }
}

const ObsidianExportPopup = {
  show: showObsidianExportDialog
}

export default ObsidianExportPopup
