/**
 * OpenAI API client for the chat widget
 */
import OpenAI from 'openai';

// Configuration
const API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';
const BASE_URL = import.meta.env.VITE_OPENAI_BASE_URL;

// Debug logging (can be removed in production)
if (import.meta.env.DEV) {
  console.log('OpenAI Environment Variables:', {
    hasApiKey: !!API_KEY,
    apiKeyLength: API_KEY?.length || 0,
    apiKeyPrefix: API_KEY?.substring(0, 10) || 'none',
    model: MODEL,
    baseUrl: BASE_URL
  });
}

// Initialize OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!API_KEY) {
    throw new Error('OpenAI API key not configured. Please set VITE_OPENAI_API_KEY in your .env file.');
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      dangerouslyAllowBrowser: true // Required for client-side usage
    });
  }

  return openaiClient;
}

export interface FileModification {
  type: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  reason?: string;
}

export interface AIAction {
  type: 'modify_files' | 'create_file' | 'delete_file' | 'open_file' | 'save_canvas_image';
  data: any;
  description: string;
}

export interface ChatContext {
  shapeReferences?: number[];
  workspaceFiles?: { name: string; content: string; language: string }[];
  allFiles?: Record<string, string>;
  projectStructure?: string[];
  canvasInfo?: {
    totalShapes: number;
    selectedShapes: number[];
    viewportInfo: string;
  };
  imageShapes?: {
    id: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    original_width: number;
    original_height: number;
    data_url: string;
    suggested_filename?: string;
    available_actions?: {
      save_as_asset: {
        action_type: string;
        description: string;
        example_usage: string;
      };
    };
  }[];
  canvasAssetWorkflow?: {
    description: string;
    steps: string[];
    available_actions: string[];
  } | null;
  selectedImages?: {
    id: number;
    position: { x: number; y: number };
    width: number;
    height: number;
    original_width: number;
    original_height: number;
    data_url: string;
  }[];
}

/**
 * Send a message to OpenAI and get a response
 */
export async function sendChatMessage(
  userMessage: string,
  context?: ChatContext,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<string> {
  try {
    const client = getOpenAIClient();

    // Build system prompt with context
    let systemPrompt = `You are an AI assistant for a spatial IDE called tldraw-ng. This is a high-performance collaborative whiteboard built with Rust + WebGPU and SolidJS.

The spatial IDE includes these widgets:
- Monaco Editor: Full VS Code experience with syntax highlighting
- Terminal: Command-line interface with WebContainer integration
- Preview: Live preview of HTML/web applications
- Explorer: File browser for project files
- Console: Project console output
- Chat: AI assistant (you!)

You can help users with:
- Code analysis and suggestions
- Project structure and architecture
- Debugging and troubleshooting
- Spatial IDE workflow optimization
- Shape and widget management
- DIRECT CODE MODIFICATIONS
- Image analysis and screenshot interpretation

IMPORTANT: You can directly modify files in the workspace! When suggesting code changes, you can:
1. Provide the complete updated file content
2. Use action syntax to specify file modifications
3. Create, update, or delete files as needed

When making file modifications, use this format in your response:
\`\`\`action:modify_file
{
  "path": "/src/App.tsx",
  "content": "// Complete file content here",
  "reason": "Brief explanation of changes"
}
\`\`\`

Or for multiple files:
\`\`\`action:modify_files
[
  {
    "type": "update",
    "path": "/src/App.tsx",
    "content": "// Updated content",
    "reason": "Updated component logic"
  },
  {
    "type": "create",
    "path": "/src/NewComponent.tsx",
    "content": "// New file content",
    "reason": "Added new component"
  }
]
\`\`\`

Be helpful, concise, and focus on practical advice for development workflows.`;

    // Add context information
    if (context) {
      if (context.shapeReferences && context.shapeReferences.length > 0) {
        systemPrompt += `\n\nThe user is referencing these shapes on the canvas: ${context.shapeReferences.join(', ')}`;
      }

      if (context.allFiles && Object.keys(context.allFiles).length > 0) {
        systemPrompt += `\n\nComplete workspace files:`;
        Object.entries(context.allFiles).forEach(([path, content]) => {
          systemPrompt += `\n\n=== ${path} ===\n${content}`;
        });
      } else if (context.workspaceFiles && context.workspaceFiles.length > 0) {
        systemPrompt += `\n\nCurrent workspace files:`;
        context.workspaceFiles.forEach(file => {
          systemPrompt += `\n- ${file.name} (${file.language}): ${file.content.substring(0, 200)}${file.content.length > 200 ? '...' : ''}`;
        });
      }

      if (context.projectStructure && context.projectStructure.length > 0) {
        systemPrompt += `\n\nProject structure: ${context.projectStructure.join(', ')}`;
      }

      if (context.canvasInfo) {
        systemPrompt += `\n\nCanvas state: ${context.canvasInfo.totalShapes} total shapes, ${context.canvasInfo.selectedShapes.length} selected`;
      }

      if (context.imageShapes && context.imageShapes.length > 0) {
        systemPrompt += `\n\nImages on canvas: ${context.imageShapes.length} image(s)`;
        context.imageShapes.forEach((image, index) => {
          systemPrompt += `\n- Image ${image.id}: ${image.width}x${image.height} at (${image.position.x.toFixed(1)}, ${image.position.y.toFixed(1)})`;
        });
        systemPrompt += `\n\nWhen analyzing images, please describe what you see in detail, including any text, logos, UI elements, code, or other content. Be specific about colors, layout, and any readable text.`;
      }

      if (context.selectedImages && context.selectedImages.length > 0) {
        systemPrompt += `\n\n🎯 SELECTED IMAGES: The user has selected ${context.selectedImages.length} image(s) on the canvas:`;
        context.selectedImages.forEach((image) => {
          systemPrompt += `\n- Image ${image.id}: ${image.width}x${image.height} at (${image.position.x.toFixed(1)}, ${image.position.y.toFixed(1)})`;
        });
        systemPrompt += `\n\nThe user is likely asking about these specific selected images. Focus your response on these images and offer relevant actions like saving them as project assets or integrating them into the code.`;
      }
    }

    // Build messages array
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (limit to last 10 messages to avoid token limits)
    const recentHistory = conversationHistory.slice(-10);
    messages.push(...recentHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })));

    // Add current user message with potential images
    const hasImages = context?.imageShapes && context.imageShapes.length > 0;

    if (hasImages) {
      // Use vision-capable model and message format
      const userContent: any[] = [
        { type: 'text', text: userMessage }
      ];

      // Add images to the message
      context!.imageShapes!.forEach(image => {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: image.data_url,
            detail: 'high' // Use 'high' for better text recognition and detail analysis
          }
        });
      });

      messages.push({ role: 'user', content: userContent });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    // Make API call with appropriate model
    const completion = await client.chat.completions.create({
      model: hasImages ? 'gpt-4o' : MODEL, // Use vision model if images present
      messages,
      max_tokens: 1000,
      temperature: 0.7,
      stream: false
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response received from OpenAI');
    }

    return response;

  } catch (error) {
    console.error('OpenAI API error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('API key')) {
        throw new Error('OpenAI API key is invalid or missing. Please check your .env file.');
      } else if (error.message.includes('quota')) {
        throw new Error('OpenAI API quota exceeded. Please check your billing settings.');
      } else if (error.message.includes('rate limit')) {
        throw new Error('OpenAI API rate limit exceeded. Please try again in a moment.');
      } else {
        throw new Error(`OpenAI API error: ${error.message}`);
      }
    }
    
    throw new Error('Failed to get response from OpenAI');
  }
}

