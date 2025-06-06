// src/renderer/src/pages/external/HuggingFacePage.tsx
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { Input, Button, List, Typography, Card, Spin, notification } from 'antd';
import { SearchOutlined, RocketOutlined } from '@ant-design/icons';

// Assuming BROWSER_VIEW_ID is a known constant, or passed as prop / from context
// For now, let's assume a primary browser view ID used by App.tsx
const MAIN_BROWSER_VIEW_ID = 'mainSkyscopeBrowser';

const PageContainer = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background-color: var(--color-background-page); // Use theme variable
`;

const Section = styled.div`
  margin-bottom: 30px;
`;

const { Title } = Typography;

interface HFModel {
  modelId: string;
  pipeline_tag?: string;
  // Add other fields you expect from your HFModelInfo type in main process
}

interface HFSpace {
     id: string;
     // Add other fields
}

const HuggingFacePage: React.FC = () => {
  const [modelSearchTerm, setModelSearchTerm] = useState<string>('');
  const [models, setModels] = useState<HFModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);

  const [spaceIdInput, setSpaceIdInput] = useState<string>('');
  const [isLoadingSpace, setIsLoadingSpace] = useState<boolean>(false);

  const handleSearchModels = useCallback(async () => {
    if (!modelSearchTerm.trim()) {
      notification.info({ message: 'Please enter a search term for models.' });
      return;
    }
    setIsLoadingModels(true);
    try {
      if (window.api?.huggingFaceService?.listModels) {
        const result: any = await window.api.huggingFaceService.listModels(modelSearchTerm, undefined, undefined, 10);
        if (result.error) {
          notification.error({ message: 'Error listing models', description: result.error.message || JSON.stringify(result.error) });
          setModels([]);
        } else {
          setModels(result || []); // result itself is the array of models or similar structure
        }
      } else {
         notification.error({ message: 'HuggingFace API (listModels) not available.' });
      }
    } catch (error: any) {
      notification.error({ message: 'Failed to fetch models', description: error.message });
      setModels([]);
    }
    setIsLoadingModels(false);
  }, [modelSearchTerm]);

  const handleLoadSpace = useCallback(async () => {
    if (!spaceIdInput.trim()) {
      notification.info({ message: 'Please enter a Space ID or URL.' });
      return;
    }
    setIsLoadingSpace(true);
    try {
      let spaceUrlToLoad = spaceIdInput.trim();
      // Check if it's a full URL already, otherwise try to get it via service
      if (!spaceUrlToLoad.startsWith('http://') && !spaceUrlToLoad.startsWith('https://')) {
         if (window.api?.huggingFaceService?.getSpaceUrl) {
             const result: any = await window.api.huggingFaceService.getSpaceUrl(spaceIdInput.trim());
             if (result.error) { // Assuming error is returned as { error: ... }
                 notification.error({ message: 'Error getting Space URL', description: result.error.message || JSON.stringify(result.error) });
                 setIsLoadingSpace(false);
                 return;
             }
             spaceUrlToLoad = result; // result is the URL string
         } else {
             notification.error({ message: 'HuggingFace API (getSpaceUrl) not available.' });
             setIsLoadingSpace(false);
             return;
         }
      }

      if (window.api?.browserViewManager?.navigateTo) {
        // Ensure the browser pane is visible first (App.tsx should handle this toggle)
        // A more robust solution would involve checking visibility or emitting an event to App.tsx.
        // For now, we must ensure the Browser Pane is manually toggled on by the user.
        // We also need to ensure the view is shown if it was previously hidden (e.g. by App.tsx toggle)
        await window.api.browserViewManager.showView(MAIN_BROWSER_VIEW_ID); // Explicitly show

        console.log(`Requesting navigation in view ${MAIN_BROWSER_VIEW_ID} to ${spaceUrlToLoad}`);
        window.api.browserViewManager.navigateTo(MAIN_BROWSER_VIEW_ID, spaceUrlToLoad);
        notification.success({ message: 'Loading Space', description: `Attempting to load ${spaceUrlToLoad} in the browser pane.` });
      } else {
         notification.error({ message: 'BrowserViewManager API not available.' });
      }
    } catch (error: any) {
      notification.error({ message: 'Failed to load Space', description: error.message });
    }
    setIsLoadingSpace(false);
  }, [spaceIdInput]);

  return (
    <PageContainer>
      <Title level={2}>Hugging Face Integration</Title>

      <Section>
        <Title level={4}>Search Models</Title>
        <Input.Search
          placeholder="Enter model name or keyword (e.g., 'bert-base-uncased')"
          enterButton={<Button icon={<SearchOutlined />} type="primary">Search</Button>}
          size="large"
          value={modelSearchTerm}
          onChange={(e) => setModelSearchTerm(e.target.value)}
          onSearch={handleSearchModels}
          loading={isLoadingModels}
        />
        {isLoadingModels && <Spin style={{ display: 'block', marginTop: '10px' }} />}
        {!isLoadingModels && models.length > 0 && (
          <List
            style={{ marginTop: '20px', maxHeight: '300px', overflowY: 'auto' }}
            bordered
            dataSource={models}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={<a href={`https://huggingface.co/${item.modelId}`} target="_blank" rel="noopener noreferrer">{item.modelId}</a>}
                  description={item.pipeline_tag || 'No pipeline tag'}
                />
              </List.Item>
            )}
          />
        )}
        {!isLoadingModels && models.length === 0 && modelSearchTerm && !isLoadingModels && ( // Added !isLoadingModels here
          <Typography.Text style={{ display: 'block', marginTop: '10px' }}>
            No models found for "{modelSearchTerm}".
          </Typography.Text>
        )}
      </Section>

      <Section>
        <Title level={4}>Load Hugging Face Space</Title>
        <Input.Search
          placeholder="Enter Space ID (e.g., 'huggingface-projects/diffuse-the-rest') or full URL"
          enterButton={<Button icon={<RocketOutlined />} type="primary">Load Space</Button>}
          size="large"
          value={spaceIdInput}
          onChange={(e) => setSpaceIdInput(e.target.value)}
          onSearch={handleLoadSpace}
          loading={isLoadingSpace}
        />
        {isLoadingSpace && <Spin style={{ display: 'block', marginTop: '10px' }} />}
         <Typography.Text type="secondary" style={{display: 'block', marginTop: '5px'}}>
             Ensure the Browser Pane is visible to see the loaded Space.
         </Typography.Text>
      </Section>
    </PageContainer>
  );
};

export default HuggingFacePage;
