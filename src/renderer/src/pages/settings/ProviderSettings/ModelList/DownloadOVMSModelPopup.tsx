import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { useTimer } from '@renderer/hooks/useTimer'
import type { Provider } from '@shared/data/types/provider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('OVMSClient')
const HUGGINGFACE_SOURCE_VALUE = '__huggingface__'

interface ShowParams {
  title: string
  provider: Provider
}

interface Props extends ShowParams {
  resolve: (data: any) => unknown
}

type FieldType = {
  modelName: string
  modelId: string
  modelSource: string
  task: string
}

interface PresetModel {
  modelId: string
  modelName: string
  modelSource: string
  task: string
  label: string
}

const PRESET_MODELS: PresetModel[] = [
  {
    modelId: 'OpenVINO/Qwen3-4B-int4-ov',
    modelName: 'Qwen3-4B-int4-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'text_generation',
    label: 'Qwen3-4B-int4-ov (Text Generation)'
  },
  {
    modelId: 'OpenVINO/Qwen3-8B-int4-ov',
    modelName: 'Qwen3-8B-int4-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'text_generation',
    label: 'Qwen3-8B-int4-ov (Text Generation)'
  },
  {
    modelId: 'OpenVINO/bge-base-en-v1.5-fp16-ov',
    modelName: 'bge-base-en-v1.5-fp16-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'embeddings',
    label: 'bge-base-en-v1.5-fp16-ov (Embeddings)'
  },
  {
    modelId: 'OpenVINO/bge-reranker-base-fp16-ov',
    modelName: 'bge-reranker-base-fp16-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'rerank',
    label: 'bge-reranker-base-fp16-ov (Rerank)'
  },
  {
    modelId: 'OpenVINO/DeepSeek-R1-Distill-Qwen-7B-int4-ov',
    modelName: 'DeepSeek-R1-Distill-Qwen-7B-int4-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'text_generation',
    label: 'DeepSeek-R1-Distill-Qwen-7B-int4-ov (Text Generation)'
  },
  {
    modelId: 'OpenVINO/stable-diffusion-v1-5-int8-ov',
    modelName: 'stable-diffusion-v1-5-int8-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'image_generation',
    label: 'stable-diffusion-v1-5-int8-ov (Image Generation)'
  },
  {
    modelId: 'OpenVINO/FLUX.1-schnell-int4-ov',
    modelName: 'FLUX.1-schnell-int4-ov',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'image_generation',
    label: 'FLUX.1-schnell-int4-ov (Image Generation)'
  }
]

