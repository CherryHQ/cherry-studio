import { application } from '@application'
import { isMac } from '@main/core/platform'
import {
  getScreenCapturePermissionStatus,
  openScreenCaptureSettings,
  requestScreenCapturePermission
} from '@main/utils/screenCapturePermission'
import { systemPreferences } from 'electron'

import { defineDoctorCheck } from '../types'

export const screenCapturePermission = defineDoctorCheck({
  id: 'permission-screen-capture',
  async run() {
    const status = getScreenCapturePermissionStatus()
    if (status === 'restricted')
      return {
        status: 'warn',
        attribution: 'user-fixable',
        detail: { variant: 'restricted' },
        actions: [],
        devMessage: 'Screen capture is restricted by system policy; contact the administrator'
      }
    if (status !== 'denied') return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'denied' },
      actions: [{ kind: 'fix', fixId: 'request' }],
      devMessage: 'macOS screen capture permission is denied',
      evidence: [{ key: 'status', value: status, dataClass: 'public' }]
    }
  },
  fixes: {
    async request() {
      await requestScreenCapturePermission()
      const status = getScreenCapturePermissionStatus()
      if (status === 'denied') openScreenCaptureSettings()
      return status === 'authorized'
        ? { status: 'fixed' }
        : { status: 'failed', message: 'Screen capture permission has not been granted' }
    }
  }
})

export const accessibilityPermission = defineDoctorCheck({
  id: 'permission-accessibility',
  async run() {
    if (!isMac || !application.get('PreferenceService').get('feature.selection.enabled')) return { status: 'pass' }
    if (systemPreferences.isTrustedAccessibilityClient(false)) return { status: 'pass' }
    return {
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'denied' },
      actions: [{ kind: 'fix', fixId: 'request' }],
      devMessage: 'Selection Assistant is enabled but macOS accessibility permission is denied',
      evidence: [
        { key: 'selectionAssistantEnabled', value: true, dataClass: 'public' },
        { key: 'trusted', value: false, dataClass: 'public' }
      ]
    }
  },
  fixes: {
    async request() {
      systemPreferences.isTrustedAccessibilityClient(true)
      return systemPreferences.isTrustedAccessibilityClient(false)
        ? { status: 'fixed' }
        : { status: 'failed', message: 'Accessibility permission has not been granted' }
    }
  }
})
