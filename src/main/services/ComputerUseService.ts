import { Mutex } from 'async-mutex'

import { application } from '@application'
import { ComputerUse, type ComputerUseClient, type PermissionStatus } from '@cherrystudio/computer-use'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

@Injectable('ComputerUseService')
@ServicePhase(Phase.WhenReady)
export class ComputerUseService extends BaseService {
  private readonly permissionMutex = new Mutex()
  private readonly shutdown = new AbortController()

  getPermissionStatus(): Promise<PermissionStatus> {
    return this.withPermissionSession((client) => client.getPermissionStatus({ signal: this.shutdown.signal }))
  }

  requestPermissions(ids: [string, ...string[]]): Promise<PermissionStatus> {
    return this.withPermissionSession((client) => client.requestPermissions({ ids }, { signal: this.shutdown.signal }))
  }

  protected async onStop(): Promise<void> {
    this.shutdown.abort()
    await this.permissionMutex.waitForUnlock()
  }

  private withPermissionSession(
    run: (client: ComputerUseClient) => Promise<PermissionStatus>
  ): Promise<PermissionStatus> {
    return this.permissionMutex.runExclusive(async () => {
      this.shutdown.signal.throwIfAborted()
      // Requests retain the helper until onboarding closes; later queries use fresh permission preflight.
      const client = await ComputerUse.start(
        { runtimePath: application.getPath('feature.computer_use.runtime') },
        { signal: this.shutdown.signal }
      )
      try {
        return await run(client)
      } finally {
        await client.close()
      }
    })
  }
}
