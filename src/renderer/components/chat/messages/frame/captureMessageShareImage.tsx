import { createRoot } from 'react-dom/client'
import type { Components } from 'streamdown'

import { AppMarkdown } from '@renderer/components/markdown'
import { exportService } from '@renderer/services/ExportService'
import type { MessageExportView } from '@renderer/types/messageExport'
import { toExportableCitations } from '@renderer/utils/message/citations'

import './messageShareImage.css'

const shareComponents = {
  code: ({ className, children }) => <code className={className}>{children}</code>
} satisfies Partial<Components>

export async function captureMessageShareImage(
  markdown: string,
  singleDollarMath: boolean,
  { parts, priorCitationParts }: Pick<MessageExportView, 'parts' | 'priorCitationParts'>
) {
  const { content } = toExportableCitations(markdown, parts, priorCitationParts, { singleDollarMath })
  const host = document.createElement('div')
  host.className = 'pointer-events-none fixed top-0 -left-[10000px]'
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  document.body.append(host)

  const { promise, resolve, reject } = Promise.withResolvers<HTMLDivElement>()
  const root = createRoot(host, { onUncaughtError: reject })
  try {
    root.render(
      <div
        ref={(element) => {
          if (element) resolve(element)
        }}
        className="message-share-image w-[672px] min-w-min p-6">
        <div className="rounded-xl border border-border bg-background p-8">
          <AppMarkdown singleDollarMath={singleDollarMath} components={shareComponents}>
            {content}
          </AppMarkdown>
        </div>
      </div>
    )

    return await exportService.captureScrollableAsDataUrl({ current: await promise }, '--message-share-background')
  } finally {
    root.unmount()
    host.remove()
  }
}
