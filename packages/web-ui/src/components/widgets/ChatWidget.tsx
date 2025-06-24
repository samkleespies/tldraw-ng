import { Component, createSignal, onMount, For } from 'solid-js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  shapeReferences?: number[];
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
  
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;

  onMount(() => {
    console.log(`💬 Initializing Chat Widget ${props.id}`);
    
    // Add welcome message
    const welcomeMessage: ChatMessage = {
      id: 'welcome',
      role: 'assistant',
      content: `Hello! I'm your AI assistant for the spatial IDE. I can help you with:

• Code analysis and suggestions
• Shape references using @shapeId syntax
• Project structure and architecture
• Debugging and troubleshooting

Try asking me about your code or reference shapes on the canvas!`,
      timestamp: new Date()
    };
    
    setMessages([welcomeMessage]);
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

    try {
      // Simulate AI response (in real implementation, this would call OpenAI API)
      const aiResponse = await simulateAIResponse(content, userMessage.shapeReferences);
      
      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
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
    const matches = content.match(/@shape(\d+)/g);
    if (!matches) return [];
    
    return matches.map(match => {
      const id = match.replace('@shape', '');
      return parseInt(id, 10);
    }).filter(id => !isNaN(id));
  };

  /**
   * Simulate AI response (replace with actual OpenAI integration)
   */
  const simulateAIResponse = async (userMessage: string, shapeRefs?: number[]): Promise<string> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Get canvas context if shape references exist
    let contextInfo = '';
    if (shapeRefs && shapeRefs.length > 0) {
      const core = (window as any).whiteboardCore;
      if (core) {
        contextInfo = `\n\n📍 **Referenced Shapes:**\n`;
        for (const shapeId of shapeRefs) {
          const widgetInfo = core.get_widget_info(shapeId);
          if (widgetInfo) {
            try {
              const info = JSON.parse(widgetInfo);
              contextInfo += `• Shape ${shapeId}: ${info.type} widget\n`;
            } catch (e) {
              contextInfo += `• Shape ${shapeId}: Unknown widget\n`;
            }
          } else {
            contextInfo += `• Shape ${shapeId}: Basic shape\n`;
          }
        }
      }
    }

    // Generate contextual responses
    const lowerMessage = userMessage.toLowerCase();
    
    if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
      return `I can help you with various aspects of your spatial IDE project:

🔧 **Code Analysis**: Review your Monaco editor content for improvements
🎯 **Shape References**: Use @shape[ID] to reference specific widgets or shapes
🏗️ **Architecture**: Discuss project structure and best practices
🐛 **Debugging**: Help troubleshoot issues in your code
📊 **Performance**: Suggest optimizations for your application

What would you like to work on?${contextInfo}`;
    }
    
    if (lowerMessage.includes('monaco') || lowerMessage.includes('editor')) {
      return `The Monaco Editor widgets provide a full VS Code experience with:

• Syntax highlighting and IntelliSense
• Multi-language support (TypeScript, JavaScript, HTML, CSS, etc.)
• Code folding and minimap
• Find/replace functionality
• Keyboard shortcuts

You can create multiple Monaco editors for different files and they'll sync with the preview widgets automatically.${contextInfo}`;
    }
    
    if (lowerMessage.includes('terminal')) {
      return `The Terminal widgets offer a full command-line experience:

• Built-in commands (help, clear, ls, pwd, etc.)
• Package manager simulation (npm, pnpm)
• WebContainer integration for running real Node.js code
• Multiple terminal sessions

Try typing 'help' in a terminal to see available commands!${contextInfo}`;
    }
    
    if (lowerMessage.includes('preview')) {
      return `Preview widgets show live updates of your work:

• **File Preview**: For HTML, Markdown, and other files
• **Server Preview**: For running applications (localhost)
• **Auto-refresh**: Updates when you edit files in Monaco
• **Responsive**: Adapts to different screen sizes

The preview automatically syncs with your Monaco editor changes!${contextInfo}`;
    }
    
    if (shapeRefs && shapeRefs.length > 0) {
      return `I can see you're referencing ${shapeRefs.length} shape(s) on the canvas. This is a powerful feature that lets me understand the context of your spatial IDE layout.

You can reference any shape using @shape[ID] syntax. This helps me provide more targeted assistance based on your specific setup.

What would you like to know about these shapes?${contextInfo}`;
    }
    
    // Default responses
    const responses = [
      `That's an interesting question! In the context of spatial IDE development, I'd suggest focusing on the relationship between your widgets and how they can work together effectively.${contextInfo}`,
      
      `Great point! The spatial IDE approach allows for much more flexible development workflows. You can arrange your tools exactly how you need them for each project.${contextInfo}`,
      
      `I can help you with that! The combination of Monaco editors, terminals, and preview widgets creates a powerful development environment. What specific aspect would you like to explore?${contextInfo}`,
      
      `Excellent question! The WebGPU + Rust foundation provides incredible performance benefits while still supporting rich HTML widgets for complex tools like Monaco Editor.${contextInfo}`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
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
    setTimeout(() => {
      if (messagesRef) {
        messagesRef.scrollTop = messagesRef.scrollHeight;
      }
    }, 100);
  };

  /**
   * Format message content with shape references
   */
  const formatMessageContent = (content: string) => {
    return content.replace(/@shape(\d+)/g, '<span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">@shape$1</span>');
  };

  return (
    <div style={`width: 100%; height: 100%; display: flex; flex-direction: column; background: #f8fafc; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}>
      {/* Header */}
      <div style="background: #1e293b; color: white; padding: 12px 16px; display: flex; align-items: center; gap: 8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span style="font-weight: 600;">AI Assistant</span>
        <span style="font-size: 12px; opacity: 0.7; margin-left: auto;">#{props.conversationId}</span>
      </div>

      {/* Messages */}
      <div 
        ref={messagesRef}
        style="flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;"
      >
        <For each={messages()}>
          {(message) => (
            <div style={`display: flex; ${message.role === 'user' ? 'justify-content: flex-end;' : 'justify-content: flex-start;'}`}>
              <div style={`max-width: 80%; padding: 12px 16px; border-radius: 12px; ${
                message.role === 'user' 
                  ? 'background: #3b82f6; color: white;' 
                  : 'background: white; border: 1px solid #e2e8f0; color: #1a202c;'
              }`}>
                <div style="white-space: pre-wrap; line-height: 1.5;" innerHTML={formatMessageContent(message.content)} />
                <div style={`font-size: 11px; margin-top: 8px; opacity: 0.7; ${message.role === 'user' ? 'text-align: right;' : ''}`}>
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}
        </For>
        
        {isLoading() && (
          <div style="display: flex; justify-content: flex-start;">
            <div style="background: white; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 12px; color: #6b7280;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 8px; height: 8px; background: #6b7280; border-radius: 50%; animation: pulse 1.5s infinite;"></div>
                <div style="width: 8px; height: 8px; background: #6b7280; border-radius: 50%; animation: pulse 1.5s infinite 0.2s;"></div>
                <div style="width: 8px; height: 8px; background: #6b7280; border-radius: 50%; animation: pulse 1.5s infinite 0.4s;"></div>
                <span style="margin-left: 8px;">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error() && (
        <div style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 12px 16px; margin: 0 16px;">
          <strong>Error:</strong> {error()}
        </div>
      )}

      {/* Input */}
      <div style="background: white; border-top: 1px solid #e2e8f0; padding: 16px; display: flex; gap: 12px; align-items: end;">
        <textarea
          ref={inputRef}
          value={inputValue()}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask me anything... (use @shape123 to reference shapes)"
          style="flex: 1; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; resize: none; font-family: inherit; min-height: 20px; max-height: 100px;"
          rows="1"
          disabled={isLoading()}
        />
        <button
          onClick={sendMessage}
          disabled={!inputValue().trim() || isLoading()}
          style="background: #3b82f6; color: white; border: none; border-radius: 8px; padding: 12px 16px; cursor: pointer; font-weight: 600; disabled:opacity-50; disabled:cursor-not-allowed;"
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatWidget;
