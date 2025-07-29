import { loggerService } from '@logger'
import type { ActionItem } from '@renderer/types/selectionTypes'
import { Button, Form, Input, Modal, Select } from 'antd'
import { Globe } from 'lucide-react'
import { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SelectionActionSearchModal')

interface SearchEngineOption {
  label: string
  value: string
  searchEngine: string
  icon: React.ReactNode
}

export const LogoBing = (props) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M11.501 3v8.5h-8.5V3zm0 18h-8.5v-8.5h8.5zm1-18h8.5v8.5h-8.5zm8.5 9.5V21h-8.5v-8.5z"
      />
    </svg>
  )
}
export const LogoBaidu = (props) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M5.926 12.497c2.063-.444 1.782-2.909 1.72-3.448c-.1-.83-1.078-2.282-2.404-2.167c-1.67.15-1.914 2.561-1.914 2.561c-.226 1.115.54 3.497 2.598 3.053m2.191 4.288c-.06.173-.195.616-.079 1.002c.23.866.982.905.982.905h1.08v-2.64H8.944c-.52.154-.77.559-.827.733m1.638-8.422c1.14 0 2.06-1.312 2.06-2.933s-.92-2.93-2.06-2.93c-1.138 0-2.06 1.31-2.06 2.93s.923 2.933 2.06 2.933m4.907.193c1.523.198 2.502-1.427 2.697-2.659c.198-1.23-.784-2.658-1.862-2.904c-1.08-.248-2.43 1.483-2.552 2.61c-.147 1.38.197 2.758 1.717 2.953m0 3.448c-1.865-2.905-4.513-1.723-5.399-.245c-.882 1.477-2.256 2.41-2.452 2.658c-.198.244-2.846 1.673-2.258 4.284c.588 2.609 2.653 2.56 2.653 2.56s1.521.15 3.286-.246c1.766-.391 3.286.098 3.286.098s4.124 1.38 5.253-1.278c1.127-2.66-.638-4.038-.638-4.038s-2.356-1.823-3.731-3.793m-6.007 7.75c-1.158-.231-1.62-1.021-1.677-1.156c-.057-.137-.386-.772-.212-1.853c.5-1.619 1.927-1.735 1.927-1.735h1.427v-1.755l1.216.02v6.479zm4.59-.019c-1.196-.308-1.252-1.158-1.252-1.158v-3.412l1.252-.02v3.066c.076.328.482.387.482.387H15v-3.433h1.331v4.57zm7.453-9.11c0-.59-.49-2.364-2.305-2.364c-1.818 0-2.061 1.675-2.061 2.859c0 1.13.095 2.707 2.354 2.657s2.012-2.56 2.012-3.152"
      />
    </svg>
  )
}

export const LogoGoogle = (props) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M3.064 7.51A10 10 0 0 1 12 2c2.695 0 4.959.991 6.69 2.605l-2.867 2.868C14.786 6.482 13.468 5.977 12 5.977c-2.605 0-4.81 1.76-5.595 4.123c-.2.6-.314 1.24-.314 1.9s.114 1.3.314 1.9c.786 2.364 2.99 4.123 5.595 4.123c1.345 0 2.49-.355 3.386-.955a4.6 4.6 0 0 0 1.996-3.018H12v-3.868h9.418c.118.654.182 1.336.182 2.045c0 3.046-1.09 5.61-2.982 7.35C16.964 21.105 14.7 22 12 22A9.996 9.996 0 0 1 2 12c0-1.614.386-3.14 1.064-4.49"
      />
    </svg>
  )
}

export const DEFAULT_SEARCH_ENGINES: SearchEngineOption[] = [
  {
    label: 'Google',
    value: 'Google',
    searchEngine: 'Google|https://www.google.com/search?q={{queryString}}',
    icon: <LogoGoogle style={{ fontSize: '14px', color: 'var(--color-text-2)' }} />
  },
  {
    label: 'Baidu',
    value: 'Baidu',
    searchEngine: 'Baidu|https://www.baidu.com/s?wd={{queryString}}',
    icon: <LogoBaidu style={{ fontSize: '14px', color: 'var(--color-text-2)' }} />
  },
  {
    label: 'Bing',
    value: 'Bing',
    searchEngine: 'Bing|https://www.bing.com/search?q={{queryString}}',
    icon: <LogoBing style={{ fontSize: '14px', color: 'var(--color-text-2)' }} />
  },
  {
    label: '',
    value: 'custom',
    searchEngine: '',
    icon: <Globe size={14} color="var(--color-text-2)" />
  }
]

