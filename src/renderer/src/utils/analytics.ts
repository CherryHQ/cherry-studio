import googleAnalytics from '@analytics/google-analytics'
import Analytics from 'analytics'

import { version } from '../../../../package.json'

let analytics: ReturnType<typeof Analytics> | null = null

export function initAnalytics() {
  if (analytics) {
    return analytics
  }

  analytics = Analytics({
    app: 'cherry-studio',
    version,
    plugins: [
      googleAnalytics({
        measurementIds: ['G-YST80FC1ZC']
      })
    ]
  })

  return analytics
}

export function disableAnalytics() {
  analytics = null
}

export function track(eventName: string) {
  try {
    const instance = initAnalytics()
    instance?.track(eventName)
  } catch (error) {
    console.warn('[Analytics] Failed to track event:', error)
  }
}

export function page(pageName: string) {
  try {
    const instance = initAnalytics()
    instance?.page({
      title: pageName,
      path: pageName
    })
  } catch (error) {
    console.warn('[Analytics] Failed to track page view:', error)
  }
}

export default {
  track,
  page
}
