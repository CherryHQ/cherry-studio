# Cherry Studio Memory Feature Guide

## Overview

Cherry Studio's memory feature is a powerful tool that helps AI assistants remember important information, user preferences, and context from conversations. With memory enabled, your AI assistant can:

- **Remember important information**: Automatically extract and store key facts from conversations
- **Personalize responses**: Provide more personalized and relevant answers based on stored memories
- **Smart retrieval**: Automatically search relevant memories when needed, enhancing conversation coherence
- **Multi-user support**: Maintain independent memory contexts for different users

The memory feature is particularly useful for scenarios requiring long-term context retention, such as personal assistants, customer service, and educational tutoring.

## How to Enable Memory

### 1. Global Configuration (First-time Setup)

Before using the memory feature, you need to configure it globally:

1. Click the **Memory** icon (memory stick icon) in the sidebar to enter the memory management page
2. Click the **More** button (three dots) in the upper right corner, select **Settings**
3. In the settings dialog, configure the following required items:
   - **LLM Model**: Select the language model for processing memories (GPT-4 or Claude recommended)
   - **Embedding Model**: Select the model for generating vector embeddings (e.g., text-embedding-3-small)
   - **Embedding Dimensions**: Enter the embedding model dimensions (typically 1536)
4. Click **OK** to save

> **Note**: The embedding model and dimensions cannot be changed once set. Choose carefully.

### 2. Enable Memory for an Assistant

After completing global configuration, you can enable memory for specific assistants:

1. Go to the **Assistants** page
2. Select the assistant you want to enable memory for, click **Edit**
3. Find the **Memory** section in the assistant settings
4. Toggle the memory feature on
5. Save the assistant settings

Once enabled, the assistant will automatically extract and use memories during conversations.

## Usage

### View Memories

1. Click the **Memory** icon in the sidebar to enter the memory management page
2. You can see all stored memory cards, including:
   - Memory content
   - Creation time
   - Associated user

### Add Memories

There are two ways to manually add memories:

**Method 1: Add from the memory management page**

1. Click the **Add Memory** button in the upper right corner
2. Enter the memory content in the dialog
3. Click **Add** to save

**Method 2: Automatic extraction from conversations**

- When an assistant has memory enabled, the system automatically extracts important information from conversations and stores it as memories

### Edit Memories

1. Click the **More** button (three dots) on a memory card
2. Select **Edit**
3. Modify the memory content
4. Click **Save**

### Delete Memories

1. Click the **More** button on a memory card
2. Select **Delete**
3. Confirm the deletion

## Memory Search

The memory management page provides powerful search capabilities:

1. Enter keywords in the search box at the top of the page
2. The system filters matching memories in real-time
3. Search supports fuzzy matching across any part of the memory content

## User Management

The memory feature supports multiple users with independent memory stores:

### Switch Users

1. On the memory management page, click the user selector in the upper right corner
2. Select the user to switch to
3. The page automatically loads that user's memories

### Add New User

1. Click the user selector
2. Select **Add New User**
3. Enter a user ID (supports letters, numbers, underscores, and hyphens)
4. Click **Add**

### Delete User

1. Switch to the user you want to delete
2. Click the **More** button in the upper right corner
3. Select **Delete User**
4. Confirm deletion (Note: this will delete all memories for that user)

> **Tip**: The default user (default-user) cannot be deleted.

## Settings

### LLM Model

- The language model used for memory extraction and updates
- Recommended to select a capable model for better memory extraction quality
- Can be changed at any time

### Embedding Model

- Used to convert text into vectors for semantic search
- Cannot be changed once set (to maintain compatibility with existing memories)
- OpenAI's text-embedding series models are recommended

### Embedding Dimensions

- The dimension of embedding vectors, must match the selected embedding model
- Common dimensions:
  - text-embedding-3-small: 1536
  - text-embedding-3-large: 3072
  - text-embedding-ada-002: 1536

### Custom Prompts (Optional)

- **Fact Extraction Prompt**: Customize how information is extracted from conversations
- **Memory Update Prompt**: Customize how existing memories are updated

## Best Practices

### 1. Organize Memories Effectively

- Keep memories concise and focused on a single piece of information each
- Use clear language to describe facts, avoid vague expressions
- Regularly review and clean up outdated or inaccurate memories

### 2. Multi-user Scenarios

- Create independent users for different use cases (e.g., work, personal, learning)
- Use meaningful user IDs for easy identification and management
- Regularly back up important user memory data

### 3. Model Selection Tips

- **LLM Model**: GPT-4, Claude 3, and similar advanced models extract and understand information more accurately
- **Embedding Model**: Choose a model that matches your primary language

### 4. Performance Optimization

- Avoid storing too many redundant memories, as this may affect search performance
- Regularly consolidate similar memories
- For large memory stores, consider organizing by topic or time

## FAQ

### Q: Why can't I enable the memory feature?

A: Make sure you have completed the global configuration, including selecting an LLM model and embedding model.

### Q: Will memories sync across all assistants automatically?

A: No. Memory must be enabled individually for each assistant, and memories are isolated per user.

### Q: How can I export my memory data?

A: Direct export is not currently supported, but all memories are stored in the local database.

### Q: Can deleted memories be recovered?

A: Deletion is permanent and cannot be undone. Please confirm carefully before deleting.

### Q: Does the memory feature affect conversation speed?

A: Memory processing is handled asynchronously in the background and does not noticeably affect response speed. However, a large number of memories may slightly increase search time.

### Q: How do I clear all memories?

A: You can delete the current user and recreate them, or manually delete all memory entries.

## Important Notes

### Privacy

- All memory data is stored on your local device and is not uploaded to the cloud
- Do not store sensitive information (such as passwords, private keys) in memories
- Regularly review memory content to ensure no unexpected private information is stored

### Data Security

- Memory data is stored in the local database
- Regular backups of important data are recommended
- Remember to migrate memory data when switching devices

### Usage Limits

- Each memory entry should not exceed 500 characters
- Each user's memory count should be kept under 1,000 entries
- Excessive memories may affect system performance

## Technical Details

The memory feature uses advanced RAG (Retrieval-Augmented Generation) technology:

1. **Information Extraction**: Uses LLM to intelligently extract key information from conversations
2. **Vector Storage**: Converts text into vectors via embedding models for semantic search
3. **Smart Retrieval**: Automatically searches relevant memories during conversations to provide context to the AI
4. **Continuous Learning**: Continuously updates and refines the memory store as conversations progress
