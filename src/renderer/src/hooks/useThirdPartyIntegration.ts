import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useAppDispatch } from '@renderer/store'
import { useTranslation } from 'react-i18next'

export type IntegrationType = 'notion' | 'siyuan' | 'yuque' | 'joplin'

export interface IntegrationConfig {
  type: IntegrationType
  helpUrl: string
  fieldSetters: {
    [field: string]: any
  }
  connectionCheckConfig?: {
    requiredFields: string[]
    checkFunction: (values: Record<string, any>, t: any) => Promise<void>
  }
}

export const useThirdPartyIntegration = (config: IntegrationConfig, fieldValues: Record<string, any>) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { openMinapp } = useMinappPopup()

  const handleInputChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (config.fieldSetters[field]) {
      dispatch(config.fieldSetters[field](e.target.value))
    }
  }

  const handleInputBlur =
    (field: string, customHandler?: (value: string) => string) => (e: React.FocusEvent<HTMLInputElement>) => {
      let value = e.target.value

      if (customHandler) {
        value = customHandler(value)
      }

      if (config.fieldSetters[field]) {
        dispatch(config.fieldSetters[field](value))
      }
    }

  const handleSwitchChange = (field: string) => (checked: boolean) => {
    if (config.fieldSetters[field]) {
      dispatch(config.fieldSetters[field](checked))
    }
  }

  const handleConnectionCheck = async () => {
    if (!config.connectionCheckConfig) return

    for (const field of config.connectionCheckConfig.requiredFields) {
      if (!fieldValues[field]) {
        window.message.error(t(`settings.data.${config.type}.check.empty_${field}`))
        return
      }
    }

    await config.connectionCheckConfig.checkFunction(fieldValues, t)
  }

  const handleHelpClick = () => {
    openMinapp({
      id: `${config.type}-help`,
      name: `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Help`,
      url: config.helpUrl
    })
  }

  return {
    handleInputChange,
    handleInputBlur,
    handleSwitchChange,
    handleConnectionCheck,
    handleHelpClick
  }
}
