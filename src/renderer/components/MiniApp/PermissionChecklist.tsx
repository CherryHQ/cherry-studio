import { Checkbox, InfoTooltip, Tooltip } from '@cherrystudio/ui'
import {
  groupPermissionsByNamespace,
  permissionLabel,
  permissionLeafLabel,
  permissionNamespaceDescription,
  permissionNamespaceTitle
} from '@renderer/utils/miniAppPermission'
import { cn } from '@renderer/utils/style'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export interface PermissionLeafItem {
  key: string
  checked: boolean
  /** A condition of running, not a choice: shown ticked and fixed. */
  fixed: boolean
}

/**
 * The Android-style permission list shared by the consent card and the detail panel: one
 * namespace per row — title, an (i) for what it means, then its leaves inline, each a
 * checkbox + label unit. Technical names stay out of the text and appear on hover.
 */
export const PermissionChecklist: FC<{
  items: PermissionLeafItem[]
  disabled?: boolean
  onToggle: (key: string, on: boolean) => void
  /** The declared host allowlist — the scope of `network.*`, listed beside that title, never a grant of its own. */
  hosts?: readonly string[]
  emptyText?: string
  testId?: string
}> = ({ items, disabled, onToggle, hosts, emptyText, testId }) => {
  const { t } = useTranslation()
  const byKey = new Map(items.map((item) => [item.key, item]))
  return (
    <ul data-testid={testId} className="flex flex-col gap-3">
      {items.length === 0 ? (
        <li className="text-muted-foreground text-xs">{emptyText}</li>
      ) : (
        groupPermissionsByNamespace(items.map((item) => item.key)).map(({ namespace, leaves }) => (
          <li key={namespace} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm">{permissionNamespaceTitle(t, namespace)}</span>
              <InfoTooltip content={permissionNamespaceDescription(t, namespace)} iconProps={{ size: 14 }} />
              {namespace === 'network' && hosts && hosts.length > 0 && (
                <Tooltip
                  content={
                    <div className="flex flex-col gap-0.5">
                      {hosts.map((host) => (
                        <span key={host}>{host}</span>
                      ))}
                    </div>
                  }>
                  <span className="ml-1 cursor-default text-muted-foreground text-xs underline decoration-dotted underline-offset-2">
                    {t('miniApp.permission.allowed_hosts')}
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {leaves.map((leaf) => {
                const item = byKey.get(leaf)!
                return (
                  <Tooltip key={leaf} content={leaf}>
                    <label
                      className={cn(
                        // Block-level on purpose: an inline-flex label sits on the line's baseline, and an empty
                        // (unticked) checkbox has a different baseline from a ticked one — the row would jump.
                        'flex items-center gap-1.5 text-sm',
                        item.fixed ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'
                      )}>
                      <Checkbox
                        size="sm"
                        checked={item.checked}
                        disabled={disabled || item.fixed}
                        // The technical id would OVERRIDE the visible label for screen-reader
                        // and voice-control users (WCAG 2.5.3), and the visible label alone is
                        // ambiguous — "Read", "Write" and "Delete" each name two leaves in
                        // different namespaces. The qualified form contains the visible word.
                        aria-label={permissionLabel(t, leaf)}
                        onCheckedChange={(checked) => onToggle(leaf, checked === true)}
                      />
                      <span>{permissionLeafLabel(t, leaf)}</span>
                    </label>
                  </Tooltip>
                )
              })}
            </div>
          </li>
        ))
      )}
    </ul>
  )
}
