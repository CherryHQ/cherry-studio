import { loggerService } from '@logger'
import type { DiagnosticReportConfig } from '@renderer/components/ErrorDetailModal'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { SerializedError } from '@renderer/types/error'
import type { DiagnosisContext } from '@renderer/utils/errorDiagnosis'
import type { AppErrorContext } from '@shared/types/appError'
import type { DoctorSubjectRef } from '@shared/types/doctor'
import type { DoctorAgentIncident } from '@shared/types/doctorAgent'
import { isAppErrorContext, summarizeErrorParams } from '@shared/utils/appError'

import {
  appErrorContextService,
  contextFromUnknown,
  diagnosticErrorFromUnknown,
  operationIncident,
  operationSubject
} from './AppErrorContextService'
import { degradedFaultHostService } from './DegradedFaultHostService'
import { toast } from './toast'

const logger = loggerService.withContext('AppErrorDetailService')

/** Chromium emits this when layout observers deliver late. It is not an application fault. */
function isResizeObserverNoise(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.includes('ResizeObserver loop')
}

export interface InlineErrorDetailInput {
  readonly error: unknown
  readonly source: string
  readonly operation: string
  readonly message?: string
  readonly providerId?: string
  readonly modelId?: string
  readonly recordId?: string
  readonly imageOnly?: boolean
  readonly params?: Readonly<Record<string, unknown>>
  readonly allowParams?: readonly string[]
}

function explicitDetailMessage(error: unknown, explicit?: string): string | undefined {
  if (explicit && explicit.trim().length > 0) return explicit
  if (typeof error === 'string' && error.trim().length > 0) return error
  return undefined
}

/** Build one detail request without pulling schema code into a fallback's static graph. */
export function buildInlineErrorDetailRequest(input: InlineErrorDetailInput): AppErrorDetailRequest {
  const summary = summarizeErrorParams(input.params, input.allowParams)
  const shown = explicitDetailMessage(input.error, input.message)
  const context = contextFromUnknown(input.error, {
    source: input.source,
    operation: input.operation,
    ...(shown ? { message: shown } : {}),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.recordId ? { recordId: input.recordId } : {}),
    ...(input.imageOnly ? { imageOnly: true } : {}),
    ...(summary ? { params: summary } : {})
  })
  const serializedError = diagnosticErrorFromUnknown(input.error)
  const explicit = input.message?.trim()
  return {
    context,
    ...(serializedError ? { error: serializedError } : {}),
    ...(explicit ? { localizedErrorMessage: explicit } : {})
  }
}

/** Visible explanation. Context text is technical evidence, so only an explicit caller summary is shown. */
function translatedExplanation(request: AppErrorDetailRequest): string {
  const explicit = request.localizedErrorMessage?.trim()
  if (explicit) return explicit
  return i18n.t('error.unexpected')
}

function pushUnique(parts: string[], value: string | null | undefined): void {
  const text = value?.trim()
  if (!text || parts.includes(text)) return
  parts.push(text)
}

/** Raw cause kept beside the localized wrapper when no detail dialog can open. */
function degradedFaultText(request: AppErrorDetailRequest): string {
  const summary = translatedExplanation(request)
  const parts: string[] = []
  pushUnique(parts, request.context.message)
  const errorMessage = request.error?.message?.trim()
  if (errorMessage && errorMessage !== request.context.message.trim()) {
    const errorName = request.error?.name?.trim()
    pushUnique(parts, errorName ? `${errorName}: ${errorMessage}` : errorMessage)
  }
  pushUnique(parts, request.error?.stack)
  pushUnique(parts, request.context.stack)
  if (typeof request.context.statusCode === 'number') pushUnique(parts, String(request.context.statusCode))
  pushUnique(parts, request.context.responseBody)
  const raw = parts.join('\n')
  if (!raw || raw === summary) return summary
  return `${summary}\n\n${raw}`
}

function faultSummary(operation: string): string {
  if (operation === 'window.unhandledrejection' || operation === 'process.unhandledRejection') {
    return i18n.t('error.unhandled_rejection')
  }
  if (operation === 'screenshot.capture') {
    return i18n.t('error.screenshot_failed')
  }
  return i18n.t('error.unexpected')
}

export interface AppErrorDetailRequest {
  readonly context: AppErrorContext
  readonly subject?: DoctorSubjectRef
  readonly incident?: DoctorAgentIncident
  readonly error?: SerializedError
  readonly localizedErrorMessage?: string
  readonly diagnosisContext?: DiagnosisContext
  readonly diagnosticReport?: DiagnosticReportConfig
}

export type AppErrorDetailOpenResult = 'opened' | 'busy' | 'failed'

class AppErrorDetailService {
  private detailReserved = false

