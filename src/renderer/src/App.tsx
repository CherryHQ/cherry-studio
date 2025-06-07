import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'
import styled from 'styled-components';
import { useState, useCallback, useEffect } from 'react'; // Added React hooks
import { LayoutDashboard } from 'lucide-react'; // Added icon

import BrowserViewPane from './components/BrowserViewPane/BrowserViewPane'; // Added BrowserViewPane
import CodeAnimator from './components/effects/CodeAnimator';
import HolographicGlobe from './components/effects/HolographicGlobe';
import Sidebar from './components/app/Sidebar'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { ThemeProvider } from './context/ThemeProvider'
import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HistoryPage from './pages/history/HistoryPage'
import HomePage from './pages/home/HomePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'
import HuggingFacePage from './pages/external/HuggingFacePage';
import GitHubPage from './pages/external/GitHubPage';
import GoogleSearchPage from './pages/external/GoogleSearchPage'; // Added


// Styled Components
const AppContainer = styled.div`
  position: relative; // For z-indexing context if CodeAnimator is absolute/fixed
  min-height: 100vh;
  // background-color: #000; // Old solid background
  background-color: rgba(10, 10, 15, 0.80); // New semi-transparent dark background
  // This will allow the desktop to be subtly visible if window is transparent.
  // The CodeAnimator is at z-index: -1 within this, and MainContentWrapper at z-index: 1.
`;

const MainContentWrapper = styled.div`
  position: relative; // To ensure it's above CodeAnimator
  z-index: 1; // Above CodeAnimator
  display: flex;
  flex-direction: column;
  height: 100vh;
`;

const AppHeader = styled.header`
  display: flex;
  align-items: center;
  padding: 10px 20px;
  background-color: rgba(10, 10, 15, 0.5);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(50, 50, 70, 0.5);
  z-index: 10;
  flex-shrink: 0;
`;

// New styled component for header controls (e.g., toggle button)
const HeaderControls = styled.div`
  margin-left: auto;
  display: flex;
  gap: 10px;
`;

const ControlButton = styled.button`
  background-color: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  &:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }
`;

const AppTitle = styled.h1`
  font-size: 1.75rem;
  font-weight: bold;
  margin-left: 15px;
  color: #E0E0FF;
  text-shadow: 0 0 8px rgba(0, 210, 255, 0.7);
  letter-spacing: 0.05em;
`;

const AppFooter = styled.footer`
  padding: 8px 20px;
  text-align: center;
  background-color: rgba(10, 10, 15, 0.3);
  backdrop-filter: blur(5px);
  border-top: 1px solid rgba(50, 50, 70, 0.5);
  z-index: 10;
  flex-shrink: 0;

  p {
    margin: 2px 0;
    font-size: 0.7rem;
    color: #A0A0CC;
  }
  strong {
    color: #C0C0E0;
  }
`;

const MainAppArea = styled.div`
  display: flex; // Changed to flex row for side-by-side content
  flex-grow: 1;
  overflow: hidden;
`;

const PrimaryContent = styled.div`
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const BrowserPaneWrapper = styled.div<{ $isVisible: boolean }>`
  width: ${props => props.$isVisible ? '50%' : '0px'};
  flex-shrink: 0;
  border-left: ${props => props.$isVisible ? '1px solid rgba(50, 50, 70, 0.5)' : 'none'};
  transition: width 0.3s ease-in-out;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;


function App(): JSX.Element {
  const [showBrowserPane, setShowBrowserPane] = useState(false);
  const BROWSER_VIEW_ID = 'mainSkyscopeBrowser';

  const toggleBrowserPane = useCallback(() => {
    const newVisibility = !showBrowserPane;
    setShowBrowserPane(newVisibility);
    if (newVisibility) {
      window.api?.browserViewManager.showView(BROWSER_VIEW_ID);
    } else {
      window.api?.browserViewManager.hideView(BROWSER_VIEW_ID);
    }
  }, [showBrowserPane]);

  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <PersistGate loading={null} persistor={persistor}>
            <AppContainer>
              <CodeAnimator />
              <MainContentWrapper>
                <AppHeader>
                  <HolographicGlobe size={40} />
                  <AppTitle>SKYSCOPE AI</AppTitle>
                  <HeaderControls>
                    <ControlButton onClick={toggleBrowserPane}>
                      <LayoutDashboard size={16}/> Browser
                    </ControlButton>
                  </HeaderControls>
                </AppHeader>
                <MainAppArea>
                  <PrimaryContent>
                    <TopViewContainer>
                      <HashRouter>
                        <Sidebar />
                        <Routes>
                          <Route path="/" element={<HomePage />} />
                          <Route path="/files" element={<FilesPage />} />
                          <Route path="/agents" element={<AgentsPage />} />
                          <Route path="/translate" element={<TranslatePage />} />
                          <Route path="/apps" element={<AppsPage />} />
                          <Route path="/messages/*" element={<HistoryPage />} />
                          <Route path="/settings/*" element={<SettingsPage />} />
                          <Route path="/huggingface" element={<HuggingFacePage />} />
                          <Route path="/github" element={<GitHubPage />} />
                          <Route path="/googlesearch" element={<GoogleSearchPage />} /> {/* Added */}
                        </Routes>
                      </HashRouter>
                    </TopViewContainer>
                  </PrimaryContent>
                  <BrowserPaneWrapper $isVisible={showBrowserPane}>
                    {showBrowserPane && (
                      <BrowserViewPane
                        key={BROWSER_VIEW_ID}
                        viewId={BROWSER_VIEW_ID}
                        initialUrl="https://duckduckgo.com"
                      />
                    )}
                  </BrowserPaneWrapper>
                </MainAppArea>
                <AppFooter>
                  <p>Developer Miss Casey Jay Topojani</p>
                  <p><strong>Skyscope Sentinel Intelligence</strong></p>
                </AppFooter>
              </MainContentWrapper>
            </AppContainer>
          </PersistGate>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default App
