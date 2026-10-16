import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev } from '@main/core/platform'
import { stripMarkdownFormatting } from '@main/utils/searchSnippet'

const logger = loggerService.withContext('OfficialAnnouncementService')
const SCHEDULE_ID = 'official-announcement:mock'

// Development fixtures stand in for the official API until its contract is available.
const fetchMockAnnouncements = async () => [
  {
    id: 'notification-center-preview-v1',
    title: '[Mock] 官方公告接口联调',
    content: `# 官方公告预览

这是一条仅在开发环境显示的 Mock 数据，不是真实官方公告。

- 点击公告可以展开全文并标记为已读。
- 支持 **Markdown** 内容和通知历史。
- 官方接口完成后，将替换此 Mock 数据源。`
  },
  {
    id: 'notification-center-markdown-v1',
    title: '[Mock] 公告长内容预览示例',
    content: `# 公告内容展示示例

这条 Mock 公告用于检查长内容预览、全文展开和已读状态。列表中的内容会按已有规则限制长度，展开后可以查看完整内容。

| 展示项 | 状态 |
| --- | --- |
| 标题与摘要 | 可预览 |
| Markdown 正文 | 可展开 |
| 已读与删除 | 可操作 |

> 本内容仅用于开发联调。`
  }
]

@Injectable('OfficialAnnouncementService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['NotificationService', 'SchedulerService'])
export class OfficialAnnouncementService extends BaseService {
  private stopped = false

  protected onInit(): void {
    if (!isDev) return
    this.stopped = false
    const preferences = application.get('PreferenceService')
    const scheduler = application.get('SchedulerService')
    const configure = (enabled: boolean) => {
      scheduler.unregister(SCHEDULE_ID)
      if (enabled) scheduler.registerSchedule(SCHEDULE_ID, { kind: 'once', at: Date.now() + 5000 }, () => this.check())
    }
    this.registerDisposable(() => {
      this.stopped = true
      scheduler.unregister(SCHEDULE_ID)
    })
    this.registerDisposable(preferences.subscribeChange('app.notification.center.official.enabled', configure))
    configure(preferences.get('app.notification.center.official.enabled'))
  }

  private async check(): Promise<void> {
    try {
      for (const announcement of await fetchMockAnnouncements()) {
        if (this.stopped || !application.get('PreferenceService').get('app.notification.center.official.enabled'))
          return
        await application.get('NotificationService').publish({
          eventKey: `announcement:mock:${announcement.id}`,
          category: 'official',
          kind: 'announcement',
          title: announcement.title,
          message: stripMarkdownFormatting(announcement.content).replace(/\s+/g, ' ').trim().slice(0, 240),
          createdAt: Date.now(),
          target: { kind: 'announcement', content: announcement.content }
        })
      }
    } catch (error) {
      logger.warn('Failed to publish mock announcements', { error })
    }
  }
}
