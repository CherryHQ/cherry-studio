import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Textarea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { CustomCliErrorCode } from '@shared/types/codeCli'

/**
 * Registration fields for a user-defined Code CLI executable (issue #19966):
 * path picker + argument draft + a validation status line. The status line
 * shows the resolved path and validation state only, never environment data.
 * Validation itself runs in Main through code_cli.validate_custom_executable;
 * Main re-validates on save and before each launch.
 */

type ValidationState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; resolvedPath: string }
  | { status: 'error'; code: CustomCliErrorCode }

type AgentCustomCliSectionProps = {
  executable: string
  argsText: string
  onExecutableChange: (value: string) => void
  onArgsTextChange: (value: string) => void
  disabled?: boolean
}

export function AgentCustomCliSection({
  executable,
  argsText,
  onExecutableChange,
  onArgsTextChange,
  disabled
}: AgentCustomCliSectionProps) {
  const { t } = useTranslation()
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' })
  const requestSeq = useRef(0)

  useEffect(() => {
    const candidate = executable.trim()
    if (!candidate) {
      setValidation({ status: 'idle' })
      return
    }
    const seq = ++requestSeq.current
    setValidation({ status: 'checking' })
    const timer = setTimeout(() => {
      void ipcApi
        .request('code_cli.validate_custom_executable', { executable: candidate })
        .then((result) => {
          if (requestSeq.current !== seq) return
          setValidation(
            result.ok
              ? { status: 'ok', resolvedPath: result.resolvedPath ?? candidate }
              : { status: 'error', code: result.code ?? 'missing' }
          )
        })
        .catch(() => {
          // A transport failure is not a validation verdict; leave the status neutral.
          if (requestSeq.current === seq) setValidation({ status: 'idle' })
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [executable])

  const browse = async () => {
    const picked = await ipcApi.request('code_cli.pick_custom_executable')
    if (picked) onExecutableChange(picked)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={executable}
          onChange={(event) => onExecutableChange(event.target.value)}
          placeholder={t('library.config.agent.field.custom_cli.executable_placeholder')}
          disabled={disabled}
          aria-label={t('library.config.agent.field.custom_cli.label')}
        />
        <Button type="button" variant="outline" disabled={disabled} onClick={() => void browse()}>
          {t('library.config.agent.field.custom_cli.browse')}
        </Button>
      </div>
      {validation.status === 'checking' && (
        <p className="text-muted-foreground text-xs">{t('library.config.agent.field.custom_cli.validation.checking')}</p>
      )}
      {validation.status === 'ok' && (
        <p className="text-muted-foreground text-xs">
          {t('library.config.agent.field.custom_cli.validation.ok', { path: validation.resolvedPath })}
        </p>
      )}
      {validation.status === 'error' && (
        <p className="text-destructive text-xs">
          {t(`library.config.agent.field.custom_cli.validation.${validation.code}`)}
        </p>
      )}
      <Textarea.Input
        value={argsText}
        onValueChange={onArgsTextChange}
        placeholder={t('library.config.agent.field.custom_cli.args_placeholder')}
        rows={3}
        disabled={disabled}
        aria-label={t('library.config.agent.field.custom_cli.args_label')}
      />
      <p className="text-muted-foreground text-xs">{t('library.config.agent.field.custom_cli.args_help')}</p>
    </div>
  )
}
