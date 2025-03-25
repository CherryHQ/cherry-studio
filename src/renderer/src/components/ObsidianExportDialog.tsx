import i18n from '@renderer/i18n'
import store from '@renderer/store'
import { exportMarkdownToObsidian } from '@renderer/utils/export'
import { Alert, Empty, Form, Input, Modal, Select, Spin, TreeSelect } from 'antd'
import React, { useEffect, useState } from 'react'

const { Option } = Select

interface ObsidianExportDialogProps {
  title: string
  markdown: string
  open: boolean
  onClose: (success: boolean) => void
  obsidianTags: string | null
  processingMethod: string | '3' //默认新增（存在就覆盖）
}

interface FileInfo {
  path: string
  type: 'folder' | 'markdown'
  name: string
}

// 转换文件信息数组为树形结构
const convertToTreeData = (files: FileInfo[]) => {
  const treeData: any[] = [
    {
      title: i18n.t('chat.topics.export.obsidian_root_directory'),
      value: '',
      isLeaf: false,
      selectable: true
    }
  ]

  // 记录已创建的节点路径
  const pathMap: Record<string, any> = {
    '': treeData[0]
  }

  // 先按类型分组，确保先处理文件夹
  const folders = files.filter((file) => file.type === 'folder')
  const mdFiles = files.filter((file) => file.type === 'markdown')

  // 按路径排序，确保父文件夹先被创建
  const sortedFolders = [...folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  // 先处理所有文件夹，构建目录结构
  for (const folder of sortedFolders) {
    const parts = folder.path.split('/')
    let currentPath = ''
    let parentPath = ''

    // 遍历文件夹路径的每一部分，确保创建完整路径
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]

      // 构建当前路径
      currentPath = currentPath ? `${currentPath}/${part}` : part

      // 如果这个路径节点还没创建
      if (!pathMap[currentPath]) {
        const node = {
          title: part,
          value: currentPath,
          key: currentPath,
          isLeaf: false,
          selectable: true,
          children: []
        }

        // 获取父节点，将当前节点添加到父节点的children中
        const parentNode = pathMap[parentPath]
        if (parentNode) {
          if (!parentNode.children) {
            parentNode.children = []
          }
          parentNode.children.push(node)
        }

        pathMap[currentPath] = node
      }

      // 更新父路径为当前路径，为下一级做准备
      parentPath = currentPath
    }
  }

  // 然后处理md文件
  for (const file of mdFiles) {
    const fullPath = file.path
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'))
    const fileName = file.name

    // 获取父文件夹节点
    const parentNode = pathMap[dirPath] || pathMap['']

    // 创建文件节点
    const fileNode = {
      title: fileName,
      value: fullPath,
      isLeaf: true,
      selectable: true,
      icon: <span style={{ marginRight: 4 }}>📄</span>
    }

    // 添加到父节点
    if (!parentNode.children) {
      parentNode.children = []
    }
    parentNode.children.push(fileNode)
  }

  return treeData
}

