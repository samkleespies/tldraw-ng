import { Component, createSignal, onMount, For } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';
import {
  sendChatMessage,
  isOpenAIConfigured,
  getOpenAIConfig,
  parseAIActions,
  cleanResponseText,
  type ChatContext,
  type AIAction
} from '../../utils/openai-client';
import { getCanvasAssetContext, saveCanvasImageAsAsset } from '../../utils/vite-canvas-assets';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  shapeReferences?: number[];
  actions?: AIAction[];
  cleanContent?: string;
}

export interface ChatWidgetProps {
  id: number;
  conversationId: string;
  width: number;
  height: number;
  active: boolean;
  onMessage?: (message: ChatMessage) => void;
}

/**
 * AI Chat Widget - OpenAI integration with shape referencing
 */
export const ChatWidget: Component<ChatWidgetProps> = (props) => {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [inputValue, setInputValue] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [conversationHistory, setConversationHistory] = createSignal<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [autoApplyActions, setAutoApplyActions] = createSignal(false);
  const [selectedImageShapes, setSelectedImageShapes] = createSignal<any[]>([]);

  const widgetLinking = useWidgetLinking();
  const { handleTitleBarDrag } = widgetLinking;
  
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;

  onMount(() => {
    console.log(`💬 Initializing Chat Widget ${props.id}`);

    // Check OpenAI configuration
    const config = getOpenAIConfig();
    console.log('OpenAI config:', config);

    // Add welcome message
    const welcomeMessage: ChatMessage = {
      id: 'welcome',
      role: 'assistant',
      content: isOpenAIConfigured()
        ? `Hello! I'm your AI assistant for the spatial IDE. I can help you with:

• Code analysis and suggestions
• Shape references using @shapeId syntax
• Project structure and architecture
• Debugging and troubleshooting
• **Direct code modifications** with action buttons

💡 **Tip**: Toggle the "Auto" button in the title bar to automatically apply my code changes, or leave it off to review changes before applying them manually.

Try asking me about your code or reference shapes on the canvas!`
        : `⚠️ OpenAI API not configured. Please set your VITE_OPENAI_API_KEY in the .env file to enable AI responses.

For now, I can only provide basic help messages. Get your API key from: https://platform.openai.com/api-keys`,
      timestamp: new Date()
    };

    setMessages([welcomeMessage]);

    // Check for selected images periodically
    const checkSelectedImages = () => {
      try {
        const core = (window as any).whiteboardCore;
        if (core && core.get_selected_image_shapes) {
          const selectedImagesJson = core.get_selected_image_shapes();
          const selectedImages = JSON.parse(selectedImagesJson);
          setSelectedImageShapes(selectedImages);
        }
      } catch (e) {
        // Ignore errors
      }
    };

    // Check immediately and then every 500ms
    checkSelectedImages();
    const interval = setInterval(checkSelectedImages, 500);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  });

  /**
   * Send message to AI
   */
  const sendMessage = async () => {
    const content = inputValue().trim();
    if (!content || isLoading()) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
      shapeReferences: extractShapeReferences(content)
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    // Add user message to conversation history
    setConversationHistory(prev => [...prev, { role: 'user', content }]);

    // Scroll to bottom after adding user message
    scrollToBottom();

    try {
      let aiResponse: string;

      if (!isOpenAIConfigured()) {
        // Fallback response when OpenAI is not configured
        aiResponse = `I'd love to help, but I need an OpenAI API key to provide intelligent responses. Please set VITE_OPENAI_API_KEY in your .env file.

For now, here are some things you can try:
• Create Monaco Editor widgets for code editing
• Use Terminal widgets for command-line operations
• Add Preview widgets to see your work live
• Reference shapes using @shape[ID] syntax

Get your API key from: https://platform.openai.com/api-keys`;
      } else {
        // Build context for the AI
        const canvasAssets = getCanvasAssets();
        const context: ChatContext = {
          shapeReferences: userMessage.shapeReferences,
          allFiles: getAllWorkspaceFiles(),
          projectStructure: getProjectStructure(),
          canvasInfo: getCanvasInfo(),
          imageShapes: canvasAssets.images,
          canvasAssetWorkflow: canvasAssets.workflow_info,
          selectedImages: selectedImageShapes() // Add selected images to context
        };

        // Call real OpenAI API
        aiResponse = await sendChatMessage(content, context, conversationHistory());
      }

      // Parse AI actions from the response
      const actions = parseAIActions(aiResponse);
      const cleanContent = cleanResponseText(aiResponse);

      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: aiResponse,
        cleanContent: cleanContent,
        actions: actions,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Add assistant response to conversation history
      setConversationHistory(prev => [...prev, { role: 'assistant', content: aiResponse }]);

      // Scroll to bottom after adding assistant message
      scrollToBottom();

      // Auto-apply actions if enabled
      if (autoApplyActions() && actions.length > 0) {
        console.log('🤖 Auto-applying AI actions:', actions);
        for (const action of actions) {
          try {
            await executeAction(action);
          } catch (e) {
            console.error('Failed to auto-apply action:', action, e);
            // Continue with other actions even if one fails
          }
        }
      }

      props.onMessage?.(assistantMessage);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get AI response';
      setError(errorMsg);
      console.error('Chat error:', err);
    } finally {
      setIsLoading(false);
      scrollToBottom();
    }
  };

  /**
   * Extract shape references from message content
   */
  const extractShapeReferences = (content: string): number[] => {
    // Match both @shape123 and @image123 patterns
    const shapeMatches = content.match(/@shape(\d+)/g) || [];
    const imageMatches = content.match(/@image(\d+)/g) || [];

    const allMatches = [...shapeMatches, ...imageMatches];
    if (allMatches.length === 0) return [];

    return allMatches.map(match => {
      const id = match.replace(/@(shape|image)/, '');
      return parseInt(id, 10);
    }).filter(id => !isNaN(id));
  };

  /**
   * Get all workspace files for complete context
   */
  const getAllWorkspaceFiles = (): Record<string, string> => {
    try {
      return widgetLinking.getAllFiles();
    } catch (e) {
      console.log('Could not get all workspace files:', e);
      return {};
    }
  };

  /**
   * Get project structure
   */
  const getProjectStructure = (): string[] => {
    try {
      return widgetLinking.getProjectStructure();
    } catch (e) {
      console.log('Could not get project structure:', e);
      return [];
    }
  };

  /**
   * Execute AI action
   */
  const executeAction = async (action: AIAction) => {
    try {
      switch (action.type) {
        case 'modify_files':
          widgetLinking.applyFileModifications(action.data);
          console.log('✅ Applied file modifications:', action.data);
          break;

        case 'create_file':
          widgetLinking.createFile(action.data.path, action.data.content);
          console.log('✅ Created file:', action.data.path);
          break;

        case 'delete_file':
          widgetLinking.deleteFile(action.data.path);
          console.log('✅ Deleted file:', action.data.path);
          break;

        case 'save_canvas_image':
          const filename = await saveCanvasImageAsAsset(action.data.imageId, action.data.filename);
          console.log('✅ Saved canvas image as asset:', filename);
          break;

        case 'open_file':
          widgetLinking.openFileInEditor(action.data.path);
          console.log('✅ Opened file:', action.data.path);
          break;

        default:
          console.warn('Unknown action type:', action.type);
      }
    } catch (e) {
      console.error('Failed to execute action:', action, e);
      setError(`Failed to execute action: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };

  /**
   * Get canvas information for context
   */
  const getCanvasInfo = () => {
    try {
      const core = (window as any).whiteboardCore;
      if (core) {
        // Use the correct API methods from the Rust core
        const totalShapes = core.shape_count ? core.shape_count() : 0;
        const selectedCount = core.selected_count ? core.selected_count() : 0;

        // Get active widgets info
        let widgetInfo = '';
        try {
          const activeWidgets = core.get_active_widgets ? core.get_active_widgets() : '[]';
          const widgets = JSON.parse(activeWidgets);
          if (widgets.length > 0) {
            widgetInfo = `, ${widgets.length} active widgets`;
          }
        } catch (e) {
          // Ignore widget parsing errors
        }

        return {
          totalShapes,
          selectedShapes: [], // We don't have individual IDs, just count
          selectedCount,
          viewportInfo: `Canvas with ${totalShapes} shapes, ${selectedCount} selected${widgetInfo}`
        };
      }
    } catch (e) {
      console.log('Could not get canvas info:', e);
    }

    return {
      totalShapes: 0,
      selectedShapes: [],
      selectedCount: 0,
      viewportInfo: 'Canvas information not available'
    };
  };

  /**
   * Get canvas asset context for AI
   */
  const getCanvasAssets = () => {
    try {
      return getCanvasAssetContext();
    } catch (e) {
      console.log('Could not get canvas assets:', e);
      return { images: [], workflow_info: null };
    }
  };

  /**
   * Handle key press in input
   */
  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Scroll to bottom of messages
   */
  const scrollToBottom = () => {
    // Use requestAnimationFrame for smoother scrolling
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (messagesRef) {
          messagesRef.scrollTop = messagesRef.scrollHeight;
        }
      }, 50);
    });
  };

  /**
   * Format message content with shape references
   */
  const formatMessageContent = (content: string) => {
    return content.replace(/@shape(\d+)/g, '<span style="background: #0e639c; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">@shape$1</span>');
  };

  return (
    <div style={`width: 100%; height: 100%; display: flex; flex-direction: column; background: #1e1e1e; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}>
      {/* Draggable Title Bar */}
      <div
        style="
          background: #2d2d30;
          color: #cccccc;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: move;
          user-select: none;
          border-bottom: 1px solid #3e3e42;
        "
        onMouseDown={(e) => {
          // Use the drag handler from context
          if (handleTitleBarDrag) {
            handleTitleBarDrag(e, props.id);
          }
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span style="font-weight: 600;">AI Assistant</span>

        {/* Auto-apply toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setAutoApplyActions(!autoApplyActions());
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={`
            background: ${autoApplyActions() ? '#0e639c' : 'transparent'};
            color: ${autoApplyActions() ? 'white' : '#cccccc'};
            border: 1px solid ${autoApplyActions() ? '#0e639c' : '#3e3e42'};
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: auto;
            margin-right: 8px;
            hover:background-color: ${autoApplyActions() ? '#1a7bc4' : '#3e3e42'};
          `}
          title={autoApplyActions() ? 'Auto-apply enabled: AI changes will be applied automatically' : 'Auto-apply disabled: Click action buttons to apply changes'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Auto
        </button>

        <span style="font-size: 12px; opacity: 0.7;">#{props.conversationId}</span>
      </div>

      {/* Messages */}
      <div
        ref={messagesRef}
        style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;"
      >
        <For each={messages()}>
          {(message) => (
            <div style={`display: flex; flex-direction: column; ${message.role === 'user' ? 'align-items: flex-end;' : 'align-items: flex-start;'}`}>
              <div style={`max-width: 85%; padding: 8px 12px; border-radius: 8px; font-size: 13px; ${
                message.role === 'user'
                  ? 'background: #0e639c; color: white;'
                  : 'background: #2d2d30; border: 1px solid #3e3e42; color: #cccccc;'
              }`}>
                <div style="white-space: pre-wrap; line-height: 1.4;" innerHTML={formatMessageContent(message.cleanContent || message.content)} />
                <div style={`font-size: 10px; margin-top: 4px; opacity: 0.6; ${message.role === 'user' ? 'text-align: right;' : ''}`}>
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>

              {/* AI Actions */}
              {message.actions && message.actions.length > 0 && (
                <div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                  {autoApplyActions() && (
                    <span style="font-size: 10px; color: #4ade80; display: flex; align-items: center; gap: 3px;">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                      Auto-applied
                    </span>
                  )}

                  {!autoApplyActions() && (
                    <For each={message.actions}>
                      {(action) => (
                        <button
                          onClick={() => executeAction(action)}
                          onMouseDown={(e) => e.stopPropagation()}
                          style="background: #0e639c; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; hover:background-color: #1a7bc4;"
                          title={`Execute: ${action.description}`}
                        >
                          🔧 {action.description}
                        </button>
                      )}
                    </For>
                  )}
                </div>
              )}
            </div>
          )}
        </For>

        {isLoading() && (
          <div style="display: flex; justify-content: flex-start;">
            <div style="background: #2d2d30; border: 1px solid #3e3e42; padding: 8px 12px; border-radius: 8px; color: #cccccc; font-size: 13px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <div style="width: 6px; height: 6px; background: #cccccc; border-radius: 50%; animation: pulse 1.5s infinite;"></div>
                <div style="width: 6px; height: 6px; background: #cccccc; border-radius: 50%; animation: pulse 1.5s infinite 0.2s;"></div>
                <div style="width: 6px; height: 6px; background: #cccccc; border-radius: 50%; animation: pulse 1.5s infinite 0.4s;"></div>
                <span style="margin-left: 6px;">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error() && (
        <div style="background: #3c1e1e; border: 1px solid #5c2626; color: #ff6b6b; padding: 12px 16px; margin: 0 16px;">
          <strong>Error:</strong> {error()}
        </div>
      )}

      {/* Selected Images Indicator */}
      {selectedImageShapes().length > 0 && (
        <div style="background: #2d2d30; border-top: 1px solid #3e3e42; padding: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cccccc;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #4fc3f7;">🖼️</span>
            <span>Selected {selectedImageShapes().length} image{selectedImageShapes().length > 1 ? 's' : ''}:</span>
          </div>
          <For each={selectedImageShapes()}>
            {(image) => (
              <div style="background: #3e3e42; border-radius: 4px; padding: 4px 8px; font-size: 12px; color: #4fc3f7;">
                Image #{image.id}
              </div>
            )}
          </For>
          <button
            onClick={() => {
              const imageRefs = selectedImageShapes().map(img => `@image${img.id}`).join(' ');
              setInputValue(prev => prev ? `${prev} ${imageRefs}` : imageRefs);
            }}
            style="background: #4fc3f7; color: #1e1e1e; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;"
            title="Add image references to message"
          >
            Add to message
          </button>
        </div>
      )}

      {/* Input */}
      <div style="background: #2d2d30; border-top: 1px solid #3e3e42; padding: 16px; display: flex; gap: 12px; align-items: end;">
        <textarea
          ref={inputRef}
          value={inputValue()}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyPress={handleKeyPress}
          onMouseDown={(e) => e.stopPropagation()} // Prevent drag when using input
          placeholder={selectedImageShapes().length > 0
            ? `Ask about the selected image${selectedImageShapes().length > 1 ? 's' : ''}...`
            : "Ask me anything... (click images to reference them)"
          }
          style="flex: 1; border: 1px solid #3e3e42; border-radius: 8px; padding: 12px; resize: none; font-family: inherit; min-height: 20px; max-height: 100px; background: #1e1e1e; color: #cccccc;"
          rows="1"
          disabled={isLoading()}
        />
        <button
          onClick={sendMessage}
          onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
          disabled={!inputValue().trim() || isLoading()}
          style="background: #0e639c; color: white; border: none; border-radius: 8px; padding: 12px 16px; cursor: pointer; font-weight: 600; disabled:opacity-50; disabled:cursor-not-allowed;"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatWidget;
