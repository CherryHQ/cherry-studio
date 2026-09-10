import { SecretInput as UiSecretInput, type SecretInputProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type LocalizedSecretInputProps = Omit<SecretInputProps, 'showLabel' | 'hideLabel'> &
  Partial<Pick<SecretInputProps, 'showLabel' | 'hideLabel'>>

export function SecretInput({ showLabel, hideLabel, ...props }: LocalizedSecretInputProps) {
  const { t } = useTranslation()

  return (
    <UiSecretInput
      {...props}
      showLabel={showLabel ?? t('common.show_credential')}
      hideLabel={hideLabel ?? t('common.hide_credential')}
    />
  )
}
