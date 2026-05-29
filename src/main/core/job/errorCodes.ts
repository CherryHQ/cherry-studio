/**
 * Job error code constants — main-process only.
 *
 * `JobManager` and `JobScheduleService` throw errors whose `.code` is one of
 * these string literals. The renderer observes errors via `JobSnapshot.error`
 * (a `JobError` shape carrying `code: string`); it consumes the code as an
 * opaque i18n key (`errors.jobs.${code.toLowerCase()}`) and never imports
 * this constant. Hence the dictionary lives in main rather than shared.
 */

export const JOB_ERROR_CODES = {
  UNKNOWN_TYPE: 'JOB_UNKNOWN_TYPE',
  PAYLOAD_TOO_LARGE: 'JOB_PAYLOAD_TOO_LARGE',
  CANCEL_REASON_TOO_LONG: 'JOB_CANCEL_REASON_TOO_LONG',
  SCHEDULE_NOT_FOUND_BY_NAME: 'JOB_SCHEDULE_NOT_FOUND_BY_NAME',
  SCHEDULE_NAME_REQUIRED: 'JOB_SCHEDULE_NAME_REQUIRED',
  SCHEDULE_NAME_INVALID: 'JOB_SCHEDULE_NAME_INVALID',
  SCHEDULE_NAME_CONFLICT: 'JOB_SCHEDULE_NAME_CONFLICT',
  SCHEDULE_SINGLETON_EXISTS: 'JOB_SCHEDULE_SINGLETON_EXISTS',
  HANDLER_TIMEOUT: 'JOB_HANDLER_TIMEOUT',
  HANDLER_THREW: 'JOB_HANDLER_THREW',
  CANCELLED: 'JOB_CANCELLED'
} as const
export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES]
