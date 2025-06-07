// src/renderer/src/pages/external/GoogleSearchPage.tsx
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { Input, Button, List, Typography, Card, Spin, notification, Alert } from 'antd';
import { GoogleOutlined, SearchOutlined } from '@ant-design/icons';

// Local interface definition for GoogleSearchResultItem to avoid main process import
interface GoogleSearchResultItem {
  kind: string;
  title: string;
  htmlTitle: string;
  link: string;
  displayLink: string;
  snippet: string;
  htmlSnippet: string;
  cacheId?: string;
  formattedUrl?: string;
  htmlFormattedUrl?: string;
  pagemap?: {
    cse_thumbnail?: Array<{ src: string; width: string; height: string }>;
    metatags?: Array<Record<string, any>>;
  };
  mime?: string;
  fileFormat?: string;
}


const PageContainer = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background-color: var(--color-background-page);
`;

const Section = styled(Card)`
  margin-bottom: 20px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border-soft);
`;

const { Title, Text, Paragraph, Link } = Typography;

const GoogleSearchPage: React.FC = () => {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GoogleSearchResultItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchPerformed, setSearchPerformed] = useState<boolean>(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      notification.info({ message: 'Please enter a search query.' });
      return;
    }

    setIsLoading(true);
    setSearchPerformed(true);
    setResults([]);
    try {
      if (window.api?.googleSearchService?.search) {
        const response: any = await window.api.googleSearchService.search(query.trim(), 10); // Fetch 10 results
        if (response.error) {
          notification.error({ message: 'Google Search Error', description: response.error.message || JSON.stringify(response.error) });
        } else if (response.items) {
          setResults(response.items);
        } else {
          setResults([]); // No items found or other issue
          notification.info({ message: 'No results found for your query.' });
        }
      } else {
        notification.error({ message: 'Google Search API not available.' });
      }
    } catch (error: any) {
      notification.error({ message: 'Failed to perform Google search', description: error.message });
    }
    setIsLoading(false);
  }, [query]);

  return (
    <PageContainer>
      <Title level={2} style={{display: 'flex', alignItems: 'center'}}><GoogleOutlined style={{marginRight: '10px'}} />Google Custom Search</Title>

      <Alert
         message="Configuration Note"
         description="This page uses the Google Custom Search API. Ensure that a Google API Key and a Custom Search Engine ID (CSE ID) are configured in the application's backend (main process environment variables GOOGLE_API_KEY and GOOGLE_CSE_ID)."
         type="info"
         showIcon
         style={{marginBottom: '20px'}}
      />

      <Section title="Search Query">
        <Input.Search
          placeholder="Enter your search query"
          enterButton={<Button icon={<SearchOutlined />} type="primary">Search</Button>}
          size="large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={handleSearch}
          loading={isLoading}
        />
      </Section>

      {isLoading && <Spin tip="Searching..." size="large" style={{display: 'block', textAlign: 'center', margin: '20px'}}/>}

      {!isLoading && searchPerformed && results.length === 0 && (
        <Text style={{display: 'block', textAlign: 'center', marginTop: '20px'}}>
          No results found for "{query}".
        </Text>
      )}

      {!isLoading && results.length > 0 && (
        <Section title={`Search Results for "${query}"`}>
          <List
            itemLayout="vertical"
            dataSource={results}
            renderItem={(item: GoogleSearchResultItem) => (
              <List.Item
                key={item.link + item.cacheId}
                extra={
                  item.pagemap?.cse_thumbnail?.[0]?.src ? (
                    <img
                      width={100}
                      style={{maxWidth: '100px', maxHeight: '80px', objectFit: 'contain', border: '1px solid var(--color-border)'}}
                      alt={item.title}
                      src={item.pagemap.cse_thumbnail[0].src}
                    />
                  ) : null
                }
              >
                <List.Item.Meta
                  title={<Link href={item.link} target="_blank" rel="noopener noreferrer">{item.htmlTitle || item.title}</Link>}
                  description={<Text type="secondary">{item.displayLink}</Text>}
                />
                <Paragraph ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}>
                  {item.snippet}
                </Paragraph>
              </List.Item>
            )}
          />
        </Section>
      )}
    </PageContainer>
  );
};

export default GoogleSearchPage;
