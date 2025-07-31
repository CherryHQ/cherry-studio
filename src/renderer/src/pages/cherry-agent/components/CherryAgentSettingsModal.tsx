import { FolderOpenOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Button, Form, Input, Modal } from 'antd'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('CherryAgentSettingsModal')

interface CherryAgentSettingsModalProps {
  visible: boolean
  onClose: () => void
  onSave: (workingDirectory: string) => void
  currentWorkingDirectory: string
}

const CherryAgentSettingsModal: FC<CherryAgentSettingsModalProps> = ({
  visible,
  onClose,
  onSave,
  currentWorkingDirectory
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      onSave(values.workingDirectory)
      onClose()
    } catch (error) {
      // Form validation failed
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onClose()
  }

  const handleBrowseDirectory = useCallback(async () => {
    try {
      const selectedPath = await window.api.file.selectFolder()
      if (selectedPath) {
        form.setFieldsValue({ workingDirectory: selectedPath })
      }
    } catch (error) {
      logger.error('Failed to select directory:', error as Error)
    }
  }, [form])

  return (
    <Modal
      title={t('agent.settings.title', 'Agent Settings')}
      open={visible}
      onOk={handleOk}
      onCancel={handleCancel}
      destroyOnClose
      centered
      transitionName="animation-move-down"
      width={500}
      styles={{
        header: {
          borderBottom: '0.5px solid var(--color-border)',
          paddingBottom: 16,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0
        },
        body: {
          paddingTop: 24
        }
      }}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          workingDirectory: currentWorkingDirectory
        }}>
        <Form.Item
          label={t('agent.settings.workingDirectory', 'Working Directory')}
          name="workingDirectory"
          rules={[
            {
              required: true,
              message: t('agent.settings.workingDirectoryRequired', 'Please select a working directory')
            }
          ]}>
          <Input
            placeholder={t('agent.settings.workingDirectoryPlaceholder', 'Select a working directory...')}
            addonAfter={
              <Button type="text" icon={<FolderOpenOutlined />} onClick={handleBrowseDirectory} size="small">
                {t('agent.settings.browse', 'Browse')}
              </Button>
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default CherryAgentSettingsModal
