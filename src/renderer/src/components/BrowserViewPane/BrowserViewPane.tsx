// src/renderer/src/components/BrowserViewPane/BrowserViewPane.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined, HomeOutlined, BugOutlined } from '@ant-design/icons';
import { Input, Button, Tooltip, Spin } from 'antd';

const PaneContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #1a1a1a; // Dark background for the pane
  border-radius: 8px; // Consistent with TUI
  overflow: hidden;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  padding: 8px;
  background-color: #2c2c2c; // Slightly lighter toolbar
  border-bottom: 1px solid #383838;
  flex-shrink: 0;
`;

const AddressInput = styled(Input)`
  margin: 0 8px;
  flex-grow: 1;
  .ant-input {
    background-color: #1a1a1a !important;
    color: #e0e0e0 !important;
    border-color: #383838 !important;
  }
`;

const NavButton = styled(Button)`
  background-color: transparent;
  border: none;
  color: #c0c0c0;
  &:hover {
    color: #ffffff;
    background-color: #383838 !important;
  }
  &:disabled {
    color: #555555 !important;
    background-color: transparent !important;
  }
`;

const ViewArea = styled.div`
  flex-grow: 1;
  background-color: #000000; // Black background where the BrowserView will appear
  position: relative; // For positioning loading spinner or other overlays
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0,0,0,0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
`;

interface BrowserViewPaneProps {
  viewId: string; // Unique ID for this browser view instance
  initialUrl?: string;
  hostWindowId?: number; // Optional: if managing views across multiple windows
}

const BrowserViewPane: React.FC<BrowserViewPaneProps> = ({
  viewId,
  initialUrl = 'https://www.google.com',
  hostWindowId
}) => {
  const [currentAddress, setCurrentAddress] = useState(initialUrl);
  const [displayAddress, setDisplayAddress] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Assume loading initially
  const [currentTitle, setCurrentTitle] = useState<string>(''); // Added currentTitle state

  const viewAreaRef = useRef<HTMLDivElement>(null);

  const updateViewBounds = useCallback(() => {
    if (viewAreaRef.current && window.api?.browserViewManager) {
      const rect = viewAreaRef.current.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      if (bounds.width > 0 && bounds.height > 0) {
        window.api.browserViewManager.setBounds(viewId, bounds);
      }
    }
  }, [viewId]);

  // Create and set initial bounds for the BrowserView
  useEffect(() => {
    if (window.api?.browserViewManager) {
      console.log(`BrowserViewPane (${viewId}): Creating view with initial URL: ${initialUrl}`);
      window.api.browserViewManager.create(viewId, hostWindowId, initialUrl)
        .then(() => {
          updateViewBounds(); // Set initial bounds
          // setIsLoading(false); // isLoading will be managed by navigation events
          // showView is now handled by the parent component (App.tsx)
        })
        .catch(err => {
          console.error(`BrowserViewPane (${viewId}): Error creating BrowserView:`, err);
          setIsLoading(false);
        });

      // Use ResizeObserver to update bounds if the ViewArea changes size
      let resizeObserver: ResizeObserver;
      if (viewAreaRef.current) {
        resizeObserver = new ResizeObserver(() => {
          updateViewBounds();
        });
        resizeObserver.observe(viewAreaRef.current);
      }

      return () => {
        if (resizeObserver && viewAreaRef.current) {
          resizeObserver.unobserve(viewAreaRef.current);
        }
        // Ensure view is hidden and then destroyed when component unmounts
        if (window.api?.browserViewManager) {
          window.api.browserViewManager.hideView(viewId); // Hide first
          window.api.browserViewManager.destroy(viewId); // Then destroy
          console.log(`BrowserViewPane (${viewId}): View hidden and destroyed on unmount.`);
        }
      };
    }
  }, [viewId, initialUrl, hostWindowId, updateViewBounds]);

  // Subscribe to navigation state changes from the main process
  useEffect(() => {
    // Ensure the API and method exist before trying to use them
    if (window.api?.browserViewManager?.onNavigationStateChanged) {
      const cleanup = window.api.browserViewManager.onNavigationStateChanged(
        viewId,
        // The state object now includes isLoading and title from the main process
        (state: { url: string; canGoBack: boolean; canGoForward: boolean; isLoading: boolean; title: string }) => {
          console.log(`BrowserViewPane (${viewId}): Nav state update from main:`, state);
          setDisplayAddress(state.url);
          setCurrentAddress(state.url);
          setCanGoBack(state.canGoBack);
          setCanGoForward(state.canGoForward);
          setIsLoading(state.isLoading); // Use isLoading from main process
          setCurrentTitle(state.title || ''); // Use title from main process, default to empty string
        }
      );
      return cleanup;
    } else {
      console.warn(`BrowserViewPane (${viewId}): onNavigationStateChanged API not found.`);
    }
  }, [viewId]); // Keep viewId as dependency

  // Subscribe to load failed events
  useEffect(() => {
    if (window.api?.browserViewManager?.onLoadFailed) {
      const cleanup = window.api.browserViewManager.onLoadFailed(viewId, (details) => {
        console.error(`BrowserViewPane (${viewId}): Load Failed:`, details);
        setIsLoading(false); // Ensure loading is stopped on failure
        // Optionally display an error message in the view area or as a notification
      });
      return cleanup;
    }
  }, [viewId]);


  const handleNavigate = () => {
    if (currentAddress.trim() && window.api?.browserViewManager) {
      let urlToLoad = displayAddress.trim(); // Use displayAddress for navigation intent
      if (!urlToLoad.startsWith('http://') && !urlToLoad.startsWith('https://') && !urlToLoad.startsWith('file://') && urlToLoad !== 'about:blank') {
        urlToLoad = 'https://' + urlToLoad;
      }
      setCurrentAddress(urlToLoad); // Update internal currentAddress before navigation
      // setIsLoading(true); // REMOVE THIS LINE - Main process will send loading state
      window.api.browserViewManager.navigateTo(viewId, urlToLoad);
    }
  };

  const handleGoBack = () => {
    if (canGoBack && window.api?.browserViewManager) {
      // setIsLoading(true); // REMOVE THIS LINE
      window.api.browserViewManager.goBack(viewId);
    }
  };

  const handleGoForward = () => {
    if (canGoForward && window.api?.browserViewManager) {
      // setIsLoading(true); // REMOVE THIS LINE
      window.api.browserViewManager.goForward(viewId);
    }
  };

  const handleReload = () => {
    if (window.api?.browserViewManager) {
      // setIsLoading(true); // REMOVE THIS LINE
      window.api.browserViewManager.reload(viewId);
    }
  };

  const handleOpenDevTools = () => {
    window.api?.browserViewManager.openDevTools(viewId);
  };

  return (
    <PaneContainer>
      <Toolbar>
        <Tooltip title={`Home (Google) - Current: ${currentTitle}`}>
          <NavButton icon={<HomeOutlined />} onClick={() => {
            // setIsLoading(true); // REMOVE THIS LINE
            setCurrentAddress('https://www.google.com');
            setDisplayAddress('https://www.google.com');
            window.api?.browserViewManager.navigateTo(viewId, 'https://www.google.com');
          }} />
        </Tooltip>
        <Tooltip title={`Back - ${currentTitle}`}>
          <NavButton icon={<ArrowLeftOutlined />} onClick={handleGoBack} disabled={!canGoBack || isLoading} />
        </Tooltip>
        <Tooltip title="Forward">
          <NavButton icon={<ArrowRightOutlined />} onClick={handleGoForward} disabled={!canGoForward || isLoading} />
        </Tooltip>
        <Tooltip title="Reload">
          <NavButton icon={<ReloadOutlined />} onClick={handleReload} disabled={isLoading} />
        </Tooltip>
        <AddressInput
          value={displayAddress}
          onChange={(e) => setDisplayAddress(e.target.value)}
          onPressEnter={handleNavigate}
          placeholder="Enter URL and press Enter"
          disabled={isLoading}
        />
        <Button type="primary" onClick={handleNavigate} disabled={isLoading}>Go</Button>
        {process.env.NODE_ENV === 'development' && (
            <Tooltip title="Open DevTools for View">
                <NavButton icon={<BugOutlined />} onClick={handleOpenDevTools} style={{marginLeft: '8px'}}/>
            </Tooltip>
        )}
      </Toolbar>
      <ViewArea ref={viewAreaRef}>
        {isLoading && (
          <LoadingOverlay>
            <Spin size="large" />
          </LoadingOverlay>
        )}
        {/* The Electron BrowserView will be positioned here by the main process */}
      </ViewArea>
    </PaneContainer>
  );
};

export default BrowserViewPane;
