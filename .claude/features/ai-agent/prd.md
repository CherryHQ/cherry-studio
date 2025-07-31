
# Product Requirements Document: AI Agent

**Author:** Gemini
**Status:** In Development
**Last Updated:** July 29, 2025

---

## 1. Introduction & Vision

The **AI Agent** feature introduces a new, powerful capability within Cherry Studio, allowing users to create, manage, and deploy autonomous AI agents. These agents are specialized, configurable entities designed to perform complex, multi-step tasks by leveraging the application's core functionalities, such as large language models (LLMs), knowledge bases, and external tools.

The vision is to transform Cherry Studio from a conversational AI assistant into a proactive work platform where users can build a personalized team of AI agents to automate workflows, conduct research, manage code, and more, ultimately enhancing productivity and creativity.

## 2. Target Audience

This feature is designed for advanced users, developers, and power users of Cherry Studio who want to:
-   Automate repetitive or complex workflows.
-   Create specialized AI assistants tailored to specific domains (e.g., code security, unit test generation, content creation).
-   Leverage the full power of integrated LLMs and tools in a more autonomous fashion.

## 3. User Problems & Goals

### 3.1. Problem Statement
Users currently interact with AI models on a per-request basis. For complex tasks requiring multiple steps, context retention, and tool usage (e.g., "Scan the codebase for security issues, summarize the findings, and draft a commit message"), users must manually guide the AI through each step. This process is time-consuming, inefficient, and limits the AI's potential.

### 3.2. Goals & Success Metrics
-   **Goal:** Empower users to automate complex, multi-step tasks with minimal manual intervention.
-   **Goal:** Provide a framework for creating highly specialized and reusable AI entities.
-   **Success Metrics:**
    -   Number of agents with at least one successful execution (measures engagement, not just creation).
    -   Average reduction in time spent on multi-step tasks (measured via targeted surveys).
    -   Agent execution success rate (completed vs. failed sessions).
    -   User satisfaction surveys with specific questions about productivity improvements.
    -   Adoption rate of the AI Agent feature among the target audience (monthly active users).

## 4. Feature Breakdown

The AI Agent feature will be delivered through a dedicated page accessible from the main sidebar, with the following key components:

### 4.1. AI Agent Hub Page
This will be the central page for managing all AI Agents.
-   **Layout:** A two-column layout consistent with the application's design.
    -   **Left Column (Agent List):** A scrollable list of all created agents.
        -   Each list item will display the agent's icon, name, and a brief description.
        -   A prominent **"+ New Agent"** button will be at the top.
        -   A search bar to filter agents by name.

### 4.1.1. Agent Templates
To improve onboarding and provide immediate value, the **"+ New Agent"** button will offer two options:
-   **Start from Scratch:** Creates a blank agent configuration.
-   **Use a Template:** Provides pre-built agents with configured system prompts and tools:
    -   **Code Documenter:** Generates documentation for code files with file system access and web search.
    -   **Unit Test Generator:** Creates comprehensive unit tests with code interpreter and file system access.
    -   **PRD Reviewer:** Reviews product requirements documents with web search and knowledge base access.

Templates serve as learning tools and provide immediate productivity value for new users.
    -   **Right Column (Agent Details/Editor):** Displays the configuration for the selected agent or the creation form for a new agent.

### 4.2. Agent Configuration (Creation & Editing)
This form-based view allows users to define an agent's properties and capabilities.

-   **Core Details:**
    -   **Avatar:** An icon for the agent (upload or select from a predefined set).
    -   **Name (Required):** A unique, user-friendly name (e.g., "Unit Test Bot").
    -   **Description:** A brief explanation of the agent's purpose.

-   **Behavior & Intelligence:**
    -   **System Prompt (Required):** The core instructions defining the agent's persona, goals, and operational constraints. This is the agent's constitution.
    -   **LLM Model (Required):** A dropdown to select the primary language model that will power the agent's reasoning. The list will be populated from the models configured in the application's settings.
    -   **Temperature & Top-P:** Sliders to control the creativity and determinism of the agent's responses.

-   **Capabilities & Tools:**
    -   **Knowledge Base Access:** A multi-select dropdown to grant the agent access to one or more existing knowledge bases. The agent will be able to query these for information to complete its tasks.
    -   **Tool Integration:** A checklist of available system tools that the agent can use. Initial tools will include:
        -   **Web Search:** To access real-time information from the internet.
        -   **Code Interpreter:** To execute code (Python, JavaScript) in a sandboxed environment for data analysis, file manipulation, etc.
        -   **File System Access (Read/Write):** To read from and write to the local file system. *(Uses Workspace Sandbox security model - see Security section)*.

-   **Actions:**
    -   **Save Agent:** Saves the current configuration.
    -   **Delete Agent:** Deletes the agent with a confirmation dialog.
    -   **Execute:** Opens the execution view to run the agent.

### 4.3. Agent Execution
-   **Execution Panel:** When a user clicks "Execute," a panel or modal will appear.
    -   **User Input:** A text area for the user to provide the specific task or goal for the current run (e.g., "Generate unit tests for `auth.service.ts`").
    -   **Execution Controls:**
        -   **Start Execution:** Begin the agent's task.
        -   **Stop Execution:** Prominent red button to immediately halt the agent's execution.
        -   **Status Indicator:** Shows current status (Running, Completed, Failed, Stopped).
    -   **Live Log:** A real-time log displaying the agent's process. The entire execution, including thoughts, actions, and observations, will be saved to the new execution history tables in the database.
        -   **Thought:** The agent's reasoning and plan.
        -   **Action:** The specific tool being used and the parameters.
        -   **Observation:** The result or output from the tool.
        -   **Final Answer:** The agent's concluding response or result.
