import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isDev } from '@main/core/platform'
import { stripMarkdownFormatting } from '@main/utils/searchSnippet'

import mockAnnouncements from './official-announcements.mock.json'

const logger = loggerService.withContext('OfficialAnnouncementService')
const SCHEDULE_ID = 'official-announcement:mock'

// Development fixtures stand in for the official API until its contract is available.
const fetchMockAnnouncements = async () => mockAnnouncements

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