/**
 * Check if OpenAI is properly configured
 */
export function isOpenAIConfigured(): boolean {
  return !!API_KEY;
}

/**
 * Parse AI actions from response text
 */
export function parseAIActions(responseText: string): AIAction[] {
  const actions: AIAction[] = [];

  // Look for action blocks in the response
  const actionRegex = /```action:(\w+)\n([\s\S]*?)\n```/g;
  let match;

  while ((match = actionRegex.exec(responseText)) !== null) {
    const actionType = match[1];
    const actionData = match[2];

    try {
      const parsedData = JSON.parse(actionData);

      switch (actionType) {
        case 'modify_file':
          actions.push({
            type: 'modify_files',
            data: [{ type: 'update', ...parsedData }],
            description: `Update ${parsedData.path}`
          });
          break;

        case 'modify_files':
          actions.push({
            type: 'modify_files',
            data: Array.isArray(parsedData) ? parsedData : [parsedData],
            description: `Modify ${Array.isArray(parsedData) ? parsedData.length : 1} file(s)`
          });
          break;

        case 'create_file':
          actions.push({
            type: 'create_file',
            data: parsedData,
            description: `Create ${parsedData.path}`
          });
          break;

        case 'delete_file':
          actions.push({
            type: 'delete_file',
            data: parsedData,
            description: `Delete ${parsedData.path}`
          });
          break;

        case 'open_file':
          actions.push({
            type: 'open_file',
            data: parsedData,
            description: `Open ${parsedData.path}`
          });
          break;

        case 'save_canvas_image':
          actions.push({
            type: 'save_canvas_image',
            data: parsedData,
            description: `Save image ${parsedData.imageId} as ${parsedData.filename}`
          });
          break;
      }
    } catch (e) {
      console.warn('Failed to parse AI action:', actionType, actionData, e);
    }
  }

  return actions;
}

/**
 * Remove action blocks from response text for display
 */
export function cleanResponseText(responseText: string): string {
  return responseText.replace(/```action:(\w+)\n([\s\S]*?)\n```/g, '').trim();
}

/**
 * Get current OpenAI configuration info
 */
export function getOpenAIConfig() {
  return {
    hasApiKey: !!API_KEY,
    model: MODEL,
    baseUrl: BASE_URL || 'https://api.openai.com/v1'
  };
}
