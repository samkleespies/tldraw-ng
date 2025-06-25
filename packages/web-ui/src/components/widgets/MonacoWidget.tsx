import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';
import { WebContainer } from '@webcontainer/api';
import { configureMonacoLanguages, getWorkerFreeEditorOptions } from '../../utils/monaco-config';

// Dynamic import to avoid build issues
const loadMonaco = async () => {
  const monaco = await import('monaco-editor');

  // Configure language services to disable workers
  configureMonacoLanguages(monaco);

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
  const [runStatus, setRunStatus] = createSignal<'idle' | 'booting' | 'installing' | 'running' | 'ready' | 'error'>('idle');

  const { getFileContent, setFileContent, currentFile, handleTitleBarDrag, fileSystem } = useWidgetLinking();

  // WebContainer instance
  let webcontainerInstance: WebContainer | null = null;

  // Listen for file updates and sync to WebContainer
  onMount(() => {
    const handleFileUpdate = async (event: CustomEvent) => {
      const { filePath, content } = event.detail;
      if (webcontainerInstance && runStatus() === 'ready') {
        try {
          // Remove leading slash and write to WebContainer
          const cleanPath = filePath.replace(/^\//, '');
          await webcontainerInstance.fs.writeFile(cleanPath, content);
        } catch (error) {
          console.error('Error updating WebContainer file:', error);
        }
      }
    };

    window.addEventListener('file-updated', handleFileUpdate as EventListener);

    onCleanup(() => {
      window.removeEventListener('file-updated', handleFileUpdate as EventListener);
    });
  });

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

        // Disable all language features before creating editor
        try {
          // Unregister all language providers to prevent worker loading
          monaco.languages.getLanguages().forEach(lang => {
            if (lang.id === 'typescript' || lang.id === 'javascript') {
              try {
                // Clear any existing providers
                monaco.languages.setLanguageConfiguration(lang.id, {});
              } catch (e) {
                console.log('Could not clear language config for', lang.id);
              }
            }
          });
        } catch (e) {
          console.log('Could not clear language providers:', e);
        }

        // Initialize Monaco Editor with proper language support and mock workers
        editor = monaco.editor.create(containerRef, {
          value: getInitialContent(),
          language: getLanguageFromFilePath(currentFilePath()),
          theme: 'vs-dark',
          ...getWorkerFreeEditorOptions()
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

            // Update language based on file extension with mock worker support
            const model = editor.getModel?.();
            if (model && typeof monaco.editor.setModelLanguage === 'function') {
              const language = getLanguageFromFilePath(filePath);
              try {
                monaco.editor.setModelLanguage(model, language);
              } catch (langErr) {
                console.warn('Failed to set language:', langErr);
                // Fallback to plaintext if language setting fails
                try {
                  monaco.editor.setModelLanguage(model, 'plaintext');
                } catch (fallbackErr) {
                  console.warn('Failed to set fallback language:', fallbackErr);
                }
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

  /**
   * Create project files for WebContainer using Explorer's file system
   */
  const createDefaultFiles = () => {
    const files = fileSystem();
    const filesToMount: any = {};

    // Helper to add file to mount structure
    const addFile = (path: string, content: string) => {
      const segments = path.replace(/^\/?/, '').split('/');
      let pointer = filesToMount;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (i === segments.length - 1) {
          pointer[seg] = { file: { contents: content } };
        } else {
          pointer[seg] = pointer[seg] || { directory: {} };
          pointer = pointer[seg].directory;
        }
      }
    };

    // Add all files from Explorer's file system (the mini project)
    Object.entries(files).forEach(([path, content]) => addFile(path, content));

    // Only add essential build files if they don't exist in Explorer
    // The Explorer already contains the actual project files (App.tsx, main.tsx, etc.)
    if (!files['package.json']) {
      addFile('package.json', JSON.stringify({
        name: 'tldraw-ng-project',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite --host',
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: {
          'solid-js': '^1.8.0',
        },
        devDependencies: {
          typescript: '~5.8.3',
          vite: '^6.3.5',
          'vite-plugin-solid': '^2.10.2',
        },
      }, null, 2));
    }

    if (!files['vite.config.ts']) {
      addFile('vite.config.ts', `import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  server: {
    host: true,
  },
})`);
    }

    if (!files['index.html']) {
      addFile('index.html', `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>tldraw-ng Project</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`);
    }

    // Note: We don't add default src/main.tsx or src/App.tsx here anymore
    // because the Explorer already contains the actual project files

    return filesToMount;
  };

  /**
   * Handle running the project with WebContainer
   */
  const handleRunProject = async () => {
    if (runStatus() !== 'idle') return;

    try {
      setRunStatus('booting');

      // Boot WebContainer
      const wc = await WebContainer.boot();
      webcontainerInstance = wc;

      // Mount file system
      const filesToMount = createDefaultFiles();
      await wc.mount(filesToMount);

      setRunStatus('installing');

      // Install dependencies
      const installProcess = await wc.spawn('npm', ['install']);
      const installExitCode = await installProcess.exit;

      if (installExitCode !== 0) {
        setRunStatus('error');
        return;
      }

      setRunStatus('running');

      // Set up server-ready listener
      wc.on('server-ready', (port, url) => {
        console.log('Dev server ready:', url);
        setDevServerUrl(url);
        setRunStatus('ready');

        // Dispatch event to notify preview widgets
        window.dispatchEvent(new CustomEvent('dev-server-ready', {
          detail: { url }
        }));
      });

      // Start dev server
      await wc.spawn('npm', ['run', 'dev']);

    } catch (error) {
      console.error('Error running project:', error);
      setRunStatus('error');
    }
  };

  // React to size changes and status bar visibility
  createEffect(() => {
    if (editor && isLoaded()) {
      // Use setTimeout to ensure the container has been resized first
      setTimeout(() => {
        if (editor) {
          // Let Monaco handle the layout automatically since the container uses flex: 1
          editor.layout();
          // Force a second layout call to ensure proper sizing
          setTimeout(() => {
            if (editor) {
              editor.layout();
            }
          }, 10);
        }
      }, 10);
    }
  });

  // Watch specifically for status bar visibility changes
  createEffect(() => {
    const showStatusBar = props.height > 120;
    if (editor && isLoaded()) {
      // Trigger layout when status bar visibility changes
      setTimeout(() => {
        if (editor) {
          editor.layout();
        }
      }, 50); // Slightly longer delay to ensure DOM has updated
    }
  });

  // React to language changes with mock worker support
  createEffect(() => {
    if (editor && isLoaded()) {
      const model = editor.getModel();
      if (model) {
        try {
          monaco.editor.setModelLanguage(model, props.language);
        } catch (err) {
          console.warn('Failed to set language:', err);
          // Fallback to plaintext if language setting fails
          try {
            monaco.editor.setModelLanguage(model, 'plaintext');
          } catch (fallbackErr) {
            console.warn('Failed to set fallback language:', fallbackErr);
          }
        }
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

    // If no file is selected (default untitled.ts), show empty content
    if (!filePath || filePath === 'untitled.ts') {
      return '';
    }

    const existingContent = getFileContent(filePath);

    if (existingContent && existingContent !== `// File not found: ${filePath}`) {
      return existingContent;
    }

    // If file doesn't exist in the file system, return empty content
    return '';
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

        border-radius: 8px;
        overflow: hidden;
        background-color: #1e1e1e;
        display: flex;
        flex-direction: column;
        outline: none;
        border: none;
        ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}
      `}
      onWheel={(e) => {
        // Allow Ctrl+wheel to bubble for canvas zoom, but prevent regular wheel from affecting canvas
        if (!e.ctrlKey && !e.metaKey) {
          e.stopPropagation();
        }
      }}
    >
      {/* Draggable Title Bar - Responsive height */}
      <div
        style={`
          height: ${props.height > 100 ? '40px' : '28px'};
          background-color: #2d2d30;
          border-bottom: 1px solid #3e3e42;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 ${props.width > 300 ? '12px' : '8px'};
          color: #cccccc;
          font-size: ${props.height > 100 ? '14px' : '12px'};
          cursor: move;
          user-select: none;
          flex-shrink: 0;
        `}
        onMouseDown={(e) => {
          // Use the drag handler from context
          if (handleTitleBarDrag) {
            handleTitleBarDrag(e, props.id);
          }
        }}
      >
        <span>
          {(() => {
            const filePath = currentFilePath();
            if (!filePath || filePath === 'untitled.ts') {
              return 'Code Editor';
            }
            return filePath.split('/').pop() || 'Code Editor';
          })()}
        </span>
        <div style={`display: flex; gap: ${props.width > 300 ? '8px' : '4px'};`}>
          {!isLoaded() && props.width > 200 && <span style="font-size: 12px;">Loading...</span>}
          {isLoaded() && props.width > 150 && (
            <button
              onClick={handleRunProject}
              onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
              style={`
                background-color: ${runStatus() === 'ready' ? '#4CAF50' : runStatus() === 'error' ? '#f44336' : '#0e639c'};
                color: white;
                border: none;
                padding: ${props.height > 100 ? '4px 8px' : '2px 6px'};
                border-radius: 4px;
                font-size: ${props.height > 100 ? '12px' : '10px'};
                cursor: ${runStatus() === 'idle' ? 'pointer' : 'default'};
                opacity: ${runStatus() === 'idle' ? '1' : '0.8'};
              `}
              disabled={runStatus() !== 'idle'}
            >
              {props.width > 250 ? (
                <>
                  {runStatus() === 'idle' && '▶ Run'}
                  {runStatus() === 'booting' && '🔄 Booting...'}
                  {runStatus() === 'installing' && '📦 Installing...'}
                  {runStatus() === 'running' && '🚀 Starting...'}
                  {runStatus() === 'ready' && '✅ Ready'}
                  {runStatus() === 'error' && '❌ Error'}
                </>
              ) : (
                <>
                  {runStatus() === 'idle' && '▶'}
                  {runStatus() === 'booting' && '🔄'}
                  {runStatus() === 'installing' && '📦'}
                  {runStatus() === 'running' && '🚀'}
                  {runStatus() === 'ready' && '✅'}
                  {runStatus() === 'error' && '❌'}
                </>
              )}
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

      {/* Status Bar - Hide when widget is too small */}
      {props.height > 120 && (
        <div style="
          height: 24px;
          background-color: #007acc;
          display: flex;
          align-items: center;
          padding: 0 12px;
          font-size: 12px;
          color: white;
          flex-shrink: 0;
        ">
          {!isLoaded() ? 'Setting up environment...' :
           runStatus() === 'ready' && devServerUrl() ? `Ready • Server: ${devServerUrl()}` :
           runStatus() === 'booting' ? 'Booting WebContainer...' :
           runStatus() === 'installing' ? 'Installing dependencies...' :
           runStatus() === 'running' ? 'Starting dev server...' :
           runStatus() === 'error' ? 'Error occurred' :
           'Ready'}
        </div>
      )}
    </div>
  );
};

export default MonacoWidget;