const PopupContainer: React.FC<Props> = ({ title, resolve }) => {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [cancelled, setCancelled] = useState(false)
  const [formValues, setFormValues] = useState<FieldType>({
    modelId: '',
    modelName: '',
    modelSource: 'https://www.modelscope.cn/models',
    task: 'text_generation'
  })
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const { setIntervalTimer, clearIntervalTimer, setTimeoutTimer } = useTimer()

  const updateField = <K extends keyof FieldType>(field: K, value: FieldType[K]) => {
    setFormValues((current) => ({ ...current, [field]: value }))
  }

  const startFakeProgress = () => {
    setProgress(0)
    setIntervalTimer(
      'progress',
      () => {
        setProgress((prev) => {
          if (prev >= 95) {
            return prev // Stop at 95% until actual completion
          }
          // Simulate realistic download progress with slowing speed
          const increment =
            prev < 30
              ? Math.random() * 1 + 0.25
              : prev < 60
                ? Math.random() * 0.5 + 0.125
                : Math.random() * 0.25 + 0.03125

          return Math.min(prev + increment, 95)
        })
      },
      500
    )
  }

  const stopFakeProgress = (complete = false) => {
    clearIntervalTimer('progress')
    if (complete) {
      setProgress(100)
      // Reset progress after a short delay
      setTimeoutTimer('progress-reset', () => setProgress(0), 1500)
    } else {
      setProgress(0)
    }
  }

  const handlePresetSelect = (value: string) => {
    const selectedPreset = PRESET_MODELS.find((model) => model.modelId === value)
    if (selectedPreset) {
      setFormValues({
        modelId: selectedPreset.modelId,
        modelName: selectedPreset.modelName,
        modelSource: selectedPreset.modelSource,
        task: selectedPreset.task
      })
    }
  }

  const handleModelIdChange = (value: string) => {
    if (value) {
      // Extract model name from model ID (part after last '/')
      const lastSlashIndex = value.lastIndexOf('/')
      if (lastSlashIndex !== -1 && lastSlashIndex < value.length - 1) {
        const modelName = value.substring(lastSlashIndex + 1)
        updateField('modelName', modelName)
      }
    }
  }

  const onCancel = async () => {
    if (loading) {
      // Stop the download
      try {
        setCancelled(true) // Mark as cancelled by user
        logger.info('Stopping download...')
        await window.api.ovms.stopAddModel()
        stopFakeProgress(false)
        setLoading(false)
      } catch (error) {
        logger.error(`Failed to stop download: ${error}`)
      }
      return
    }
    setOpen(false)
    resolve({})
  }

  const onFinish = async () => {
    const values = formValues
    if (!values.modelId) {
      setError(t('ovms.download.model_id.required'))
      return
    }
    if (!/^OpenVINO\/.+/.test(values.modelId)) {
      setError(t('ovms.download.model_id.model_id_pattern'))
      return
    }
    if (!values.modelName) {
      setError(t('ovms.download.model_name.required'))
      return
    }
    setError(null)
    setLoading(true)
    setCancelled(false) // Reset cancelled state
    startFakeProgress()
    try {
      const { modelName, modelId, modelSource, task } = values
      const normalizedModelSource = modelSource === HUGGINGFACE_SOURCE_VALUE ? '' : modelSource
      logger.info(
        `🔄 Downloading model: ${modelName} with ID: ${modelId}, source: ${normalizedModelSource}, task: ${task}`
      )
      const result = await window.api.ovms.addModel(modelName, modelId, normalizedModelSource, task)

      if (result.success) {
        stopFakeProgress(true) // Complete the progress bar
        window.toast.success(t('ovms.download.success_desc', { modelName: modelName, modelId: modelId }))
        setOpen(false)
        resolve({})
      } else {
        stopFakeProgress(false) // Reset progress on error
        logger.error(`Download failed, is it cancelled? ${cancelled}`)
        // Only show error if not cancelled by user
        if (!cancelled) {
          setError(result.message)
        }
      }
    } catch (error: any) {
      stopFakeProgress(false) // Reset progress on error
      logger.error(`Download crashed, is it cancelled? ${cancelled}`)
      // Only show error if not cancelled by user
      if (!cancelled) {
        setError(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const footer = (
    <div className={drawerClasses.footer}>
      <Button variant={loading ? 'default' : 'outline'} type="button" onClick={() => void onCancel()}>
        {loading ? t('common.cancel') : t('common.cancel')}
      </Button>
      <Button disabled={loading} onClick={() => void onFinish()}>
        {t('ovms.download.button')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      size="form"
      title={title}
      open={open}
      onClose={() => void onCancel()}
      showHeaderCloseButton={!loading}
      footer={footer}>
      <div className={drawerClasses.fieldList}>
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('ovms.download.model_id.label')}</label>
          <Input
            className={drawerClasses.input}
            value={formValues.modelId}
            onChange={(event) => {
              updateField('modelId', event.target.value)
              handleModelIdChange(event.target.value)
            }}
            placeholder={t('ovms.download.model_id.placeholder')}
            disabled={loading}
          />
          <div className="flex flex-wrap gap-1.5">
            {PRESET_MODELS.map((model) => (
              <Tooltip key={model.modelId} content={model.label}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto rounded-full px-2 py-1 text-[11px]"
                  disabled={loading}
                  onClick={() => handlePresetSelect(model.modelId)}>
                  {model.modelName}
                </Button>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('ovms.download.model_name.label')}</label>
          <Input
            className={drawerClasses.input}
            value={formValues.modelName}
            onChange={(event) => updateField('modelName', event.target.value)}
            placeholder={t('ovms.download.model_name.placeholder')}
            spellCheck={false}
            maxLength={200}
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('ovms.download.model_source')}</label>
          <Select
            value={formValues.modelSource}
            onValueChange={(value) => updateField('modelSource', value)}
            disabled={loading}>
            <SelectTrigger className={drawerClasses.selectTrigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={drawerClasses.selectContent}>
              <SelectItem value={HUGGINGFACE_SOURCE_VALUE}>HuggingFace</SelectItem>
              <SelectItem value="https://hf-mirror.com">HF-Mirror</SelectItem>
              <SelectItem value="https://www.modelscope.cn/models">ModelScope</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('ovms.download.model_task')}</label>
          <Select value={formValues.task} onValueChange={(value) => updateField('task', value)} disabled={loading}>
            <SelectTrigger className={drawerClasses.selectTrigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={drawerClasses.selectContent}>
              <SelectItem value="text_generation">Text Generation</SelectItem>
              <SelectItem value="embeddings">Embeddings</SelectItem>
              <SelectItem value="rerank">Rerank</SelectItem>
              <SelectItem value="image_generation">Image Generation</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loading && (
          <div className="space-y-2">
            <div className={drawerClasses.healthProgressTrack}>
              <div className={drawerClasses.healthProgressFill} style={{ width: `${Math.round(progress)}%` }} />
            </div>
            <div className="text-center text-muted-foreground text-sm">
              {Math.round(progress)}% · {t('ovms.download.tip')}
            </div>
          </div>
        )}
        {error ? <div className={drawerClasses.errorText}>{error}</div> : null}
      </div>
    </ProviderSettingsDrawer>
  )
}

export default class DownloadOVMSModelPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('DownloadOVMSModelPopup')
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
        'DownloadOVMSModelPopup'
      )
    })
  }
}
