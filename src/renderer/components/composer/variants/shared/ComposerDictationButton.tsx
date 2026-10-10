import { Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { useComposerToolLauncherController } from '@renderer/components/composer/ComposerToolRuntime'
import type { QuickPanelInputAdapter } from '@renderer/components/QuickPanel'

import { COMPOSER_SEND_ACCESSORY_BUTTON_CLASS } from './ComposerControlScaffolding'

export function ComposerDictationButton({ inputAdapter }: { inputAdapter?: QuickPanelInputAdapter }) {
  const { t } = useTranslation()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const launcher = getLaunchers('root-panel').find((item) => item.id === 'dictation')
  const label = launcher?.label ?? t('chat.input.dictation.action.start')

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {launcher?.active && launcher.suffix ? (
        <span className="text-xs text-muted-foreground tabular-nums">{launcher.suffix}</span>
      ) : null}
      <Tooltip
        content={
          <>
            {label}
            {launcher?.description ? <div role="status">{launcher.description}</div> : null}
          </>
        }>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={COMPOSER_SEND_ACCESSORY_BUTTON_CLASS}
          aria-label={typeof label === 'string' ? label : undefined}
          data-active={launcher?.active || undefined}
          disabled={!launcher || launcher.disabled}
          onClick={() => launcher && dispatchLauncher(launcher, { source: 'root-panel', inputAdapter })}>
          {launcher?.icon ?? <Mic />}
        </Button>
      </Tooltip>
    </div>
  )
}
