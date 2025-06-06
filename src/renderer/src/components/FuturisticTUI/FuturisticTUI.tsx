// src/renderer/src/components/FuturisticTUI/FuturisticTUI.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import styled from 'styled-components';

// Styled Components
const TUIContainer = styled.div`
  background-color: #0A0A0A; // Very dark background
  color: #00FF41; // Bright green text, classic terminal look
  font-family: 'monospace', 'Consolas', 'Menlo', 'Courier New';
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #00FF41; // Green border
  height: 100%; // Take full height of its parent
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const OutputArea = styled.div`
  flex-grow: 1;
  overflow-y: auto;
  padding-right: 5px; // For scrollbar
  margin-bottom: 10px;
  white-space: pre-wrap; // Preserve whitespace and newlines
  word-break: break-all; // Prevent long strings from overflowing

  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: #1A1A1A;
  }
  &::-webkit-scrollbar-thumb {
    background-color: #00FF41;
    border-radius: 4px;
  }
`;

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
`;

const PromptSymbol = styled.span`
  color: #00FFFF; // Cyan prompt symbol
  margin-right: 8px;
`;

const Input = styled.input`
  background-color: transparent;
  border: none;
  color: #00FF41; // Bright green text
  font-family: inherit;
  font-size: 1em;
  flex-grow: 1;
  outline: none;

  &::placeholder {
    color: #00FF41;
    opacity: 0.6;
  }
`;

// New Styled Components
const InfoBar = styled.div`
  padding: 5px 10px;
  background-color: rgba(0, 255, 65, 0.05); // Subtle green tint
  border-bottom: 1px solid rgba(0, 255, 65, 0.2);
  font-size: 0.8em;
  color: #00FF41; // Bright green
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap; // Allow wrapping on smaller TUIs
`;

const AgentStatus = styled.div`
  span {
    color: #00FFFF; // Cyan for keywords
  }
`;

const SystemProcesses = styled.div`
  max-width: 40%; // Don't let it take too much space
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  span {
    color: #FFA500; // Orange for process names
  }
`;

const ProgressBarContainer = styled.div`
  padding: 8px 10px;
  background-color: rgba(0, 255, 65, 0.05);
  border-top: 1px solid rgba(0, 255, 65, 0.2);
  display: flex;
  align-items: center;
  font-size: 0.85em;
`;

const ProgressBar = styled.div`
  height: 10px;
  flex-grow: 1;
  background-color: rgba(0, 80, 20, 0.5); // Dark green background
  border: 1px solid #00FF41;
  border-radius: 3px;
  margin-right: 10px;
  position: relative;
  overflow: hidden;
`;

const ProgressBarFill = styled.div<{ progress: number }>`
  width: ${(props) => props.progress}%;
  height: 100%;
  background: linear-gradient(90deg, #00FF41, #00AA2C);
  transition: width 0.5s ease-in-out;
`;

const ProgressSquares = styled.div`
  display: flex;
  margin-right: 10px;
`;

const Square = styled.div<{ active: boolean; index: number }>`
  width: 8px;
  height: 8px;
  background-color: ${(props) => (props.active ? '#00FF41' : 'rgba(0, 80, 20, 0.5)')};
  border: 1px solid ${(props) => (props.active ? '#00FF41' : 'rgba(0,120,30,0.7)')};
  margin-left: 3px;
  transition: all 0.3s ease;
  animation: ${(props) => (props.active ? 'pulseSquare 1s infinite alternate' : 'none')};
  animation-delay: ${(props) => props.index * 0.1}s;

  @keyframes pulseSquare {
    from { opacity: 0.7; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }
`;

const PercentageText = styled.span`
  color: #00FF41;
  min-width: 40px; // Ensure space for "100%"
`;

interface TUIMessage {
  id: string;
  type: 'input' | 'output' | 'system' | 'error';
  text: string;
  timestamp: Date;
}

interface FuturisticTUIProps {
  agentId?: string; // To associate with a backend agent later
  onCommandSubmit?: (command: string, agentId?: string) => Promise<string | null>; // For sending commands
}