  private showDetailOpenRetry(request: AppErrorDetailRequest): void {
    toast.error({
      title: i18n.t('error.detail_open_failed'),
      data: { suppressDetail: true },
      timeout: 0,
      action: {
        label: i18n.t('common.retry'),
        onClick: () => {
          void this.openAppErrorDetail(request)
        }
      }
    })
  }

  /**
   * Open the one error-detail dialog. A dialog the user is already reading stays put.
   * The heavy detail module loads only when a detail is actually opened.
   * `busy` means that dialog was kept. `failed` is a local retry, not another detail entry.
   */
  async openAppErrorDetail(request: AppErrorDetailRequest): Promise<AppErrorDetailOpenResult> {
    if (this.detailReserved) return 'busy'
    this.detailReserved = true
    try {
      const { isErrorDetailHostMounted, showErrorDetailPopup } = await import('@renderer/components/ErrorDetailModal')
      if (!isErrorDetailHostMounted()) {
        this.detailReserved = false
        if (degradedFaultHostService.presentDegradedFault(degradedFaultText(request))) return 'opened'
        this.showDetailOpenRetry(request)
        return 'failed'
      }
      const pending = showErrorDetailPopup({
        errorContext: request.context,
        subject: request.subject ?? operationSubject(request.context),
        incident: request.incident ?? operationIncident(request.context),
        error: request.error,
        localizedErrorMessage: translatedExplanation(request),
        diagnosisContext: request.diagnosisContext ?? {
          errorSource: request.context.source,
          ...(request.context.providerId ? { providerId: request.context.providerId } : {}),
          ...(request.context.modelId ? { modelId: request.context.modelId } : {})
        },
        diagnosticReport: request.diagnosticReport
      })
      if (!pending) {
        this.detailReserved = false
        return 'busy'
      }
      void pending.finally(() => {
        this.detailReserved = false
      })
      return 'opened'
    } catch (error) {
      this.detailReserved = false
      logger.error('Failed to open error details', error as Error)
      this.showDetailOpenRetry(request)
      return 'failed'
    }
  }

  resetAppErrorDetailForTests(): void {
    this.detailReserved = false
  }
}

export const appErrorDetailService = new AppErrorDetailService()

export function toastAppError(
  message: string,
  error: unknown,
  fields: {
    readonly source: string
    readonly operation: string
    readonly providerId?: string
    readonly modelId?: string
    readonly recordId?: string
    readonly imageOnly?: boolean
    readonly params?: Readonly<Record<string, unknown>>
    readonly allowParams?: readonly string[]
  }
): string {
  const params = summarizeErrorParams(fields.params, fields.allowParams)
  const context = contextFromUnknown(error, {
    source: fields.source,
    operation: fields.operation,
    message,
    ...(fields.providerId ? { providerId: fields.providerId } : {}),
    ...(fields.modelId ? { modelId: fields.modelId } : {}),
    ...(fields.recordId ? { recordId: fields.recordId } : {}),
    ...(fields.imageOnly ? { imageOnly: true } : {}),
    ...(params ? { params } : {})
  })
  const serializedError = diagnosticErrorFromUnknown(error)
  return toast.error({
    title: message,
    cause: error,
    data: {
      errorContext: context,
      localizedErrorMessage: message,
      ...(serializedError ? { serializedError } : {})
    },
    key: context.id
  })
}

export function presentUncaught(
  error: unknown,
  source: 'window.error' | 'window.unhandledrejection',
  delivery: 'local' | 'handoff'
): void {
  if (isResizeObserverNoise(error) || !appErrorContextService.rememberUncaught(error)) return
  const summary = faultSummary(source)
  const context = contextFromUnknown(error, { source, operation: source })
  if (delivery === 'handoff') {
    void ipcApi.request('app.error.handoff', context).catch((handoffError) => {
      logger.error('Failed to hand off a window error', handoffError as Error)
      // These windows have no toast host. A native dialog is the visible fallback.
      return ipcApi.request('app.error.degraded', context).catch((degradedError) => {
        logger.error('Failed to present a handed-off error locally', degradedError as Error)
      })
    })
    return
  }
  const serializedError = diagnosticErrorFromUnknown(error)
  toast.error({
    title: summary,
    cause: error,
    data: {
      errorContext: context,
      localizedErrorMessage: summary,
      ...(serializedError ? { serializedError } : {})
    },
    key: context.id,
    timeout: 0
  })
}

export function presentHandedOffError(context: AppErrorContext): void {
  if (!isAppErrorContext(context)) return
  const summary = faultSummary(context.operation)
  toast.error({
    title: summary,
    data: { errorContext: context, localizedErrorMessage: summary },
    key: context.id,
    timeout: 0
  })
}
