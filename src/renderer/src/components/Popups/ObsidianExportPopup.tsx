import ObsidianExportDialog from '@renderer/components/ObsidianExportDialog'
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
  return new Promise<boolean>((resolve) => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)

    const handleClose = (success: boolean) => {
      root.unmount()
      document.body.removeChild(div)
      resolve(success)
    }
    // 不再从store中获取tag配置
    root.render(
      <ObsidianExportDialog
        title={options.title}
        markdown={options.markdown}
        obsidianTags=""
        processingMethod={options.processingMethod}
        open={true}
        onClose={handleClose}
      />
    )
  })
}

export default {
  show: showObsidianExportDialog
}
