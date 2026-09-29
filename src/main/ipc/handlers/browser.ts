import { application } from '@application'
import type { browserRequestSchemas } from '@shared/ipc/schemas/browser'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const browserHandlers: IpcHandlersFor<typeof browserRequestSchemas> = {
  'browser.import.sources': async () => application.get('BrowserSessionService').listImportSources(),
  'browser.import.run': async (options, { senderId }) => {
    const window = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    if (!window) throw new Error('Browser import requires an app window')
    return application.get('BrowserSessionService').pickAndImport(options, window)
  },
  'browser.data.clear': async ({ kind }) => application.get('BrowserSessionService').clearData(kind),
  'browser.pane.attach': async ({ sessionId, scope, webviewId }, { senderId }) =>
    application
      .get('BrowserSessionService')
      [scope === 'topic' ? 'topicBrowser' : 'agentBrowser'].attach(sessionId, webviewId, senderId),
  'browser.cursor.present': async ({ sessionId, scope, tabId, presented }, { senderId }) =>
    application
      .get('BrowserSessionService')
      [scope === 'topic' ? 'topicBrowser' : 'agentBrowser'].getCursor(sessionId, tabId, senderId)
      ?.setPresented(presented),
  'browser.cursor.arrive': async (arrival, { senderId }) =>
    application
      .get('BrowserSessionService')
      [arrival.scope === 'topic' ? 'topicBrowser' : 'agentBrowser'].getCursor(
        arrival.sessionId,
        arrival.tabId,
        senderId
      )
      ?.arrive(arrival),
  'browser.pane.detach': async ({ sessionId, scope, tabId }, { senderId }) =>
    application
      .get('BrowserSessionService')
      [scope === 'topic' ? 'topicBrowser' : 'agentBrowser'].detach(sessionId, tabId, senderId)
}
