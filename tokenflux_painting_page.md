# Task: Implement TokenFlux Painting Page

I want you to implement a new painting page, `TokenFluxPage.tsx`, for interacting with the TokenFlux image generation API. This page should allow users to select a model, dynamically fill in parameters based on the model's schema, generate images, and view their generation history.

Please adhere to the existing project structure, coding style, and best practices found in `cherry-studio`. Use TypeScript for type safety.

Refer to `cherry-studio/src/renderer/src/pages/paintings/AihubmixPage.tsx` and `cherry-studio/src/renderer/src/pages/paintings/DmxapiPage.tsx` as primary examples for page structure, state management, UI components, and overall functionality.

## Files to Implement/Modify

1.  **`cherry-studio/src/renderer/src/pages/paintings/TokenFluxPage.tsx`**:

    - This file currently contains placeholder content. Replace it with the full implementation of the TokenFlux painting page.
    - It should take an `Options: string[]` prop, similar to other painting pages.

2.  **`cherry-studio/src/renderer/src/pages/paintings/config/tokenFluxConfig.ts`** (Create this file):

    - This file will store configurations specific to the TokenFlux page, such as the default painting state object, type definitions, and potentially helper functions for rendering forms from JSON schema.

3.  **`cherry-studio/src/renderer/src/pages/paintings/PaintingsRoutePage.tsx`**:

    - Ensure `TokenFluxPage` is correctly imported and used in the routes. The route `/tokenflux` and its presence in the `Options` array are already set up. Your main task is the implementation of `TokenFluxPage.tsx` itself.

4.  **Update `usePaintings` hook related types**:
    - If necessary, update types in `cherry-studio/src/renderer/src/types/index.d.ts` (or similar central type definition file) to include a new state key and type for TokenFlux paintings (e.g., `tokenFluxPaintings: TokenFluxPainting[]` in `PaintingsState` and the `TokenFluxPainting` type itself).

## TokenFlux API Details

The base URL for the TokenFlux API is: `https://api.tokenflux.ai/v1`

Assume the API key is available via `tokenfluxProvider.apiKey`, obtained using the `useAllProviders` hook, similar to other painting pages. All API requests should include this key if required by the API (e.g., in an `Authorization: Bearer <API_KEY>` header or a custom header like `Api-Key`).

### 1. List Models

- **Endpoint**: `GET /images/models`
- **Description**: Fetches all available models. The `input_schema` field in the response is a JSON schema that defines the input parameters for each model. This schema **must** be used to dynamically build the image generation form.
- **Response Example**:
  ```json
  {
    "success": true,
    "code": 200,
    "data": [
      {
        "id": "black-forest-labs/flux-1.1-pro-ultra",
        "name": "FLUX1.1 [pro] in ultra and raw modes",
        "model_provider": "black-forest-labs",
        "description": "FLUX1.1 [pro] in ultra and raw modes. Images are up to 4 megapixels. Use raw mode for realism.",
        "tags": ["image-to-image", "text-to-image"],
        "pricing": { "...": "..." },
        "input_schema": {
          "type": "object",
          "properties": {
            "prompt": {
              "type": "string",
              "description": "The main prompt for image generation."
            },
            "negative_prompt": {
              "type": "string",
              "description": "The negative prompt."
            },
            "width": {
              "type": "integer",
              "description": "Width of the image."
            },
            "height": {
              "type": "integer",
              "description": "Height of the image."
            },
            "aspect_ratio": {
              "type": "string",
              "default": "1:1",
              "description": "Aspect ratio for the generated image",
              "enum": ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21"]
            }
            // ... other parameters
          },
          "required": ["prompt"]
        }
      }
      // ... other models
    ]
  }
  ```

### 2. Generate Image

- **Endpoint**: `POST /images/generations`
- **Description**: Creates/starts an image generation task.
- **Request Body Example**:
  ```json
  {
    "model": "black-forest-labs/flux-schnell", // Selected model ID
    "input": {
      // Input parameters based on the model's input_schema
      "prompt": "a photo of a cat",
      "negative_prompt": "blurry",
      "width": 512,
      "height": 512,
      "steps": 20,
      "guidance_scale": 7.5,
      "seed": 42
      // ... other parameters from the dynamic form
    }
  }
  ```
