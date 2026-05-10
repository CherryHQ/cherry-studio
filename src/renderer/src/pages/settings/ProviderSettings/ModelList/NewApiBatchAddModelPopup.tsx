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
import { TopView } from '@renderer/components/TopView'
import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE, type EndpointType, parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawerClasses } from '../shared/primitives/ProviderSettingsPrimitives'
import { MODEL_ENDPOINT_OPTIONS } from './ModelDrawer/helpers'

const logger = loggerService.withContext('ProviderSettings:NewApiBatchAddModelPopup')

interface ShowParams {
  title: string
  provider: Provider
  batchModels: Model[]
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

type FieldType = {
  provider: string
  group?: string
  endpointType?: EndpointType
}

const PopupContainer: React.FC<Props> = ({ title, provider, resolve, batchModels }) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const [endpointType, setEndpointType] = useState<EndpointType>(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  const [submitting, setSubmitting] = useState(false)
  const { createModels } = useModelMutations()
  const { models: existingModels } = useModels({ providerId: provider.id })
  const { t } = useTranslation()

  const closeWithResult = (data: any) => {
    if (resolvedRef.current) {
      return
    }
    resolvedRef.current = true
    setOpen(false)
    resolve(data)
  }

  const onCancel = () => {
    closeWithResult({})
  }

  const onAddModel = async (values: FieldType) => {
    const existingModelApiIds = new Set(existingModels.map((model) => parseUniqueModelId(model.id).modelId))
    const modelsToAdd = batchModels.filter((model) => {
      const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
      return !existingModelApiIds.has(modelId)
    })

    if (modelsToAdd.length === 0) {
      window.toast.error(t('error.model.exists'))
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
        closeWithResult({})
      }
    } catch (error) {
      logger.error('Failed to batch add models', { providerId: provider.id, error })
      window.toast.error(t('settings.models.manage.sync_pull_failed'))
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
      <DialogContent className="provider-settings-default-scope gap-5 rounded-2xl border-[color:var(--color-border-fg-muted)] bg-(--color-background) p-5 sm:max-w-md">
        <DialogHeader className="gap-1.5 pr-6">
          <DialogTitle className="text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
            {title}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--font-size-body-sm)] text-muted-foreground/80 leading-[var(--line-height-body-sm)]">
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

export default class NewApiBatchAddModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('NewApiBatchAddModelPopup')
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'NewApiBatchAddModelPopup'
      )
    })
  }
}
