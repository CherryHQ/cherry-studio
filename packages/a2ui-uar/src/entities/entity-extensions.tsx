import { ActionSchema, DynamicStringSchema } from '@prometheus-ags/a2ui-core/v0_9'
import { AnimatePresence, motion } from 'motion/react'
import type { FC, ReactNode } from 'react'
import * as z from 'zod'

import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { useUarI18n } from '../i18n'
import { resolvedAction, resolvedText } from '../lib/resolved'
import type { UarComponentProps } from '../react/types'

const action = z.object({ label: DynamicStringSchema, action: ActionSchema }).strict()
const message = z.object({ role: z.enum(['user', 'assistant', 'system']), content: DynamicStringSchema }).strict()
export const EntityDiffApi = {
  name: 'EntityDiff',
  schema: z
    .object({
      title: DynamicStringSchema.optional(),
      changes: z.array(
        z
          .object({
            field: DynamicStringSchema,
            before: DynamicStringSchema.optional(),
            after: DynamicStringSchema.optional(),
            operation: z.enum(['add', 'update', 'remove'])
          })
          .strict()
      ),
      actions: z.array(action).optional()
    })
    .strict()
}
export const EntityStreamApi = {
  name: 'EntityStream',
  schema: z
    .object({
      title: DynamicStringSchema.optional(),
      status: z.enum(['idle', 'streaming', 'complete', 'error']),
      items: z.array(DynamicStringSchema).optional(),
      message: DynamicStringSchema.optional(),
      retry: ActionSchema.optional()
    })
    .strict()
}
export const EntityApprovalApi = {
  name: 'EntityApproval',
  schema: z
    .object({
      title: DynamicStringSchema,
      summary: DynamicStringSchema.optional(),
      changes: z.array(DynamicStringSchema).optional(),
      approve: action,
      reject: action,
      pending: z.boolean().optional()
    })
    .strict()
}
export const EntityToolProviderApi = {
  name: 'EntityToolProvider',
  schema: z
    .object({
      title: DynamicStringSchema,
      description: DynamicStringSchema.optional(),
      status: z.enum(['available', 'running', 'unavailable']),
      actions: z.array(action).optional()
    })
    .strict()
}
export const EntityChatApi = {
  name: 'EntityChat',
  schema: z
    .object({
      title: DynamicStringSchema.optional(),
      messages: z.array(message),
      emptyMessage: DynamicStringSchema.optional(),
      error: DynamicStringSchema.optional(),
      retry: ActionSchema.optional()
    })
    .strict()
}
export const EntityCopilotApi = {
  name: 'EntityCopilot',
  schema: z
    .object({
      title: DynamicStringSchema,
      suggestions: z.array(action).optional(),
      messages: z.array(message).optional(),
      dismiss: ActionSchema.optional()
    })
    .strict()
}

function Shell({ name, title, children }: { name: string; title?: string; children: ReactNode }) {
  return (
    <Card data-a2ui-component={name}>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {title ? <h3 className="text-base font-semibold">{title}</h3> : null}
        {children}
      </CardContent>
    </Card>
  )
}
function Actions({ entries, disabled }: { entries?: Array<{ label: unknown; action: unknown }>; disabled?: boolean }) {
  const { t } = useUarI18n()
  return entries?.length ? (
    <div className="flex flex-wrap gap-2">
      {entries.map((entry, i) => (
        <Button key={i} variant="outline" disabled={disabled} onClick={resolvedAction(entry.action)}>
          {resolvedText(entry.label) ?? t('action')}
        </Button>
      ))}
    </div>
  ) : null
}
export const UarEntityDiff: FC<{ props: UarComponentProps<typeof EntityDiffApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  return (
    <Shell name="EntityDiff" title={resolvedText(props.title)}>
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <caption className="sr-only">{t('entityChanges')}</caption>
          <thead>
            <tr>
              <th>{t('field')}</th>
              <th>{t('before')}</th>
              <th>{t('after')}</th>
            </tr>
          </thead>
          <tbody>
            {props.changes.map((c, i) => (
              <tr key={i} data-operation={c.operation}>
                <th scope="row">{resolvedText(c.field)}</th>
                <td>{c.before ? resolvedText(c.before) : '—'}</td>
                <td>{c.after ? resolvedText(c.after) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Actions entries={props.actions} />
    </Shell>
  )
}
export const UarEntityStream: FC<{ props: UarComponentProps<typeof EntityStreamApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  const status = props.status === 'streaming' ? t('receiving') : t(props.status)
  return (
    <Shell name="EntityStream" title={resolvedText(props.title)}>
      <div role="status" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={props.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {status}
          </motion.p>
        </AnimatePresence>
        {props.message ? <p>{resolvedText(props.message)}</p> : null}
      </div>
      {props.items?.length ? (
        <ul>
          {props.items.map((item, i) => (
            <li key={i}>{resolvedText(item)}</li>
          ))}
        </ul>
      ) : null}
      {props.status === 'error' && props.retry ? (
        <Button onClick={resolvedAction(props.retry)}>{t('retry')}</Button>
      ) : null}
    </Shell>
  )
}
export const UarEntityApproval: FC<{ props: UarComponentProps<typeof EntityApprovalApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  return (
    <Shell name="EntityApproval" title={resolvedText(props.title)}>
      {props.summary ? <p>{resolvedText(props.summary)}</p> : null}
      <Actions disabled={props.pending} entries={[props.approve, props.reject]} />
      {props.pending ? <p role="status">{t('decisionPending')}</p> : null}
    </Shell>
  )
}
export const UarEntityToolProvider: FC<{ props: UarComponentProps<typeof EntityToolProviderApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  return (
    <Shell name="EntityToolProvider" title={resolvedText(props.title)}>
      <p role="status">{t(props.status)}</p>
      {props.description ? <p>{resolvedText(props.description)}</p> : null}
      <Actions disabled={props.status !== 'available'} entries={props.actions} />
    </Shell>
  )
}
function Conversation({ messages }: { messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: unknown }> }) {
  const { t } = useUarI18n()
  return messages?.length ? (
    <ol aria-label={t('conversation')}>
      {messages.map((m, i) => (
        <li key={i}>
          <span className="sr-only">{t(m.role)}: </span>
          {resolvedText(m.content)}
        </li>
      ))}
    </ol>
  ) : (
    <p>{t('noMessages')}</p>
  )
}
export const UarEntityChat: FC<{ props: UarComponentProps<typeof EntityChatApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  return (
    <Shell name="EntityChat" title={resolvedText(props.title)}>
      <Conversation messages={props.messages} />
      {props.error ? (
        <div role="alert">
          {resolvedText(props.error)}
          {props.retry ? <Button onClick={resolvedAction(props.retry)}>{t('retry')}</Button> : null}
        </div>
      ) : null}
    </Shell>
  )
}
export const UarEntityCopilot: FC<{ props: UarComponentProps<typeof EntityCopilotApi> }> = ({ props }) => {
  const { t } = useUarI18n()
  return (
    <Shell name="EntityCopilot" title={resolvedText(props.title)}>
      <Conversation messages={props.messages} />
      <Actions entries={props.suggestions} />
      {props.dismiss ? (
        <Button variant="ghost" onClick={resolvedAction(props.dismiss)}>
          {t('dismiss')}
        </Button>
      ) : null}
    </Shell>
  )
}
