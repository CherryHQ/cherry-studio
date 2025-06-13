import { ObsidianProcessingMethod, PopupContainer } from '@renderer/components/ObsidianExportDialog'
import { TopView } from '@renderer/components/TopView'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'

interface ObsidianExportOptions {
  title: string
  processingMethod: (typeof ObsidianProcessingMethod)[keyof typeof ObsidianProcessingMethod]
  topic?: Topic
  message?: Message
  messages?: Message[]
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
