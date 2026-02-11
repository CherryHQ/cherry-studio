import { Button, Divider, Modal, Space, Typography } from 'antd'
import React from 'react'
import ReactMarkdown from 'react-markdown'

const { Title, Paragraph } = Typography

interface ExitPlanModeApprovalDialogProps {
  open: boolean
  plan: string
  onCancel: () => void
  onApprove: (mode: 'acceptEdits' | 'default') => void
  currentPermissionMode: string
}

export const ExitPlanModeApprovalDialog: React.FC<ExitPlanModeApprovalDialogProps> = ({
  open,
  plan,
  onCancel,
  onApprove,
  currentPermissionMode
}) => {
  return (
    <Modal
      open={open}
      title={
        <Space direction="vertical" style={{ width: '100%' }}>
          <Title level={4}>Approve Plan and Continue</Title>
          <Paragraph type="secondary">
            Current permission mode: <strong>{currentPermissionMode}</strong>
          </Paragraph>
        </Space>
      }
      onCancel={onCancel}
      footer={null}
      width={800}>
      <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '24px' }}>
        <Paragraph strong>Plan Details:</Paragraph>
        <div className="plan-preview" style={{ backgroundColor: '#f6f8fa', padding: '12px', borderRadius: '4px' }}>
          <ReactMarkdown>{plan}</ReactMarkdown>
        </div>
      </div>

      <Divider />

      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Paragraph strong>Select how you want to proceed:</Paragraph>

        <Button
          type="primary"
          size="large"
          onClick={() => onApprove('acceptEdits')}
          block
          style={{ textAlign: 'left', height: 'auto', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>✅ Yes, allow edits</span>
            <small style={{ opacity: 0.7 }}>Switches to acceptEdits mode</small>
          </div>
        </Button>

        <Button
          type="default"
          size="large"
          onClick={() => onApprove('default')}
          block
          style={{ textAlign: 'left', height: 'auto', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>✅ Yes, manually approve</span>
            <small style={{ opacity: 0.7 }}>Switches to default mode</small>
          </div>
        </Button>

        <Button
          type="dashed"
          size="large"
          onClick={onCancel}
          block
          style={{ textAlign: 'left', height: 'auto', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>❌ No, enter something else</span>
            <small style={{ opacity: 0.7 }}>Stays in current mode</small>
          </div>
        </Button>
      </Space>
    </Modal>
  )
}
