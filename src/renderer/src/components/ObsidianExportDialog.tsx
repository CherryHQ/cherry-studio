import i18n from '@renderer/i18n'
import { exportMarkdownToObsidian } from '@renderer/utils/export'
import { Form, Input, Modal, Select } from 'antd'
import React, { useState } from 'react'

const { Option } = Select

interface ObsidianExportDialogProps {
  title: string
  markdown: string
  open: boolean // 使用 open 属性替代 visible
  onClose: (success: boolean) => void
  obsidianTags: string | null
  processingMethod: string | '3' //默认新增（存在就覆盖）
}

const ObsidianExportDialog: React.FC<ObsidianExportDialogProps> = ({
  title,
  markdown,
  obsidianTags,
  processingMethod,
  open,
  onClose
}) => {
  const [state, setState] = useState({
    title: title,
    tags: obsidianTags || '',
    createdAt: new Date().toISOString().split('T')[0],
    source: 'Cherry Studio',
    processingMethod: processingMethod
  })

  const handleOk = async () => {
    //构建content 并复制到粘贴板
    let content = ''
    if (state.processingMethod !== '3') {
      content = `\n---\n${markdown}`
    } else {
      content = `---
      \ntitle: ${state.title}
      \ncreated: ${state.createdAt}
      \nsource: ${state.source}
      \ntags: ${state.tags}
      \n---\n${markdown}`
    }
    if (content === '') {
      window.message.error(i18n.t('chat.topics.export.obsidian_export_failed'))
    }
    await navigator.clipboard.writeText(content)
    markdown = ''
    exportMarkdownToObsidian(state)
    onClose(true)
  }

  const handleCancel = () => {
    onClose(false)
  }

  const handleChange = (key: string, value: any) => {
    setState((prevState) => ({ ...prevState, [key]: value }))
  }

  return (
    <Modal
      title={i18n.t('chat.topics.export.obsidian_atributes')}
      open={open} // 使用 open 属性
      onOk={handleOk}
      onCancel={handleCancel}
      width={600}
      closable
      maskClosable
      centered
      okButtonProps={{ type: 'primary' }}
      okText={i18n.t('chat.topics.export.obsidian_btn')}>
      <Form layout="horizontal" labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} labelAlign="left">
        <Form.Item label={i18n.t('chat.topics.export.obsidian_title')}>
          <Input
            value={state.title}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder={i18n.t('chat.topics.export.obsidian_title_placeholder')}
          />
        </Form.Item>
        <Form.Item label={i18n.t('chat.topics.export.obsidian_tags')}>
          <Input
            value={state.tags}
            onChange={(e) => handleChange('tags', e.target.value)}
            placeholder={i18n.t('chat.topics.export.obsidian_tags_placeholder')}
          />
        </Form.Item>
        <Form.Item label={i18n.t('chat.topics.export.obsidian_created')}>
          <Input
            value={state.createdAt}
            onChange={(e) => handleChange('createdAt', e.target.value)}
            placeholder={i18n.t('chat.topics.export.obsidian_created_placeholder')}
          />
        </Form.Item>
        <Form.Item label={i18n.t('chat.topics.export.obsidian_source')}>
          <Input
            value={state.source}
            onChange={(e) => handleChange('source', e.target.value)}
            placeholder={i18n.t('chat.topics.export.obsidian_source_placeholder')}
          />
        </Form.Item>
        <Form.Item label={i18n.t('chat.topics.export.obsidian_operate')}>
          <Select
            value={state.processingMethod}
            onChange={(value) => handleChange('processingMethod', value)}
            placeholder={i18n.t('chat.topics.export.obsidian_operate_placeholder')}
            allowClear>
            <Option value="1">{i18n.t('chat.topics.export.obsidian_operate_append')}</Option>
            <Option value="2">{i18n.t('chat.topics.export.obsidian_operate_prepend')}</Option>
            <Option value="3">{i18n.t('chat.topics.export.obsidian_operate_new_or_overwrite')}</Option>
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ObsidianExportDialog
