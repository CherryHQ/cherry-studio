import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { ModelSettingsConflict, ModelSettingsDecision } from '@shared/types/modelSettingsBackup'

type Decisions = Record<string, ModelSettingsDecision>

interface ConflictPopupProps extends PopupInjectedProps<Decisions | null> {
  conflicts: ModelSettingsConflict[]
}

const DECISIONS: ModelSettingsDecision[] = ['replace', 'skip']

const PopupContainer: React.FC<ConflictPopupProps> = ({ conflicts, open, resolve }) => {
  const { t } = useTranslation()
  // Skip is the default so an import never overwrites a row the user did not choose to replace.
  const [decisions, setDecisions] = useState<Decisions>(() =>
    Object.fromEntries(conflicts.map((conflict) => [conflict.key, 'skip' as const]))
  )

  const setAll = (decision: ModelSettingsDecision) =>
    setDecisions(Object.fromEntries(conflicts.map((conflict) => [conflict.key, decision])))

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && resolve(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.data.model_settings.conflicts_title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('settings.data.model_settings.conflicts_description')}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAll('replace')}>
            {t('settings.data.model_settings.replace_all')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAll('skip')}>
            {t('settings.data.model_settings.skip_all')}
          </Button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {conflicts.map((conflict) => (
            <li key={conflict.key} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm">{conflict.label}</div>
                <div className="text-muted-foreground text-xs">
                  {t(`settings.data.model_settings.conflict_${conflict.kind}`)}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {DECISIONS.map((decision) => {
                  const selected = decisions[conflict.key] === decision
                  return (
                    <Button
                      key={decision}
                      size="sm"
                      variant={selected ? 'secondary' : 'ghost'}
                      aria-pressed={selected}
                      onClick={() => setDecisions((prev) => ({ ...prev, [conflict.key]: decision }))}>
                      {t(`settings.data.model_settings.${decision}`)}
                    </Button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="emphasis" onClick={() => resolve(decisions)}>
            {t('settings.data.model_settings.import_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const ModelSettingsConflictPopup = createPopup<{ conflicts: ModelSettingsConflict[] }, Decisions | null>(
  PopupContainer,
  { dismissResult: null }
)

export default ModelSettingsConflictPopup
