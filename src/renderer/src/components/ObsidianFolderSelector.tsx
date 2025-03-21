import { FileOutlined, FolderOutlined } from '@ant-design/icons'
import { Spin, Switch, Tree } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  defaultPath: string
  obsidianUrl: string
  obsidianApiKey: string
  onPathChange: (path: string, isMdFile: boolean) => void
}

interface TreeNode {
  title: string
  key: string
  isLeaf: boolean
  isMdFile?: boolean
  children?: TreeNode[]
}

const ObsidianFolderSelector: FC<Props> = ({ defaultPath, obsidianUrl, obsidianApiKey, onPathChange }) => {
  const { t } = useTranslation()
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>(['/'])
  const [showMdFiles, setShowMdFiles] = useState<boolean>(false)
  // 当前选中的节点信息
  const [currentSelection, setCurrentSelection] = useState({
    path: defaultPath,
    isMdFile: false
  })
  // 使用key强制Tree组件重新渲染
  const [treeKey, setTreeKey] = useState<number>(0)

  // 只初始化根节点，不立即加载内容
  useEffect(() => {
    initializeRootNode()
  }, [showMdFiles])

  // 初始化根节点，但不自动加载子节点
  const initializeRootNode = () => {
    const rootNode: TreeNode = {
      title: '/',
      key: '/',
      isLeaf: false
    }

    setTreeData([rootNode])
  }

  // 异步加载子节点
  const loadData = async (node: any) => {
    if (node.isLeaf) return // 如果是叶子节点（md文件），不加载子节点

    setLoading(true)
    try {
      // 确保路径末尾有斜杠
      const path = node.key === '/' ? '' : node.key
      const requestPath = path.endsWith('/') ? path : `${path}/`

      const response = await fetch(`${obsidianUrl}vault${requestPath}`, {
        headers: {
          Authorization: `Bearer ${obsidianApiKey}`
        }
      })
      const data = await response.json()

      if (!response.ok || (!data?.files && data?.errorCode !== 40400)) {
        throw new Error('获取文件夹失败')
      }

      const childNodes: TreeNode[] = (data.files || [])
        .filter((file: string) => file.endsWith('/') || (showMdFiles && file.endsWith('.md'))) // 根据开关状态决定是否显示md文件
        .map((file: string) => {
          // 修复路径问题，避免重复的斜杠
          const normalizedFile = file.replace('/', '')
          const isMdFile = file.endsWith('.md')
          const childPath = requestPath.endsWith('/')
            ? `${requestPath}${normalizedFile}${isMdFile ? '' : '/'}`
            : `${requestPath}/${normalizedFile}${isMdFile ? '' : '/'}`

          return {
            title: normalizedFile,
            key: childPath,
            isLeaf: isMdFile,
            isMdFile
          }
        })

      // 更新节点的子节点
      setTreeData((origin) => {
        const loop = (data: TreeNode[], key: string, children: TreeNode[]): TreeNode[] => {
          return data.map((item) => {
            if (item.key === key) {
              return {
                ...item,
                children
              }
            }
            if (item.children) {
              return {
                ...item,
                children: loop(item.children, key, children)
              }
            }
            return item
          })
        }
        return loop(origin, node.key, childNodes)
      })
    } catch (error) {
      window.message.error(t('chat.topics.export.obsidian_fetch_failed'))
    } finally {
      setLoading(false)
    }
  }

  // 处理开关切换
  const handleSwitchChange = (checked: boolean) => {
    setShowMdFiles(checked)
    // 重置选择
    setCurrentSelection({
      path: defaultPath,
      isMdFile: false
    })
    onPathChange(defaultPath, false)

    // 重置Tree状态并强制重新渲染
    setTreeData([])
    setExpandedKeys(['/'])

    // 递增key值以强制Tree组件完全重新渲染
    setTreeKey((prev) => prev + 1)

    // 延迟初始化根节点，让状态完全清除
    setTimeout(() => {
      initializeRootNode()
    }, 50)
  }

  // 自定义图标，为md文件和文件夹显示不同的图标
  const renderIcon = (props: any) => {
    const { data } = props
    if (data.isMdFile) {
      return <FileOutlined />
    }
    return <FolderOutlined />
  }

  return (
    <Container>
      <SwitchContainer>
        <span>{t('chat.topics.export.obsidian_show_md_files')}</span>
        <Switch checked={showMdFiles} onChange={handleSwitchChange} />
      </SwitchContainer>
      <Spin spinning={loading}>
        <TreeContainer>
          <Tree
            key={treeKey} // 使用key来强制重新渲染
            defaultSelectedKeys={[defaultPath]}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            treeData={treeData}
            loadData={loadData}
            onSelect={(selectedKeys, info) => {
              if (selectedKeys.length > 0) {
                const path = selectedKeys[0] as string
                const isMdFile = !!(info.node as any).isMdFile

                setCurrentSelection({
                  path,
                  isMdFile
                })

                onPathChange?.(path, isMdFile)
              }
            }}
            showLine
            showIcon
            icon={renderIcon}
          />
        </TreeContainer>
      </Spin>
      <div>
        {currentSelection.path !== defaultPath && (
          <SelectedPath>
            {t('chat.topics.export.obsidian_selected_path')}: {currentSelection.path}
          </SelectedPath>
        )}
      </div>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 400px;
`

const TreeContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 10px;
  height: 320px;
`

const SwitchContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding: 0 10px;
`

const SelectedPath = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  margin-top: 5px;
  padding: 0 10px;
  word-break: break-all;
`

export default ObsidianFolderSelector
