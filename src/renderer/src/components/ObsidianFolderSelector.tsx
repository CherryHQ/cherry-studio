import { FolderOutlined } from '@ant-design/icons'
import { Spin, Tree } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  defaultPath: string
  initialFiles: string[]
  obsidianUrl: string
  obsidianApiKey: string
  onPathChange: (path: string) => void
}

interface TreeNode {
  title: string
  key: string
  isLeaf: boolean
  children?: TreeNode[]
}

const ObsidianFolderSelector: FC<Props> = ({
  defaultPath,
  initialFiles,
  obsidianUrl,
  obsidianApiKey,
  onPathChange
}) => {
  const { t } = useTranslation()
  const [treeData, setTreeData] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])

  // 初始化根目录
  useEffect(() => {
    const rootNodes: TreeNode[] = [
      {
        title: '/',
        key: '/',
        isLeaf: false,
        children: initialFiles
          .filter((file) => file.endsWith('/')) // 只保留目录
          .map((dir) => {
            const normalizedDir = dir.replace('/', '')
            return {
              title: normalizedDir,
              key: `/${normalizedDir}/`, // 确保路径末尾有斜杠
              isLeaf: false
            }
          })
      }
    ]
    setTreeData(rootNodes)

    // 设置根节点为展开状态
    setExpandedKeys(['/'])

    // 直接调用 loadData 加载根节点的子节点
    if (rootNodes[0]) {
      loadData(rootNodes[0])
    }
  }, [initialFiles])

  // 异步加载子节点
  const loadData = async (node: any) => {
    if (node.children && node.children.length > 0) return

    setLoading(true)
    try {
      // 确保路径末尾有斜杠
      const path = node.key === '/' ? '' : node.key
      const requestPath = path.endsWith('/') ? path : `${path}/`

      const response = await fetch(`${obsidianUrl}/vault${requestPath}`, {
        headers: {
          Authorization: `Bearer ${obsidianApiKey}`
        }
      })
      const data = await response.json()

      if (!response.ok || (!data?.files && data?.errorCode !== 40400)) {
        throw new Error('获取文件夹失败')
      }

      const childNodes: TreeNode[] = (data.files || [])
        .filter((file: string) => file.endsWith('/')) // 只保留目录
        .map((dir: string) => {
          // 修复路径问题，避免重复的斜杠
          const normalizedDir = dir.replace('/', '')
          const childPath = requestPath.endsWith('/')
            ? `${requestPath}${normalizedDir}/`
            : `${requestPath}/${normalizedDir}/`

          return {
            title: normalizedDir,
            key: childPath,
            isLeaf: false
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

  return (
    <Container>
      <Spin spinning={loading}>
        <TreeContainer>
          <Tree
            defaultSelectedKeys={[defaultPath]}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            treeData={treeData}
            loadData={loadData}
            onSelect={(selectedKeys) => {
              if (selectedKeys.length > 0) {
                const path = selectedKeys[0] as string
                onPathChange?.(path)
              }
            }}
            icon={<FolderOutlined />}
          />
        </TreeContainer>
      </Spin>
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
  height: 350px;
`

export default ObsidianFolderSelector