- **Response Example** (The `id` is used to poll for the result):
  ```json
  {
    "success": true,
    "code": 200,
    "data": {
      "id": "2d8e9cda-b5ed-4115-897c-28f7da6c6b80",
      "model": "black-forest-labs/flux-schnell",
      "status": "starting" // or "pending", "processing"
    }
  }
  ```

### 3. Get Image Generation Result

- **Endpoint**: `GET /images/generations/{id}`
- **Description**: Fetches the result of an image generation task. This endpoint should be polled periodically after a generation is initiated until the `status` is `succeeded` or a terminal failure state.
- **Response Example** (when succeeded):
  ```json
  {
    "success": true,
    "code": 200,
    "data": {
      "id": "2d8e9cda-b5ed-4115-897c-28f7da6c6b80",
      "model": "black-forest-labs/flux-schnell",
      "status": "succeeded", // Other statuses: "failed", "processing"
      "images": [
        {
          "url": "https://replicate.delivery/xezq/..." // Image URL
        }
        // Potentially multiple images
      ],
      "error": null // or error details if status is "failed"
    }
  }
  ```

### 4. List All Generations (Optional for initial UI, good for context)

- **Endpoint**: `GET /images/generations`
- **Description**: Lists all generations for the user/API key. This might be useful for future enhancements or if a painting history needs to be synced from the server. For the initial version, focus on managing history via `usePaintings`.
- **Response Example**:
  ```json
  {
    "success": true,
    "code": 200,
    "data": [
      {
        "id": "2d8e9cda-b5ed-4115-897c-28f7da6c6b80",
        "model": "black-forest-labs/flux-schnell",
        "status": "succeeded",
        "images": [{ "url": "..." }]
      }
      // ... other generations
    ]
  }
  ```

## Core Requirements for `TokenFluxPage.tsx`

### 1. Layout & Structure:

- Follow a two-column layout similar to `AihubmixPage.tsx`:
  - **Left Panel (`LeftContainer`):** For configuration options.
    - Provider selection (using the `Options` prop, though TokenFluxPage is specific to 'tokenflux').
    - Model selection dropdown.
    - Dynamically generated form for model parameters.
  - **Main Panel (`MainContainer`):**
    - `Artboard` component for displaying generated images.
    - Prompt input area (e.g., `TextArea` from Ant Design).
    - Generation button (`SendMessageButton`).
  - **Right Panel (`PaintingsList`):** For displaying history of generations for TokenFlux.
- Use `Navbar` for the page title.
- Use `Scrollbar` component for scrollable areas.

### 2. Model Fetching and Selection:

- On component mount, fetch the list of models using `GET /images/models`.
- Store the models in component state (e.g., `useState<ModelType[]>([])`).
- Display model names in a `Select` component from Ant Design.
- When a model is selected, store its ID and its `input_schema` in state.

### 3. Dynamic Form Generation:

- **Crucial Requirement**: When a model is selected, dynamically render form fields based on its `input_schema` (JSON Schema).
- Map JSON schema properties to Ant Design form components:
  - `type: "string"` with `enum`: `Select` or `Radio.Group`.
  - `type: "string"` (no enum): `Input` (or `TextArea` for multi-line prompts).
  - `type: "integer"` or `type: "number"`: `InputNumber` or `Slider`.
  - `type: "boolean"`: `Switch`.
- Use `description` from the schema for labels or tooltips (`Tooltip` with `InfoIcon`).
- Use `default` values from the schema as initial form values.
- Clearly indicate `required` fields.
- Store the form data in component state (e.g., `useState<Record<string, any>>({})`).

### 4. Image Generation Workflow:

- Implement an `onGenerate` function triggered by the "Send" button.
- Construct the request body for `POST /images/generations` using the selected model ID and the current form data.
- Handle loading states (`isLoading`, `dispatch(setGenerating(true/false))` from `useRuntime`).
- Store the `id` from the generation response.
- Implement a polling mechanism:
  - After `POST /images/generations` returns successfully, start polling `GET /images/generations/{id}` every few seconds.
  - Continue polling until `status` is `succeeded` or `failed`.
  - If `succeeded`, extract image URLs, download/save them using `window.api.file.download` and `FileManager` (similar to other pages), and update the painting state.
  - If `failed`, display an error message.
  - Provide a way to cancel the polling/generation (e.g., `onCancel` for `Artboard`).

