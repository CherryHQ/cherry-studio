import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { MODEL_ENDPOINT_OPTIONS } from './ModelDrawer'

const logger = loggerService.withContext('ProviderSettings:NewApiBatchAddModelPopup')

interface ShowParams {
  title: string
  provider: Provider
  batchModels: Model[]
}

type Props = ShowParams & PopupInjectedProps<Record<string, never>>

type FieldType = {
  provider: string
  group?: string
  endpointType?: EndpointType
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve, batchModels, open }) => {
  const [endpointType, setEndpointType] = useState<EndpointType>(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  const [submitting, setSubmitting] = useState(false)
  const { createModels } = useModelMutations()
  const { models: existingModels } = useModels({ providerId: provider.id })
  const { t } = useTranslation()

  const onCancel = () => {
    resolve({})
  }

  const onAddModel = async (values: FieldType) => {
    const existingModelApiIds = new Set(existingModels.map((model) => parseUniqueModelId(model.id).modelId))
    const modelsToAdd = batchModels.filter((model) => {
      const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
      return !existingModelApiIds.has(modelId)
    })

    if (modelsToAdd.length === 0) {
      toast.error(t('error.model.exists'))
      return false
    }

    const dtos: CreateModelDto[] = modelsToAdd.map((model) => {
      const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
      return {
        providerId: provider.id,
        modelId,
        name: model.name,
        group: model.group,
        endpointTypes: values.endpointType ? [values.endpointType] : undefined
      }
    })
    await createModels(dtos)
    return true
  }

  const onSubmit = async () => {
    try {
      setSubmitting(true)
      if (await onAddModel({ provider: provider.id, endpointType })) {
        resolve({})
      }
    } catch (error) {
      logger.error('Failed to batch add models', { providerId: provider.id, error })
      toast.error(t('settings.models.manage.sync_pull_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel()
        }
      }}>
      <DialogContent
        closeOnOverlayClick={false}
        className="gap-5 rounded-2xl border-border-muted bg-popover p-5 sm:max-w-md">
        <DialogHeader className="gap-1.5 pr-6">
          <DialogTitle className="text-foreground/90 text-sm leading-5">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground/80 text-sm leading-5">
            {t('settings.models.add.endpoint_type.tooltip')}
          </DialogDescription>
        </DialogHeader>
        <div className={drawerClasses.fieldList}>
          <div className="space-y-2">
            <label className="font-medium text-[13px] text-foreground/85">
              {t('settings.models.add.endpoint_type.label')}
            </label>
            <Select value={endpointType} onValueChange={(value) => setEndpointType(value as EndpointType)}>
              <SelectTrigger className={drawerClasses.selectTrigger}>
                <SelectValue placeholder={t('settings.models.add.endpoint_type.placeholder')} />
              </SelectTrigger>
              <SelectContent className={drawerClasses.selectContent}>
                {MODEL_ENDPOINT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {t(opt.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void onSubmit()}>
            {t('settings.models.add.add_model')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const NewApiBatchAddModelPopup = createPopup<ShowParams, Record<string, never>>(PopupContainer, { dismissResult: {} })

export default NewApiBatchAddModelPopup
