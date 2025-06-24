import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';

// Configure Monaco environment to avoid worker issues
if (typeof window !== 'undefined') {
  (window as any).MonacoEnvironment = {
    getWorker: function (workerId: string, label: string) {
      // Disable all workers to avoid CORS and loading issues
      return null;
    },
    getWorkerUrl: function (workerId: string, label: string) {
      // Return empty string to prevent worker loading attempts
      return '';
    }
  };
}

// Dynamic import to avoid build issues
const loadMonaco = async () => {
  const monaco = await import('monaco-editor');
  return monaco;
};

export interface MonacoWidgetProps {
  id: number;
  language: string;
  filePath: string;
  width: number;
  height: number;
  active: boolean;
  onContentChange?: (content: string) => void;
}

/**
 * Monaco Editor Widget - Full VS Code editor experience
 */
export const MonacoWidget: Component<MonacoWidgetProps> = (props) => {
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [currentFilePath, setCurrentFilePath] = createSignal(props.filePath);
  const [devServerUrl, setDevServerUrl] = createSignal('');

  const { getFileContent, setFileContent, currentFile, handleTitleBarDrag } = useWidgetLinking();

  let containerRef: HTMLDivElement | undefined;
  let editor: any = null;

  // Store event handler reference for cleanup
  let fileOpenHandler: ((event: CustomEvent) => void) | null = null;

  onMount(async () => {
    const initializeEditor = async () => {
      if (!containerRef) return;

      try {
        // Load Monaco dynamically
        const monaco = await loadMonaco();

        // Initialize Monaco Editor with minimal configuration to avoid worker issues
        editor = monaco.editor.create(containerRef, {
          value: getInitialContent(),
          language: getLanguageFromFilePath(currentFilePath()),
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          wordWrap: 'on',
          // Disable all features that might require workers or cause errors
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          codeLens: false,
          lightbulb: { enabled: false },
          hover: { enabled: false },
          folding: false,
          links: false,
          colorDecorators: false,
          contextmenu: false,
          mouseWheelZoom: false,
          // Additional worker-related features to disable
          wordBasedSuggestions: false,
          semanticHighlighting: { enabled: false },
          occurrencesHighlight: false,
          renderValidationDecorations: 'off',
          // Disable language services that might cause worker issues
          'bracketPairColorization.enabled': false,
          'editor.inlineSuggest.enabled': false,
          'editor.suggest.showWords': false,
          'editor.suggest.showSnippets': false
        });

        // Auto-apply changes when editor content changes with error handling
        try {
          editor.onDidChangeModelContent(() => {
            try {
              const content = editor?.getValue?.() || '';
              const filePath = currentFilePath();
              if (filePath) {
                setFileContent(filePath, content);
              }
              props.onContentChange?.(content);
            } catch (err) {
              // Silently handle content change errors
            }
          });
        } catch (err) {
          // Silently handle event listener setup errors
        }

        setIsLoaded(true);

        // Listen for file opening events with error handling
        fileOpenHandler = (event: CustomEvent) => {
          try {
            const { filePath, content: fileContent } = event.detail;
            if (!filePath || !editor) return;

            setCurrentFilePath(filePath);

            // Safely set editor value
            if (typeof editor.setValue === 'function') {
              editor.setValue(fileContent || '');
            }

            // Safely update language
            const model = editor.getModel?.();
            if (model && typeof monaco.editor.setModelLanguage === 'function') {
              const language = getLanguageFromFilePath(filePath);
              try {
                monaco.editor.setModelLanguage(model, language);
              } catch (langErr) {
                // Silently handle language setting errors
              }
            }
          } catch (err) {
            // Silently handle file open errors
          }
        };

        window.addEventListener('open-file-in-editor', fileOpenHandler as EventListener);

      } catch (error) {
        console.warn('Monaco Editor failed to load, using fallback:', error);
        setError(`Monaco Editor failed to load: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setIsLoaded(true); // Still show the widget with error state
      }
    };

    initializeEditor();
  });

  onCleanup(() => {
    // Remove event listener safely
    try {
      if (fileOpenHandler) {
        window.removeEventListener('open-file-in-editor', fileOpenHandler as EventListener);
        fileOpenHandler = null;
      }
    } catch (err) {
      // Silently handle event listener removal errors
    }

    // Dispose Monaco editor safely
    try {
      if (editor && typeof editor.dispose === 'function') {
        editor.dispose();
      }
    } catch (err) {
      // Silently handle disposal errors
    } finally {
      editor = null;
    }
  });

  const handleRunProject = () => {
    if (devServerUrl()) {
      window.open(devServerUrl(), '_blank');
    }
  };

  // React to size changes
  createEffect(() => {
    if (editor && isLoaded()) {
      editor.layout({ width: props.width, height: props.height });
    }
  });

  // React to language changes
  createEffect(() => {
    if (editor && isLoaded()) {
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, props.language);
      }
    }
  });

  /**
   * Get language from file path
   */
  const getLanguageFromFilePath = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts': return 'typescript';
      case 'tsx': return 'typescript';
      case 'js': return 'javascript';
      case 'jsx': return 'javascript';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'scss': return 'scss';
      case 'json': return 'json';
      case 'md': return 'markdown';
      case 'xml': return 'xml';
      case 'yaml':
      case 'yml': return 'yaml';
      default: return 'plaintext';
    }
  };

  /**
   * Get initial content based on file type
   */
  const getInitialContent = (): string => {
    const filePath = currentFilePath();
    const existingContent = getFileContent(filePath);

    if (existingContent && existingContent !== `// File not found: ${filePath}`) {
      return existingContent;
    }

    // Use simple React template like canvas project
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      return `function App() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontFamily: 'Arial, sans-serif',
      fontSize: '2rem',
      backgroundColor: '#121212',
      color: '#ffffff'
    }}>
      Hello World!
    </div>
  );
}

export default App;`;
    }

    return `// ${filePath}
console.log('Hello World!');`;
  };

  /**
   * Render loading state
   */
  const renderLoading = () => (
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #1e1e1e; color: #cccccc;">
      <div style="text-align: center;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6l2 2-2 2M8 10h4"/>
            <rect x="2" y="2" width="20" height="20" rx="2"/>
          </svg>
        </div>
        <div>Loading Monaco Editor...</div>
      </div>
    </div>
  );

  /**
   * Render error state
   */
  const renderError = () => (
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #1e1e1e; color: #f48771;">
      <div style="text-align: center; padding: 20px;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <div style="font-weight: 600; margin-bottom: 8px;">Failed to load Monaco Editor</div>
        <div style="font-size: 14px; opacity: 0.8;">{error()}</div>
      </div>
    </div>
  );

  return (
    <div
      style={`
        width: 100%;
        height: 100%;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        background-color: #1e1e1e;
        display: flex;
        flex-direction: column;
        ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}
      `}
    >
      {/* Draggable Title Bar */}
      <div
        style="
          height: 40px;
          background-color: #2d2d30;
          border-bottom: 1px solid #3e3e42;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          color: #cccccc;
          font-size: 14px;
          cursor: move;
          user-select: none;
        "
        onMouseDown={(e) => {
          // Use the drag handler from context
          if (handleTitleBarDrag) {
            handleTitleBarDrag(e, props.id);
          }
        }}
      >
        <span>{currentFilePath().split('/').pop() || 'App.tsx'}</span>
        <div style="display: flex; gap: 8px;">
          {!isLoaded() && <span style="font-size: 12px;">Loading...</span>}
          {isLoaded() && (
            <button
              onClick={handleRunProject}
              onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
              style="
                background-color: #0e639c;
                color: white;
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
              "
              disabled={!devServerUrl()}
            >
              ▶ Run
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div style="flex: 1; position: relative;">
        {!isLoaded() ? renderLoading() : null}
        {error() ? (
          <textarea
            style="
              width: 100%;
              height: 100%;
              background: #1e1e1e;
              color: #d4d4d4;
              border: none;
              font-family: 'Consolas', 'Monaco', monospace;
              font-size: 14px;
              padding: 10px;
              resize: none;
              outline: none;
            "
            value={getInitialContent()}
            onInput={(e) => {
              const content = (e.target as HTMLTextAreaElement).value;
              const filePath = currentFilePath();
              if (filePath) {
                setFileContent(filePath, content);
              }
              props.onContentChange?.(content);
            }}
            placeholder="Monaco Editor failed to load. Using fallback text editor..."
          />
        ) : (
          <div
            ref={containerRef}
            style="width: 100%; height: 100%;"
          />
        )}
      </div>

      {/* Status Bar */}
      <div style="
        height: 24px;
        background-color: #007acc;
        display: flex;
        align-items: center;
        padding: 0 12px;
        font-size: 12px;
        color: white;
      ">
        {!isLoaded() ? 'Setting up environment...' :
         devServerUrl() ? `Ready • Server: ${devServerUrl()}` :
         'Ready'}
      </div>
    </div>
  );
};

export default MonacoWidget;