### 5. State Management:

- **Local State (`useState`):**
  - Selected model ID and schema.
  - List of available models.
  - Current form input values.
  - Loading indicators for API calls.
  - Current image generation task ID and status.
- **Persistent State (`usePaintings`):**
  - Define a `TokenFluxPainting` type (see `tokenFluxConfig.ts` section).
  - Use a unique namespace like `'tokenFluxPaintings'` with `usePaintings` hooks (`addPainting`, `removePainting`, `updatePainting`, `persistentData.tokenFluxPaintings`).
  - Each `TokenFluxPainting` object should store: `id` (UUID), `modelId`, `inputParams` (the form data used), `files` (array of `FileType`), `urls` (array of original image URLs), `status`, `timestamp`, etc.
- **Global State (`useRuntime`):**
  - Use `generating` state from `useRuntime` to indicate global generation activity.

### 6. UI Components:

- Utilize Ant Design components extensively (`Button`, `Select`, `Input`, `InputNumber`, `Slider`, `Switch`, `Spin`, `Tooltip`, `Radio`, `Form` if suitable for dynamic rendering).
- Reuse shared components:
  - `Artboard`: To display images, handle loading/cancel.
  - `PaintingsList`: To show generation history for TokenFlux.
  - `Navbar`, `NavbarCenter`, `NavbarRight`.
  - `Scrollbar`.
  - `SendMessageButton`.
  - `TranslateButton` (if applicable for prompts).
  - `SettingTitle`, `InfoIcon`.
- Implement internationalization using `useTranslation` (`t` function) for all static text.

### 7. Error Handling:

- Display user-friendly error messages for API failures or issues during generation (e.g., using `window.modal.error`).
- Handle cases where image URLs might be empty or invalid.

## Requirements for `cherry-studio/src/renderer/src/pages/paintings/config/tokenFluxConfig.ts`

1.  **`TokenFluxPainting` Type Definition**:

    ```typescript
    import type { FileType } from '@renderer/types' // Adjust import path if needed

    export interface TokenFluxModel {
      id: string
      name: string
      input_schema: any // Or a more specific JSONSchema type
      // ... other model properties
    }

    export interface TokenFluxPainting {
      id: string // Unique UUID for the painting entry
      modelId: string
      prompt?: string // Or make this part of inputParams
      inputParams: Record<string, any> // Stores the actual inputs used for generation
      files: FileType[] // Local file info after download
      urls: string[] // Original URLs from API
      status: 'pending' | 'succeeded' | 'failed' | 'polling'
      timestamp: number
      // ... any other relevant fields
    }
    ```

2.  **`DEFAULT_TOKENFLUX_PAINTING` Constant**:

    - Define a default state object for a new TokenFlux painting session.

    ```typescript
    import { uuid } from '@renderer/utils' // Adjust import

    export const DEFAULT_TOKENFLUX_PAINTING: TokenFluxPainting = {
      id: uuid(),
      modelId: '', // Should be set when a model is selected
      inputParams: {},
      files: [],
      urls: [],
      status: 'pending',
      timestamp: Date.now()
    }
    ```

3.  **Helper function for JSON Schema to Form (Optional but Recommended)**:
    - Consider creating a helper function or a small component within `TokenFluxPage.tsx` or this config file that takes a JSON schema property definition and returns the corresponding Ant Design form item. This will keep the main component cleaner.
    - Example signature: `function renderFormField(schemaProperty: any, propertyName: string, value: any, onChange: (field: string, value: any) => void): React.ReactNode;`

## General Guidelines

- Ensure all asynchronous operations are handled correctly with `async/await`.
- Manage component lifecycle and side effects with `useEffect`.
- Use `useCallback` and `useMemo` for performance optimizations where appropriate.
- Fetch API key from `tokenfluxProvider.apiKey` using `useAllProviders()`.
- The page should be responsive and user-friendly.

By following these detailed instructions and referencing the existing painting pages, you should be able to generate a robust `TokenFluxPage.tsx` and its associated configuration.
