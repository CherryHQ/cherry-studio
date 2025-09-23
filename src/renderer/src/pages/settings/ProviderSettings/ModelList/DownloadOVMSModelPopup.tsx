import { loggerService } from '@logger'
import { TopView } from '@renderer/components/TopView'
import { Provider } from '@renderer/types'
import { AutoComplete, Button, Flex, Form, FormProps, Input, Modal, Progress, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useTimer } from '../../../../hooks/useTimer'

const logger = loggerService.withContext('OVMSClient')

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
  const [form] = Form.useForm()
  const { t } = useTranslation()
  const { setIntervalTimer, clearIntervalTimer, setTimeoutTimer } = useTimer()

  const startFakeProgress = () => {
    setProgress(0)
    setIntervalTimer('progress', () => {
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
    }, 500)
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
      form.setFieldsValue({
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
        form.setFieldValue('modelName', modelName)
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
  }

  const onClose = () => {
    resolve({})
  }

  const onFinish: FormProps<FieldType>['onFinish'] = async (values) => {
    setLoading(true)
    setCancelled(false) // Reset cancelled state
    startFakeProgress()
    try {
      const { modelName, modelId, modelSource, task } = values
      logger.info(`🔄 Downloading model: ${modelName} with ID: ${modelId}, source: ${modelSource}, task: ${task}`)
      const result = await window.api.ovms.addModel(modelName, modelId, modelSource, task)

      if (result.success) {
        stopFakeProgress(true) // Complete the progress bar
        Modal.success({
          title: t('ovms.download.success'),
          content: t('ovms.download.success_desc', { modelName: modelName, modelId: modelId }),
          onOk: () => {
            setOpen(false)
          }
        })
      } else {
        stopFakeProgress(false) // Reset progress on error
        logger.error(`Download failed, is it cancelled? ${cancelled}`)
        // Only show error if not cancelled by user
        if (!cancelled) {
          Modal.error({
            title: t('ovms.download.error'),
            content: <div dangerouslySetInnerHTML={{ __html: result.message }}></div>,
            onOk: () => {
              // Keep the form open for retry
            }
          })
        }
      }
    } catch (error: any) {
      stopFakeProgress(false) // Reset progress on error
      logger.error(`Download crashed, is it cancelled? ${cancelled}`)
      // Only show error if not cancelled by user
      if (!cancelled) {
        Modal.error({
          title: t('ovms.download.error'),
          content: error.message,
          onOk: () => {
            // Keep the form open for retry
          }
        })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      maskClosable={false}
      afterClose={onClose}
      footer={null}
      transitionName="animation-move-down"
      centered
      closeIcon={!loading}>
      <Form
        form={form}
        labelCol={{ flex: '110px' }}
        labelAlign="left"
        colon={false}
        style={{ marginTop: 25 }}
        onFinish={onFinish}
        disabled={false}>
        <Form.Item
          name="modelId"
          label={t('ovms.download.model_id.label')}
          rules={[
            { required: true, message: t('ovms.download.model_id.required') },
            {
              pattern: /^OpenVINO\/.+/,
              message: t('ovms.download.model_id.model_id_pattern')
            }
          ]}>
          <AutoComplete
            placeholder={t('ovms.download.model_id.placeholder')}
            options={PRESET_MODELS.map((model) => ({
              value: model.modelId,
              label: model.label
            }))}
            onSelect={handlePresetSelect}
            onChange={handleModelIdChange}
            disabled={loading}
            allowClear
          />
        </Form.Item>
        <Form.Item
          name="modelName"
          label={t('ovms.download.model_name.label')}
          rules={[{ required: true, message: t('ovms.download.model_name.required') }]}>
          <Input
            placeholder={t('ovms.download.model_name.placeholder')}
            spellCheck={false}
            maxLength={200}
            disabled={loading}
          />
        </Form.Item>
        <Form.Item
          name="modelSource"
          label={t('ovms.download.model_source')}
          initialValue="https://www.modelscope.cn/models"
          rules={[{ required: false }]}>
          <Select
            options={[
              { value: '', label: 'HuggingFace' },
              { value: 'https://hf-mirror.com', label: 'HF-Mirror' },
              { value: 'https://www.modelscope.cn/models', label: 'ModelScope' }
            ]}
            disabled={loading}
          />
        </Form.Item>
        <Form.Item
          name="task"
          label={t('ovms.download.model_task')}
          initialValue="text_generation"
          rules={[{ required: false }]}>
          <Select
            options={[
              { value: 'text_generation', label: 'Text Generation' },
              { value: 'embeddings', label: 'Embeddings' },
              { value: 'rerank', label: 'Rerank' },
              { value: 'image_generation', label: 'Image Generation' }
            ]}
            disabled={loading}
          />
        </Form.Item>
        {loading && (
          <Form.Item style={{ marginBottom: 16 }}>
            <Progress
              percent={Math.round(progress)}
              status={progress === 100 ? 'success' : 'active'}
              strokeColor={{
                '0%': '#108ee9',
                '100%': '#87d068'
              }}
              showInfo={true}
              format={(percent) => `${percent}%`}
            />
            <div style={{ textAlign: 'center', marginTop: 8, color: '#666', fontSize: '14px' }}>
              {t('ovms.download.tip')}
            </div>
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 8, textAlign: 'center' }}>
          <Flex justify="end" align="center" style={{ position: 'relative' }}>
            <Button
              type="primary"
              htmlType={loading ? 'button' : 'submit'}
              size="middle"
              loading={false}
              onClick={loading ? onCancel : undefined}>
              {loading ? t('common.cancel') : t('ovms.download.button')}
            </Button>
          </Flex>
        </Form.Item>
      </Form>
    </Modal>
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
