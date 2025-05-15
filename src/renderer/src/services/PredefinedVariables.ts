import store from '@renderer/store'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import i18next from 'i18next'

dayjs.extend(utc)
dayjs.extend(timezone)

const t = (key: string, options?: Record<string, any>) => i18next.t(key, options)

export type VariableGroup = {
  id: string
  name: string
  variables: VariableDefinition[]
}

export type VariableDefinition = {
  id: string
  name: string
  description: string
  getValue: () => string | number | Promise<string | number | null>
}

class PredefinedVariablesService {
  private groups: VariableGroup[] = []

  constructor() {
    this.initializeGroups()
  }

  private initializeGroups(): void {
    const dateGroup: VariableGroup = {
      id: 'date',
      name: t('variable.group.date'),
      variables: [
        {
          id: 'date.current_time',
          name: 'date.current_time',
          description: t('variable.variables.date.current_time'),
          getValue: () => dayjs().format('HH:mm:ss')
        },
        {
          id: 'date.current_year',
          name: 'date.current_year',
          description: t('variable.variables.date.current_year'),
          getValue: () => dayjs().format('YYYY')
        },
        {
          id: 'date.current_month',
          name: 'date.current_month',
          description: t('variable.variables.date.current_month'),
          getValue: () => dayjs().format('MM')
        },
        {
          id: 'date.current_day',
          name: 'date.current_day',
          description: t('variable.variables.date.current_day'),
          getValue: () => dayjs().format('DD')
        },
        {
          id: 'date.current_datetime',
          name: 'date.current_datetime',
          description: t('variable.variables.date.current_datetime'),
          getValue: () => dayjs().format('YYYY-MM-DD HH:mm:ss')
        },
        {
          id: 'date.current_timestamp',
          name: 'date.current_timestamp',
          description: t('variable.variables.date.current_timestamp'),
          getValue: () => Date.now()
        },
        {
          id: 'date.current_timezone',
          name: 'date.current_timezone',
          description: t('variable.variables.date.current_timezone'),
          getValue: () => Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      ]
    }
    const localGroup: VariableGroup = {
      id: 'local',
      name: t('variable.group.local'),
      variables: [
        {
          id: 'local.os_info',
          name: 'local.os_info',
          description: t('variable.variables.local.os_info'),
          getValue: async () => {
            try {
              const osInfo = await window.api.system.getOsInfo()
              return `${osInfo.platform} ${osInfo.release}`
            } catch (error) {
              window.message.error({
                content: t('message.error.variable.system_info'),
                key: 'predefined-variables'
              })
              throw new Error(t('message.error.variable.system_info'))
            }
          }
        },
        {
          id: 'local.hardware_info',
          name: 'local.hardware_info',
          description: t('variable.variables.local.hardware_info'),
          getValue: async () => {
            try {
              const hwInfo = await window.api.system.getHardwareInfo()
              return `CPU: ${hwInfo.cpuModel}, Memory: ${Math.round(hwInfo.totalMemory / (1024 * 1024 * 1024))}GB`
            } catch (error) {
              window.message.error({
                content: t('message.error.variable.system_info'),
                key: 'predefined-variables'
              })
              throw new Error(t('message.error.variable.system_info'))
            }
          }
        }
      ]
    }

    const userGroup: VariableGroup = {
      id: 'user',
      name: t('variable.group.user'),
      variables: [
        {
          id: 'user.name',
          name: 'user.name',
          description: t('variable.variables.user.name'),
          getValue: () => store.getState().settings.userName || 'User'
        }
      ]
    }
    this.groups = [userGroup, dateGroup, localGroup]
  }

  public getAllGroups(): VariableGroup[] {
    return this.groups
  }
  public getGroupById(groupId: string): VariableGroup | undefined {
    return this.groups.find((group) => group.id === groupId)
  }

  public async getVariableValue(variableName: string): Promise<string | number | undefined> {
    if (!variableName || typeof variableName !== 'string') {
      return undefined
    }

    const parts = variableName.split('.')
    if (parts.length < 2) {
      return undefined
    }

    const groupId = parts[0]
    const group = this.getGroupById(groupId)
    if (!group) {
      return undefined
    }

    const variable = group.variables.find((v) => v.id === variableName)
    if (!variable) {
      return undefined
    }

    try {
      const value = await variable.getValue()
      return value === null ? undefined : value
    } catch (error) {
      window.message.error({
        content: t('message.error.variable.get_value', {
          variableName
        }),
        key: 'predefined-variables'
      })

      console.error(`Failed to get value for variable ${variableName}:`, error)
      return undefined
    }
  }

  public async getAllVariablesAsObject(): Promise<Record<string, string | number>> {
    const result: Record<string, string | number> = {}

    for (const group of this.groups) {
      for (const variable of group.variables) {
        try {
          const value = await variable.getValue()
          if (value !== null) {
            result[variable.name] = value
          }
        } catch (error) {
          window.message.error({
            content: t('message.error.variable.failed_to_get_value', {
              variableName: variable.name
            }),
            key: 'predefined-variables'
          })

          console.error(`Failed to get value for variable ${variable.name}:`, error)

          result[variable.name] = t('message.error.variable.get_value', {
            variableName: variable.name
          })
        }
      }
    }

    return result
  }

  public async processText(text: string): Promise<string> {
    if (!text) {
      return text
    }

    const variables = await this.getAllVariablesAsObject()
    let processedText = text

    for (const [name, value] of Object.entries(variables)) {
      const pattern = new RegExp(`{{${name}}}`, 'g')
      processedText = processedText.replace(pattern, String(value))
    }

    return processedText
  }
}

const predefinedVariables = new PredefinedVariablesService()
export default predefinedVariables
