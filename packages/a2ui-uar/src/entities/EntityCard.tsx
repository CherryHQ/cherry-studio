import type { FC } from 'react'

import { Button } from '../components/ui/button'
import { Card as UiCard, CardContent } from '../components/ui/card'
import { cn } from '../lib/cn'
import { resolvedAction, resolvedText } from '../lib/resolved'
import type { UarComponentProps } from '../react/types'
import type { EntityCardApi } from './entity-card-api'

type EntityCardProps = UarComponentProps<typeof EntityCardApi>

const SYNC_ORIGIN_LABEL: Record<string, string> = {
  server: 'Synced',
  client: 'Local',
  optimistic: 'Pending'
}

/** `EntityCard` render implementation — see `entity-card-api.ts` for the schema and naming-alignment rationale. */
export const UarEntityCard: FC<{ props: EntityCardProps }> = ({ props }) => {
  return (
    <UiCard data-a2ui-component="EntityCard" data-entity-type={props.entityType} data-entity-id={props.entityId}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">{props.title}</h3>
            {props.subtitle ? <p className="text-sm text-muted-foreground">{props.subtitle}</p> : null}
          </div>
          {props.syncOrigin ? (
            <span
              data-a2ui-entity-sync-origin={props.syncOrigin}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                props.syncOrigin === 'optimistic'
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
                  : props.syncOrigin === 'client'
                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              )}>
              {SYNC_ORIGIN_LABEL[props.syncOrigin]}
            </span>
          ) : null}
        </div>

        {props.fields?.length ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {props.fields.map((field, index) => (
              // A2UI field entries carry no id of their own (they are display-only
              // data, not addressable child components), so position is the only
              // stable key available here.
              <div key={`${resolvedText(field.label)}-${index}`} className="contents">
                <dt className="text-muted-foreground">{resolvedText(field.label)}</dt>
                <dd>{resolvedText(field.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {props.actions?.length ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {props.actions.map((entry, index) => (
              <Button
                key={`${resolvedText(entry.label)}-${index}`}
                variant="outline"
                onClick={() => resolvedAction(entry.action)()}>
                {resolvedText(entry.label)}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </UiCard>
  )
}