const ObsidianExportDialog: React.FC<ObsidianExportDialogProps> = ({
  title,
  markdown,
  open,
  onClose,
  obsidianTags,
  processingMethod
}) => {
  const defaultObsidianVault = store.getState().settings.defaultObsidianVault
  const [state, setState] = useState({
    title,
    tags: obsidianTags || '',
    createdAt: new Date().toISOString().split('T')[0],
    source: 'Cherry Studio',
    processingMethod: processingMethod,
    folder: ''
  })

  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTreeData, setFileTreeData] = useState<any[]>([])
  const [selectedVault, setSelectedVault] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // 处理文件数据转为树形结构
  useEffect(() => {
    if (files.length > 0) {
      const treeData = convertToTreeData(files)
      setFileTreeData(treeData)
    } else {
      setFileTreeData([
        {
          title: i18n.t('chat.topics.export.obsidian_root_directory'),
          value: '',
          isLeaf: false,
          selectable: true
        }
      ])
    }
  }, [files])

  // 组件加载时获取Vault列表
  useEffect(() => {
    const fetchVaults = async () => {
      try {
        setLoading(true)
        setError(null)
        const vaultsData = await window.obsidian.getVaults()

        if (vaultsData.length === 0) {
          setError(i18n.t('chat.topics.export.obsidian_no_vaults'))
          setLoading(false)
          return
        }

        setVaults(vaultsData)

        // 如果没有选择的vault，使用默认值或第一个
        const vaultToUse = defaultObsidianVault || vaultsData[0]?.name
        if (vaultToUse) {
          setSelectedVault(vaultToUse)

          // 获取选中vault的文件和文件夹
          const filesData = await window.obsidian.getFiles(vaultToUse)
          setFiles(filesData)
        }
      } catch (error) {
        console.error('获取Obsidian Vault失败:', error)
        setError(i18n.t('chat.topics.export.obsidian_fetch_error'))
      } finally {
        setLoading(false)
      }
    }

    fetchVaults()
  }, [defaultObsidianVault])

  // 当选择的vault变化时，获取其文件和文件夹
  useEffect(() => {
    if (selectedVault) {
      const fetchFiles = async () => {
        try {
          setLoading(true)
          setError(null)
          const filesData = await window.obsidian.getFiles(selectedVault)
          setFiles(filesData)
        } catch (error) {
          console.error('获取Obsidian文件失败:', error)
          setError(i18n.t('chat.topics.export.obsidian_fetch_folders_error'))
        } finally {
          setLoading(false)
        }
      }

      fetchFiles()
    }
  }, [selectedVault])

  const handleOk = async () => {
    if (!selectedVault) {
      setError(i18n.t('chat.topics.export.obsidian_no_vault_selected'))
      return
    }

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
      return
    }

    await navigator.clipboard.writeText(content)

    // 导出到Obsidian
    exportMarkdownToObsidian({
      ...state,
      folder: state.folder,
      vault: selectedVault
    })

    onClose(true)
  }

  const handleCancel = () => {
    onClose(false)
  }

  const handleChange = (key: string, value: any) => {
    setState((prevState) => ({ ...prevState, [key]: value }))
  }

  const handleVaultChange = (value: string) => {
    setSelectedVault(value)
    // 文件夹会通过useEffect自动获取
    setState((prevState) => ({
      ...prevState,
      folder: ''
    }))
  }

  // 处理文件选择
  const handleFileSelect = (value: string) => {
    // 更新folder值
    handleChange('folder', value)

    // 检查是否选中md文件
    if (value) {
      const selectedFile = files.find((file) => file.path === value)
      if (selectedFile) {
        if (selectedFile.type === 'markdown') {
          // 如果是md文件，自动设置标题为文件名并设置处理方式为1(追加)
          const fileName = selectedFile.name
          const titleWithoutExt = fileName.endsWith('.md') ? fileName.substring(0, fileName.length - 3) : fileName
          handleChange('title', titleWithoutExt)
          handleChange('processingMethod', '1')
        } else {
          // 如果是文件夹，自动设置标题为话题名并设置处理方式为3(新建)
          handleChange('processingMethod', '3')
          handleChange('title', title)
        }
      }
    }
  }

  return (
    <Modal
      title={i18n.t('chat.topics.export.obsidian_atributes')}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      width={600}
      closable
      maskClosable
      centered
      okButtonProps={{
        type: 'primary',
        disabled: vaults.length === 0 || loading || !!error
      }}
      okText={i18n.t('chat.topics.export.obsidian_btn')}>
      {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

      <Form layout="horizontal" labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} labelAlign="left">
        <Form.Item label={i18n.t('chat.topics.export.obsidian_title')}>
          <Input
            value={state.title}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder={i18n.t('chat.topics.export.obsidian_title_placeholder')}
          />
        </Form.Item>

        <Form.Item label={i18n.t('chat.topics.export.obsidian_vault')}>
          {vaults.length > 0 ? (
            <Select
              loading={loading}
              value={selectedVault}
              onChange={handleVaultChange}
              placeholder={i18n.t('chat.topics.export.obsidian_vault_placeholder')}
              style={{ width: '100%' }}>
              {vaults.map((vault) => (
                <Option key={vault.name} value={vault.name}>
                  {vault.name}
                </Option>
              ))}
            </Select>
          ) : (
            <Empty
              description={
                loading
                  ? i18n.t('chat.topics.export.obsidian_loading')
                  : i18n.t('chat.topics.export.obsidian_no_vaults')
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Form.Item>

        <Form.Item label={i18n.t('chat.topics.export.obsidian_path')}>
          <Spin spinning={loading}>
            {selectedVault ? (
              <TreeSelect
                value={state.folder}
                onChange={handleFileSelect}
                placeholder={i18n.t('chat.topics.export.obsidian_path_placeholder')}
                style={{ width: '100%' }}
                showSearch
                dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
                treeDefaultExpandAll={false}
                treeNodeFilterProp="title"
                treeData={fileTreeData}></TreeSelect>
            ) : (
              <Empty
                description={i18n.t('chat.topics.export.obsidian_select_vault_first')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Spin>
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
