import { QuestionCircleOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import { Form, Input, Modal, Radio, Space, Tooltip } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  directoryPath: string
  title?: string
  ignorePatterns?: {
    patterns: string[]
    type: 'glob' | 'regex' | 'static'
    direction?: 'include' | 'exclude'
  }
  readOnly?: boolean
}

interface FormData {
  ignorePatterns: string
  ignoreType: 'glob' | 'regex' | 'static'
  filterDirection: 'include' | 'exclude'
}

interface Props extends ShowParams {
  resolve: (
    data: {
      directoryPath: string
      ignorePatterns?: {
        patterns: string[]
        type: 'glob' | 'regex' | 'static'
        direction?: 'include' | 'exclude'
      }
    } | null
  ) => void
}

const PopupContainer: React.FC<Props> = ({ directoryPath, title, ignorePatterns, readOnly, resolve }) => {
  const [open, setOpen] = useState(true)
  const [form] = Form.useForm<FormData>()
  const { t } = useTranslation()

  // 设置默认值或者预填充值
  const defaultIgnoreType: 'glob' | 'regex' | 'static' = 'glob'
  const initialValues = ignorePatterns
    ? {
        ignoreType: ignorePatterns.type,
        ignorePatterns: ignorePatterns.patterns.join('\n'),
        filterDirection: ignorePatterns.direction || 'exclude'
      }
    : {
        ignoreType: defaultIgnoreType,
        ignorePatterns: '',
        filterDirection: 'exclude'
      }

  form.setFieldsValue(initialValues)

  const onOk = async () => {
    if (readOnly) {
      setOpen(false)
      resolve(null)
      return
    }

    try {
      const values = await form.validateFields()

      const result = {
        directoryPath,
        ignorePatterns: values.ignorePatterns
          ? {
              patterns: values.ignorePatterns.split('\n').filter((p) => p.trim()),
              type: values.ignoreType,
              direction: values.filterDirection
            }
          : undefined
      }

      setOpen(false)
      resolve(result)
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const onCancel = () => {
    setOpen(false)
    resolve(null)
  }

  const onClose = () => {
    resolve(null)
  }

  const typeExamples = {
    glob: '*.log\nnode_modules/\n.git/',
    regex: '\\.log$\nnode_modules\n\\.git',
    static: 'temp.txt\nnode_modules\n.git'
  }

  return (
    <Modal
      title={title || t('knowledge.directory_confirmation')}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      destroyOnClose
      centered
      width={550}
      okText={readOnly ? t('common.close') : t('common.ok')}
      cancelButtonProps={{ style: { display: readOnly ? 'none' : 'inline-block' } }}>
      <Form form={form} layout="vertical" disabled={readOnly}>
        <div style={{ marginBottom: '16px' }}>
          <strong>{t('knowledge.selected_directory')}:</strong> {directoryPath}
        </div>

        <Form.Item
          label={
            <Space>
              {t('knowledge.filter_direction')}
              <Tooltip title={t('knowledge.filter_direction_tooltip')}>
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="filterDirection">
          <Radio.Group>
            <Radio value="exclude">{t('knowledge.filter_direction_exclude')}</Radio>
            <Radio value="include">{t('knowledge.filter_direction_include')}</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label={
            <Space>
              {t('knowledge.ignore_patterns_type')}
              <Tooltip title={t('knowledge.ignore_type_tooltip')}>
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="ignoreType">
          <Radio.Group>
            <Radio value="glob">{t('knowledge.ignore_type_glob')}</Radio>
            <Radio value="regex">{t('knowledge.ignore_type_regex')}</Radio>
            <Radio value="static">{t('knowledge.ignore_type_static')}</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label={
            <Space>
              {t('knowledge.ignore_patterns')}
              <Tooltip title={t('knowledge.ignore_patterns_tooltip')}>
                <QuestionCircleOutlined />
              </Tooltip>
            </Space>
          }
          name="ignorePatterns"
          tooltip={{
            title: (
              <div>
                <p>{t('knowledge.ignore_patterns_help')}</p>
                <p>
                  <strong>{t('knowledge.examples')}:</strong>
                </p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{typeExamples[form.getFieldValue('ignoreType') || 'glob']}</pre>
              </div>
            ),
            placement: 'topRight',
            overlayStyle: { maxWidth: '300px' }
          }}>
          <Input.TextArea
            placeholder={t('knowledge.ignore_patterns_placeholder')}
            autoSize={{ minRows: 4, maxRows: 10 }}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default class DirectoryConfigPopup {
  static hide() {
    TopView.hide('DirectoryConfigPopup')
  }

  static show(props: ShowParams) {
    return new Promise<{
      directoryPath: string
      ignorePatterns?: {
        patterns: string[]
        type: 'glob' | 'regex' | 'static'
        direction?: 'include' | 'exclude'
      }
    } | null>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'DirectoryConfigPopup'
      )
    })
  }
}
