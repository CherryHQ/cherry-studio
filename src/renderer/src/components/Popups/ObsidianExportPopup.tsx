import { PopupContainer } from '@renderer/components/ObsidianExportDialog'
import { TopView } from '@renderer/components/TopView'

interface ObsidianExportOptions {
  title: string
  markdown: string
  processingMethod: string | '3' // 默认新增（存在就覆盖）
}

export default class ObsidianExportPopup {
  static hide() {
    TopView.hide('ObsidianExportPopup')
  }
  static show(options: ObsidianExportOptions): Promise<boolean> {
    return new Promise((resolve) => {
      TopView.show(
        <PopupContainer
          title={options.title}
          markdown={options.markdown}
          obsidianTags={''}
          processingMethod={options.processingMethod}
          open={true}
          resolve={(v) => {
            resolve(v)
            ObsidianExportPopup.hide()
          }}
        />,
        'ObsidianExportPopup'
      )
    })
  }
}