const FuturisticTUI: React.FC<FuturisticTUIProps> = ({ agentId, onCommandSubmit }) => {
  const [messages, setMessages] = useState<TUIMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const outputAreaRef = useRef<HTMLDivElement>(null);

  // Add new state variables
  const [agentThinking, setAgentThinking] = useState<string>("Planning next actions...");
  const [currentSystemProcesses, setCurrentSystemProcesses] = useState<string[]>(["git", "python", "docker"]);
  const [taskProgress, setTaskProgress] = useState<number>(0);
  const [activeSquares, setActiveSquares] = useState<number>(0);

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (outputAreaRef.current) {
      outputAreaRef.current.scrollTop = outputAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Initial welcome message & Mock Data Intervals
  useEffect(() => {
    setMessages([
      {
        id: 'welcome',
        type: 'system',
        text: 'SKYSCOPE AI TUI Initialized. Waiting for agent connection...\nType "help" for available commands (once connected).',
        timestamp: new Date()
      }
    ]);

    // Mock agent thinking updates
    const thinkingInterval = setInterval(() => {
      const thoughts = [
        "Analyzing user query...",
        "Fetching relevant data...",
        "Formulating response...",
        "Cross-referencing sources...",
        "Considering alternatives..."
      ];
      setAgentThinking(thoughts[Math.floor(Math.random() * thoughts.length)]);
    }, 3000);

    // Mock progress bar updates
    const progressInterval = setInterval(() => {
      setTaskProgress(prev => {
        const newProgress = prev + Math.random() * 15;
        if (newProgress >= 100) {
          setActiveSquares(9);
          return 100;
        }
        setActiveSquares(Math.floor((newProgress / 100) * 9));
        return newProgress;
      });
    }, 1500);

    // Mock system process changes (less frequent)
    const processInterval = setInterval(() => {
       const commonProcesses = ["git", "python", "node", "nvim", "ollama_server", "chromium"];
       const numToShow = Math.floor(Math.random() * 2) + 2; // 2 or 3 processes
       const selected = [];
       for(let i=0; i<numToShow; i++) {
           selected.push(commonProcesses[Math.floor(Math.random() * commonProcesses.length)]);
       }
       setCurrentSystemProcesses(Array.from(new Set(selected))); // Ensure unique
    }, 7000);

    return () => {
      clearInterval(thinkingInterval);
      clearInterval(progressInterval);
      clearInterval(processInterval);
    };
  }, []);

  const addMessage = (text: string, type: TUIMessage['type']) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), text, type, timestamp: new Date() }]);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleKeyPress = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && inputValue.trim() !== '') {
      const command = inputValue.trim();
      addMessage(`> ${command}`, 'input');
      setInputValue('');
      setIsLoading(true);

      if (onCommandSubmit) {
        try {
          // Simulate backend processing for now if no onCommandSubmit is provided
          const response = await onCommandSubmit(command, agentId);
          if (response) {
            addMessage(response, 'output');
          } else if (!response && command.toLowerCase() !== 'clear') {
            addMessage('No response or command not processed.', 'output');
          }
        } catch (error: any) {
          addMessage(`Error: ${error.message || 'Failed to execute command.'}`, 'error');
        }
      } else {
        // Simulate local command processing if no onCommandSubmit prop
        if (command.toLowerCase() === 'help') {
          addMessage('Available mock commands: help, date, clear, test_error, test_system', 'output');
        } else if (command.toLowerCase() === 'date') {
          addMessage(new Date().toLocaleString(), 'output');
        } else if (command.toLowerCase() === 'clear') {
          setMessages([]);
        } else if (command.toLowerCase() === 'test_error') {
          addMessage('This is a test error message.', 'error');
        } else if (command.toLowerCase() === 'test_system') {
          addMessage('This is a test system message.', 'system');
        }
         else {
          addMessage(`Mock response to: ${command}`, 'output');
          await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
        }
      }
      setIsLoading(false);
    }
  };

  // Focus input on mount and when TUI becomes active/visible
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);


  return (
    <TUIContainer>
      <InfoBar>
        <AgentStatus>STATUS: <span>{agentThinking}</span></AgentStatus>
        <SystemProcesses>UTILIZING: <span>{currentSystemProcesses.join(', ')}</span></SystemProcesses>
      </InfoBar>

      <OutputArea ref={outputAreaRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`tui-message tui-message-${msg.type}`}>
            {msg.type === 'input' ? <PromptSymbol /> : null}
            {msg.text}
          </div>
        ))}
        {isLoading && <div className="tui-message tui-message-system">Processing...</div>}
      </OutputArea>

      <InputWrapper>
        <PromptSymbol>&gt;</PromptSymbol>
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          placeholder={isLoading ? 'Processing...' : `Enter command for agent ${agentId || '[None]'}`}
          disabled={isLoading}
        />
      </InputWrapper>

      <ProgressBarContainer>
        <ProgressBar>
          <ProgressBarFill progress={taskProgress} />
        </ProgressBar>
        <ProgressSquares>
          {Array.from({ length: 9 }).map((_, i) => (
            <Square key={i} index={i} active={i < activeSquares} />
          ))}
        </ProgressSquares>
        <PercentageText>{Math.round(taskProgress)}%</PercentageText>
      </ProgressBarContainer>
    </TUIContainer>
  );
};

export default FuturisticTUI;

// Basic CSS for message types (can be enhanced later)
// This could also be done within styled-components if preferred
const style = document.createElement('style');
style.textContent = `
  .tui-message {
    margin-bottom: 5px;
    line-height: 1.4;
  }
  .tui-message-input {
    color: #00FFFF; // Cyan for user input
  }
  .tui-message-output {
    color: #00FF41; // Green for AI output
  }
  .tui-message-system {
    color: #FFA500; // Orange for system messages
    font-style: italic;
  }
  .tui-message-error {
    color: #FF4136; // Red for errors
  }
`;
document.head.append(style);