const EXAMPLE_URL = 'https://example.com/search?q={{queryString}}'

interface SelectionActionSearchModalProps {
  isModalOpen: boolean
  onOk: (searchEngine: string) => void
  onCancel: () => void
  currentAction?: ActionItem
}

const SelectionActionSearchModal: FC<SelectionActionSearchModalProps> = ({
  isModalOpen,
  onOk,
  onCancel,
  currentAction
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  useEffect(() => {
    if (isModalOpen && currentAction?.searchEngine) {
      form.resetFields()

      const [engine, url] = currentAction.searchEngine.split('|')
      const defaultEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === engine)

      if (defaultEngine) {
        form.setFieldsValue({
          engine: defaultEngine.value,
          customName: '',
          customUrl: ''
        })
      } else {
        // Handle custom search engine
        form.setFieldsValue({
          engine: 'custom',
          customName: engine,
          customUrl: url
        })
      }
    }
  }, [isModalOpen, currentAction, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const selectedEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === values.engine)

      const searchEngine =
        selectedEngine?.value === 'custom'
          ? `${values.customName}|${values.customUrl}`
          : selectedEngine?.searchEngine || ''

      onOk(searchEngine)
    } catch (error) {
      logger.debug('Validation failed:', error as Error)
    }
  }

  const handleCancel = () => {
    onCancel()
  }

  const handleTest = () => {
    const values = form.getFieldsValue()
    if (values.customUrl) {
      const testUrl = values.customUrl.replace('{{queryString}}', 'cherry studio')
      window.api.openWebsite(testUrl)
    }
  }

  return (
    <Modal
      title={t('selection.settings.search_modal.title')}
      open={isModalOpen}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      centered>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          engine: 'Google',
          customName: '',
          customUrl: ''
        }}>
        <Form.Item name="engine" label={t('selection.settings.search_modal.engine.label')}>
          <Select
            options={DEFAULT_SEARCH_ENGINES.map((engine) => ({
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {engine.icon}
                  <span>{engine.label || t('selection.settings.search_modal.engine.custom')}</span>
                </div>
              ),
              value: engine.value
            }))}
            onChange={(value) => {
              if (value === 'custom') {
                form.setFieldsValue({
                  customName: '',
                  customUrl: EXAMPLE_URL
                })
              }
            }}
          />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.engine !== currentValues.engine}>
          {({ getFieldValue }) =>
            getFieldValue('engine') === 'custom' ? (
              <>
                <Form.Item
                  name="customName"
                  label={t('selection.settings.search_modal.custom.name.label')}
                  rules={[
                    { required: true, message: t('selection.settings.search_modal.custom.name.hint') },
                    { max: 16, message: t('selection.settings.search_modal.custom.name.max_length') }
                  ]}>
                  <Input placeholder={t('selection.settings.search_modal.custom.name.hint')} />
                </Form.Item>

                <Form.Item
                  name="customUrl"
                  label={t('selection.settings.search_modal.custom.url.label')}
                  tooltip={t('selection.settings.search_modal.custom.url.hint')}
                  rules={[
                    { required: true, message: t('selection.settings.search_modal.custom.url.required') },
                    {
                      pattern: /^https?:\/\/.+$/,
                      message: t('selection.settings.search_modal.custom.url.invalid_format')
                    },
                    {
                      validator: (_, value) => {
                        if (value && !value.includes('{{queryString}}')) {
                          return Promise.reject(t('selection.settings.search_modal.custom.url.missing_placeholder'))
                        }
                        return Promise.resolve()
                      }
                    }
                  ]}>
                  <Input
                    placeholder={EXAMPLE_URL}
                    suffix={
                      <Button type="link" size="small" onClick={handleTest} style={{ padding: 0, height: 'auto' }}>
                        {t('selection.settings.search_modal.custom.test')}
                      </Button>
                    }
                  />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SelectionActionSearchModal
