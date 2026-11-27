import { application } from '@application'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

@Injectable('RuntimeActivityService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PowerService'])
export class RuntimeActivityService extends BaseService {
  private readonly activities = new Map<symbol, Disposable>()

  begin(reason: string): Disposable {
    const token = Symbol(reason)
    const sleepHold = application.get('PowerService').preventSleep(reason)
    this.activities.set(token, sleepHold)
    return {
      dispose: () => {
        if (this.activities.delete(token)) sleepHold.dispose()
      }
    }
  }

  hasActiveTasks(): boolean {
    return this.activities.size > 0
  }

  protected onStop(): void {
    for (const hold of this.activities.values()) hold.dispose()
    this.activities.clear()
  }
}