-   **Recent Executions:** The main agent hub page will display a list of recent sessions pulled from the `sessions` table, showing the agent(s) used, the initial prompt, status (Completed, Failed, Stopped), and timestamp. Clicking on a past session will open a read-only view of its full, persisted log.

## 5. Design & UX
-   The UI will strictly adhere to the existing Cherry Studio design system, ensuring a consistent and familiar user experience.
-   Interactions such as creating, editing, and deleting agents will use standard application components (modals, buttons, forms).
-   The agent execution log will be clearly formatted and color-coded to distinguish between thoughts, actions, and observations, making it easy for users to follow the agent's workflow.

## 6. Technical Requirements
-   **Data Schema:** The following tables will be added to the application database (`libsql`).

    -   **`agents` Table:** Stores the configuration for each agent. All agent properties are persisted here as the single source of truth.
        -   `id` (Primary Key)
        -   `name` (TEXT, required)
        -   `description` (TEXT)
        -   `avatar` (TEXT)
        -   `instructions` (TEXT, for System Prompt)
        -   `model` (TEXT, model id, required)
        -   `tools` (JSON array of enabled tool IDs, e.g., `['web_search', 'code_interpreter']`)
        -   `knowledges` (JSON array of enabled knowledge base IDs)
        -   `configuration` (JSON, for storing extensible settings like `temperature`, `top_p`, and other model-specific parameters.)
        -   `created_at` / `updated_at` (TIMESTAMPS)

    -   **Execution History Tables:** To log every agent execution in a scalable and queryable manner, two tables will be created:

        1.  **`sessions` Table:** Stores high-level information about each execution run.
            -   `id` (Primary Key)
            -   `agent_ids` (JSON array of agent IDs involved, supporting future multi-agent scenarios)
            -   `user_prompt` (TEXT, the initial user goal for the session)
            -   `status` (TEXT, e.g., 'running', 'completed', 'failed', 'stopped')
            -   `accessible_paths` (JSON array of directory paths the agent can access during this session)
            -   `created_at` / `updated_at` (TIMESTAMPS)

        2.  **`session_logs` Table:** Stores the detailed, turn-by-turn history of a session, capturing all interactions from both the user and the agent(s). This creates a complete, reproducible log of the conversation.
            -   `id` (Primary Key)
            -   `session_id` (INTEGER, Foreign Key to `sessions.id`)
            -   `parent_id` (INTEGER, Foreign Key to `session_logs.id`, nullable). This allows logs to be structured in a tree, representing replies or branching thoughts.
            -   `role` (TEXT, NOT NULL, e.g., 'user', 'agent'). Specifies the author of the log entry.
            -   `type` (TEXT, NOT NULL, e.g., 'message', 'thought', 'action', 'observation'). The specific type of the log entry.
            -   `content` (JSON, NOT NULL). The structured data for the log entry. Examples:
                -   For a user message: `{"text": "Can you find the latest TS files?"}`
                -   For an agent's thought: `{"text": "I need to use the file system tool to find files."}`
                -   For an agent's action: `{"tool": "file_system", "input": {"operation": "find", "pattern": "*.ts"}}`
            -   `created_at` (TIMESTAMP)

-   **State Management:** The database will serve as the single source of truth for all agent data. The renderer's Redux store (`@renderer/store/`) will act as a client-side cache, holding agent data fetched from the database. All mutations (create, update, delete) will be sent to the main process, persisted in the database, and the updated state will then be synchronized back to the Redux store to update the UI. This approach ensures data persistence and consistency.
-   **Execution Logic:** The core agent execution loop (the "ReAct" or "Plan-and-Execute" model) will be implemented in the main process (`src/main/`) to handle long-running tasks and secure access to system resources like the file system.

## 7. Security & Error Handling

### 7.1. Workspace Sandbox Security Model
To ensure secure file system access while maintaining usability:

-   **Path Restrictions:** Agents can only access directories specified in the session's `accessible_paths` field. By default, this is limited to the current project directory.
-   **Permission Prompts:** For write operations (create, modify, delete files), the system prompts for user confirmation by default. Users can opt for "Allow all write actions for this session" to streamline complex tasks.
-   **Access Logging:** All file system operations are logged in the `session_logs` table for transparency and security auditing.

### 7.2. Execution Control & Error Handling
-   **Resource Limits:** Agents are limited to a maximum number of steps (default: 50) and tool uses per session to prevent runaway costs and performance issues.
-   **Manual Stop:** Users can immediately halt agent execution using the "Stop Execution" button.
-   **Failure States:** When an agent encounters errors:
    -   The session status is updated to 'failed'.
    -   Error messages from `session_logs` are displayed to help users diagnose problems.
    -   Examples: "Tool Error: Web search failed," "LLM response invalid," "File access denied."
-   **Graceful Degradation:** If a tool becomes unavailable, the agent attempts to continue with available tools or asks the user for guidance.

## 8. Out of Scope for V1
To ensure a focused and timely initial release, the following features will be considered for future versions:
-   Agent sharing, importing, or a community marketplace.
-   Complex agent-to-agent communication (agent chaining).
-   Scheduled or trigger-based agent executions (e.g., running a security scan every night).
-   Advanced debugging tools for agent workflows (e.g., visual flow charts).
-   Agent versioning.
