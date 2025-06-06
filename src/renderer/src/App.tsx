import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'
import styled from 'styled-components'; // Added styled-components

import CodeAnimator from './components/effects/CodeAnimator'; // Added CodeAnimator
import HolographicGlobe from './components/effects/HolographicGlobe'; // Added HolographicGlobe
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
  display: flex;
  flex-grow: 1;
  overflow: hidden;
`;


function App(): JSX.Element {
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
                </AppHeader>
                <MainAppArea>
                  <TopViewContainer> {/* Assuming TopViewContainer was a direct child of PersistGate before */}
                    <HashRouter>
                      <Sidebar /> {/* Sidebar might need style adjustments if it was full height */}
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/files" element={<FilesPage />} />
                        <Route path="/agents" element={<AgentsPage />} />
                        <Route path="/translate" element={<TranslatePage />} />
                        <Route path="/apps" element={<AppsPage />} />
                        <Route path="/messages/*" element={<HistoryPage />} />
                        <Route path="/settings/*" element={<SettingsPage />} />
                      </Routes>
                    </HashRouter>
                  </TopViewContainer>
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
