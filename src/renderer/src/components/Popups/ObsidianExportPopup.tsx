import type { ObsidianProcessingMethod } from '@renderer/components/ObsidianExportDialog'
import { PopupContainer } from '@renderer/components/ObsidianExportDialog'
import { TopView } from '@renderer/components/TopView'
import type { Topic } from '@renderer/types'
import type { ExportableMessage } from '@renderer/types/messageExport'

interface ObsidianExportOptions {
  title: string
  processingMethod: (typeof ObsidianProcessingMethod)[keyof typeof ObsidianProcessingMethod]
  topic?: Topic
  message?: ExportableMessage
  messages?: ExportableMessage[]
  rawContent?: string
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
          processingMethod={options.processingMethod}
          topic={options.topic}
          message={options.message}
          messages={options.messages}
          rawContent={options.rawContent}
          obsidianTags={''}
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
