// src/renderer/src/pages/external/GitHubPage.tsx
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { Input, Button, List, Typography, Card, Spin, notification, Space, Tag, Tree } from 'antd';
import { GithubOutlined, BookOutlined, FileOutlined, FolderOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TreeProps, GetProps } from 'antd';

type DirectoryTreeProps = GetProps<typeof Tree.DirectoryTree>;
// Correcting the antd v5 Tree.DirectoryTree prop type for node if needed, or use any for simplicity here
// For Antd v5, TreeProps node is internal, so we might need to be careful with casting if strict typing is an issue
// For now, info: any in onSelect should work around strict type issues if DataNode isn't perfectly matching antd's internal expectations.

const PageContainer = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background-color: var(--color-background-page);
`;

const Section = styled(Card)`
  margin-bottom: 20px;
  background-color: var(--color-background-soft); // Use theme variable
  border: 1px solid var(--color-border-soft);
`;

const FileContentPreview = styled.pre`
  background-color: #0d1117; // GitHub dark code background
  color: #c9d1d9; // GitHub dark code text
  padding: 15px;
  border-radius: 6px;
  overflow-x: auto;
  max-height: 400px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 0.85em;
  white-space: pre-wrap; // Allow wrapping, but also show structure
  word-break: break-all;
`;

const { Title, Text, Paragraph } = Typography;

interface RepoInfo {
  name?: string;
  full_name?: string;
  description?: string | null;
  html_url?: string;
  language?: string | null;
  stargazers_count?: number;
  // Add more fields as needed
}

interface RepoContentItem { // Renamed to avoid conflict with GitHubContent in main process if types were shared
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  download_url?: string | null; // Make sure this is included if used
  // Add other fields as needed
}

// Define TreeNode types for Ant Design Tree
 interface DataNode {
     title: string;
     key: string; // Typically the path
     isLeaf?: boolean;
     children?: DataNode[];
     type?: 'file' | 'dir'; // Store type for icon
     item: RepoContentItem; // Store original item for context
 }


const GitHubPage: React.FC = () => {
  const [owner, setOwner] = useState<string>('microsoft');
  const [repo, setRepo] = useState<string>('vscode');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [isLoadingRepoInfo, setIsLoadingRepoInfo] = useState<boolean>(false);

  const [currentPath, setCurrentPath] = useState<string>('');
  const [treeData, setTreeData] = useState<DataNode[]>([]); // Tree data state
  const [isLoadingContents, setIsLoadingContents] = useState<boolean>(false);

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingFileContent, setIsLoadingFileContent] = useState<boolean>(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const convertToTreeData = (items: RepoContentItem[], basePath: string = ''): DataNode[] => {
    return items
        .sort((a, b) => {
            if (a.type === 'dir' && b.type !== 'dir') return -1;
            if (a.type !== 'dir' && b.type === 'dir') return 1;
            return a.name.localeCompare(b.name);
        })
        .map(item => ({
            title: item.name,
            key: item.path,
            isLeaf: item.type === 'file',
            type: item.type,
            item: item, // Store the original item
            children: item.type === 'dir' ? [] : undefined, // For dynamic loading, start with empty children for dirs
        }));
  };

  const fetchRepoContents = useCallback(async (targetOwner: string, targetRepo: string, path: string, targetNode?: DataNode) => {
    setIsLoadingContents(true);
    if (!targetNode) { // If not loading into a specific node, clear previous file content view
        setFileContent(null);
        setSelectedFilePath(null);
    }
    try {
        if (window.api?.githubService?.getRepoContents) {
            const result: any = await window.api.githubService.getRepoContents(targetOwner, targetRepo, path);
            if (result.error) {
                notification.error({ message: 'Error fetching repo contents', description: result.error.message });
            } else {
                const fetchedContents = (Array.isArray(result) ? result : [result]) as RepoContentItem[];
                setCurrentPath(path);

                if (targetNode) { // Load children into specific node
                    targetNode.children = convertToTreeData(fetchedContents, path);
                    setTreeData(prevTreeData => [...prevTreeData]); // Trigger re-render of tree
                } else { // Root level or refreshing path display (not tree children)
                    setTreeData(convertToTreeData(fetchedContents, path));
                }
            }
        } else {
            notification.error({ message: 'GitHub API (getRepoContents) not available.' });
        }
    } catch (error: any) {
        notification.error({ message: 'Failed to fetch repo contents', description: error.message });
    }
    setIsLoadingContents(false);
  }, []);


  const fetchRepoInfo = useCallback(async () => {
    if (!owner.trim() || !repo.trim()) {
      notification.error({ message: 'Owner and Repo are required.' });
      return;
    }
    setIsLoadingRepoInfo(true);
    setRepoInfo(null);
    setTreeData([]);
    setCurrentPath('');
    setFileContent(null);
    setSelectedFilePath(null);
    try {
      if (window.api?.githubService?.getRepoInfo) {
        const result: any = await window.api.githubService.getRepoInfo(owner.trim(), repo.trim());
        if (result.error) {
          notification.error({ message: 'Error fetching repo info', description: result.error.message });
        } else {
          setRepoInfo(result);
          // Automatically fetch root contents after getting repo info
          fetchRepoContents(owner.trim(), repo.trim(), '');
        }
      } else {
        notification.error({ message: 'GitHub API (getRepoInfo) not available.' });
      }
    } catch (error: any) {
      notification.error({ message: 'Failed to fetch repo info', description: error.message });
    }
    setIsLoadingRepoInfo(false);
  }, [owner, repo, fetchRepoContents]);


  const fetchFileContent = useCallback(async (filePath: string) => {
      if (!owner.trim() || !repo.trim() || !filePath) return;
      setIsLoadingFileContent(true);
      setFileContent(null);
      setSelectedFilePath(filePath);
      try {
          if (window.api?.githubService?.getFileContent) {
              const result: any = await window.api.githubService.getFileContent(owner.trim(), repo.trim(), filePath);
              if (result.error) {
                  notification.error({ message: 'Error fetching file content', description: result.error.message });
                  setFileContent(`Error: ${result.error.message}`);
              } else {
                  setFileContent(result.content ?? 'Error: Could not load content or file is empty/binary.');
              }
          } else {
              notification.error({ message: 'GitHub API (getFileContent) not available.' });
          }
      } catch (error: any) {
          notification.error({ message: 'Failed to fetch file content', description: error.message });
          setFileContent(`Error: ${error.message}`);
      }
      setIsLoadingFileContent(false);
  }, [owner, repo]);

  const onSelectTreeNode: DirectoryTreeProps['onSelect'] = (keys, event) => {
    const path = keys[0] as string;
    const node = event.node as DataNode; // AntD's event.node is the selected node
    if (path) {
        if (node.isLeaf) {
            fetchFileContent(path);
        } else {
            // For directories, we don't re-fetch here as onLoadData will handle it
            // Or if not using onLoadData, expand/collapse will just show/hide existing children
            // If children are not loaded, onLoadData is the way.
            // This basic version re-fetches into the main 'contents' list, not ideal for deep tree.
            // fetchRepoContents(owner, repo, path);
            // setCurrentPath(path); // Set current path for context, tree handles its own expansion
        }
    }
  };

  const onLoadData: DirectoryTreeProps['loadData'] = (node) => {
    return new Promise<void>((resolve) => {
        if (node.children && node.children.length > 0) { // Already loaded
            resolve();
            return;
        }
        // Fetch children for this node
        fetchRepoContents(owner, repo, node.key as string, node as DataNode).then(() => {
            resolve();
        });
    });
  };

  // Initial fetch for default repo on component mount
  useEffect(() => {
    fetchRepoInfo();
  }, [fetchRepoInfo]);


    return (
      <PageContainer>
        <Title level={2} style={{display: 'flex', alignItems: 'center'}}><GithubOutlined style={{marginRight: '10px'}} />GitHub Repository Explorer</Title>

        <Section title="Repository Selection">
          <Space.Compact style={{ width: '100%' }}>
            <Input placeholder="Owner (e.g., 'microsoft')" value={owner} onChange={e => setOwner(e.target.value)} style={{width: '30%'}} />
            <Input placeholder="Repo (e.g., 'vscode')" value={repo} onChange={e => setRepo(e.target.value)} style={{width: '40%'}} />
            <Button type="primary" icon={<SearchOutlined />} onClick={fetchRepoInfo} loading={isLoadingRepoInfo}>
              Fetch Repo
            </Button>
          </Space.Compact>
        </Section>

        {isLoadingRepoInfo && <Spin tip="Loading repository info..." size="large" style={{display: 'block', textAlign: 'center', margin: '20px'}}/>}

        {repoInfo && (
          <Section title={<Space><BookOutlined />{repoInfo.full_name}</Space>}>
            <Paragraph>{repoInfo.description || 'No description.'}</Paragraph>
            <Space wrap>
              {repoInfo.language && <Tag color="blue">{repoInfo.language}</Tag>}
              <Tag color="gold">Stars: {repoInfo.stargazers_count}</Tag>
              <Button type="link" href={repoInfo.html_url} target="_blank" rel="noopener noreferrer">View on GitHub</Button>
            </Space>
          </Section>
        )}

        {repoInfo && (
           <Section title={
               <Space>
                   <FolderOutlined /> Path: {currentPath || '/'}
                   <Tooltip title="Reload root directory listing">
                       <Button
                           icon={<ReloadOutlined />}
                           size="small"
                           onClick={() => fetchRepoContents(owner, repo, '')} // Reload root
                           loading={isLoadingContents && currentPath === ''} // Only show loading for root reload
                       />
                   </Tooltip>
               </Space>
           }>
               {isLoadingContents && treeData.length === 0 && <Spin tip="Loading directory..." />}
               {treeData.length > 0 ? (
                   <Tree.DirectoryTree
                       treeData={treeData}
                       onSelect={onSelectTreeNode}
                       loadData={onLoadData} // Enable dynamic loading of children
                       icon={(nodeProps: any) => { // nodeProps is EventDataNode<DataNode> or similar
                           const node = nodeProps as DataNode; // Cast to our DataNode
                           return node.type === 'dir' ? <FolderOutlined /> : <FileOutlined />;
                       }}
                   />
               ) : (!isLoadingContents && <Text>No contents or repository not loaded.</Text>)}
           </Section>
        )}

        {selectedFilePath && (
           <Section title={<Space><FileOutlined />Content: {selectedFilePath}</Space>}>
               {isLoadingFileContent && <Spin tip="Loading file content..." />}
               {fileContent && <FileContentPreview>{fileContent}</FileContentPreview>}
               {!isLoadingFileContent && !fileContent && <Text>No content to display or file is empty/binary.</Text>}
           </Section>
        )}
      </PageContainer>
    );
  };

export default GitHubPage;
