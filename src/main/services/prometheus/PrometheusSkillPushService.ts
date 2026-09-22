import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { PrometheusPushState } from '@shared/types/prometheus'

import { pushSkillsToHome } from './pushSkills'

const logger = loggerService.withContext('PrometheusSkillPush')

/**
 * Owns *when* the skills are pushed into the home directory, and the last result.
 *
 * The copy itself lives in `pushSkills.ts`; this service is the lifecycle wrapper around it.
 *
 * It runs on every startup, not only the first: the bundled pack changes with each app update,
 * and a first-run-only push would leave `~/.agents` and `~/.claude` pinned to whatever shipped
 * the day the app was installed.
 *
 * Background phase: a skill copy must never delay a window appearing.
 */
@Injectable('PrometheusSkillPushService')
@ServicePhase(Phase.Background)
export class PrometheusSkillPushService extends BaseService {
  private pushState: PrometheusPushState = { status: 'idle' }

  protected async onInit(): Promise<void> {
    // The preference gates only the automatic push; the Settings button still works when it is
    // off, because pressing it is an explicit request.
    if (!application.get('PreferenceService').get('app.prometheus.home_push.enabled')) {
      logger.info('Startup skill push is disabled by preference')
      return
    }

    // Fire-and-forget inside an already-backgrounded phase: the result is read from Settings,
    // and nothing downstream waits on it.
    void this.push().catch((error) => {
      logger.error('The startup skill push failed', error as Error)
    })
  }

  getState(): PrometheusPushState {
    return this.pushState
  }

  async push(): Promise<PrometheusPushState> {
    this.pushState = { status: 'running' }
    this.pushState = await pushSkillsToHome()
    return this.pushState
  }
}
