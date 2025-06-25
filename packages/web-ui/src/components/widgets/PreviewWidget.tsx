import { Component, createSignal, onMount, createEffect, onCleanup } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';

export interface PreviewWidgetProps {
  id: number;
  url: string;
  previewType: 'file' | 'server';
  width: number;
  height: number;
  active: boolean;
  onLoad?: () => void;
  onError?: (error: string) => void;
}

/**
 * Preview Widget - Live iframe preview for files and servers
 */
export const PreviewWidget: Component<PreviewWidgetProps> = (props) => {
  const [isLoading, setIsLoading] = createSignal(false); // Start with false, will be set to true when needed
  const [error, setError] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<'file' | 'server'>('server'); // Default to server mode
  const [activeCode, setActiveCode] = createSignal('');
  const [activePath, setActivePath] = createSignal<string | null>(null);
  const [devServerUrl, setDevServerUrl] = createSignal<string | null>(null);

  const { currentFile, getFileContent, handleTitleBarDrag } = useWidgetLinking();

  let iframeRef: HTMLIFrameElement | undefined;

  onMount(() => {
    console.log('Preview widget mounted, mode:', mode(), 'props:', props);

    // Listen for file updates
    const handleFileUpdate = (event: CustomEvent) => {
      const { filePath, content } = event.detail;
      if (mode() === 'file') {
        setActiveCode(content);
        setActivePath(filePath);
        updatePreview();
      }
    };

    // Listen for dev server ready
    const handleDevServerReady = (event: CustomEvent) => {
      const { url } = event.detail;
      console.log('Preview widget received dev-server-ready event:', url);
      setDevServerUrl(url);
    };

    window.addEventListener('file-updated', handleFileUpdate as EventListener);
    window.addEventListener('dev-server-ready', handleDevServerReady as EventListener);

    // Initial load
    const currentFilePath = currentFile();
    if (currentFilePath) {
      setActiveCode(getFileContent(currentFilePath));
      setActivePath(currentFilePath);
      updatePreview();
    } else {
      setTimeout(() => {
        updatePreview();
      }, 100);
    }

    onCleanup(() => {
      window.removeEventListener('file-updated', handleFileUpdate as EventListener);
      window.removeEventListener('dev-server-ready', handleDevServerReady as EventListener);
    });
  });

  // Monitor current file changes
  createEffect(() => {
    const filePath = currentFile();
    if (filePath && mode() === 'file') {
      const content = getFileContent(filePath);
      setActiveCode(content);
      setActivePath(filePath);
      updatePreview();
    }
  });

  /**
   * Toggle between file and server preview modes
   */
  const toggleMode = () => {
    setMode(prev => prev === 'file' ? 'server' : 'file');
    if (mode() === 'server') {
      // Switching to file mode, update preview
      const filePath = currentFile();
      if (filePath) {
        const content = getFileContent(filePath);
        setActiveCode(content);
        setActivePath(filePath);
        updatePreview();
      }
    }
  };

  /**
   * Transform React code to runnable HTML
   */
  const transformReactCode = (code: string): string => {
    // Simple transformation for React code
    let transformedCode = code;

    // Remove imports and exports
    transformedCode = transformedCode
      .replace(/import\s+.*?from\s+['"][^'"]*['"];?\s*/g, '')
      .replace(/export\s+default\s+\w+\s*;?\s*$/gm, '');

    // If it's a component, ensure it renders
    if (transformedCode.includes('function App') || transformedCode.includes('const App')) {
      // It's already a React component, just ensure it renders
      if (!transformedCode.includes('ReactDOM.createRoot')) {
        transformedCode += `\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));`;
      }
    }

    return transformedCode;
  };

  /**
   * Create preview HTML for React code
   */
  const createPreviewHTML = (code: string): string => {
    const transformedCode = transformReactCode(code);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>React Preview</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        }
        .error {
            color: #ef4444;
            background: #fef2f2;
            border: 1px solid #fecaca;
            padding: 12px;
            border-radius: 6px;
            margin: 10px;
            font-family: monospace;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/javascript">
        // Error handling
        window.onerror = function(msg, url, line, col, error) {
            document.getElementById('root').innerHTML =
                '<div class="error">Runtime Error: ' + msg +
                (error && error.stack ? '\\n\\n' + error.stack : '') + '</div>';
            return true;
        };

        try {
            ${transformedCode}
        } catch (error) {
            document.getElementById('root').innerHTML =
                '<div class="error">Execution Error: ' + error.message +
                (error.stack ? '\\n\\n' + error.stack : '') + '</div>';
        }
    </script>
</body>
</html>`;
  };

  /**
   * Update the preview with current code
   */
  const updatePreview = () => {
    if (!iframeRef || mode() !== 'file') return;

    const code = activeCode();
    if (!code.trim()) {
      // Show empty state
      const emptyHTML = createEmptyStateHTML();
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(emptyHTML);
      iframeRef.src = dataUrl;
      return;
    }

    try {
      const previewHTML = createPreviewHTML(code);
      const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(previewHTML);
      iframeRef.src = dataUrl;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview generation failed');
    }
  };

  /**
   * Create empty state HTML
   */
  const createEmptyStateHTML = (): string => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .empty-state {
            text-align: center;
            color: #64748b;
        }
        .empty-state h2 {
            margin: 0 0 8px 0;
            font-size: 1.5rem;
            color: #475569;
        }
        .empty-state p {
            margin: 0;
            font-size: 1rem;
        }
    </style>
</head>
<body>
    <div class="empty-state">
        <h2>⚡ Live Preview</h2>
        <p>Edit a file in Monaco to see the preview here</p>
    </div>
</body>
</html>`;
  };

  /**
   * Create HTML preview (legacy function, simplified)
   */
  const createHtmlPreview = (): string => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview - ${props.url}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 16px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 {
            margin: 0 0 20px 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        p {
            margin: 0;
            font-size: 1.2em;
            opacity: 0.9;
        }
        .file-name {
            font-family: 'JetBrains Mono', monospace;
            background: rgba(255, 255, 255, 0.2);
            padding: 8px 16px;
            border-radius: 8px;
            margin: 20px 0;
            display: inline-block;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎨 Live Preview</h1>
        <div class="file-name">${props.url}</div>
        <p>This is a preview of your HTML file.</p>
        <p>Edit the file in Monaco Editor to see changes here!</p>
    </div>
</body>
</html>
    `;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  };

  /**
   * Create Markdown preview
   */
  const createMarkdownPreview = (): string => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Preview - ${props.url}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 40px;
            background: #f8fafc;
            color: #1a202c;
            line-height: 1.6;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }
        h1 { color: #2d3748; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
        h2 { color: #4a5568; margin-top: 30px; }
        code {
            background: #f7fafc;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'JetBrains Mono', monospace;
        }
        .file-info {
            background: #ebf8ff;
            border: 1px solid #bee3f8;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="file-info">
            <strong>📄 Markdown Preview:</strong> <code>${props.url}</code>
        </div>
        <h1>Welcome to Markdown Preview</h1>
        <h2>Features</h2>
        <ul>
            <li>✅ Real-time preview</li>
            <li>✅ Syntax highlighting</li>
            <li>✅ Live updates from Monaco Editor</li>
        </ul>
        <h2>Getting Started</h2>
        <p>Edit your markdown file in the Monaco Editor to see changes reflected here instantly!</p>
        <blockquote style="border-left: 4px solid #4299e1; padding-left: 16px; margin: 20px 0; color: #4a5568;">
            This preview will update automatically as you type in the editor.
        </blockquote>
    </div>
</body>
</html>
    `;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  };

  /**
   * Create text file preview
   */
  const createTextPreview = (): string => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Preview - ${props.url}</title>
    <style>
        body {
            font-family: 'JetBrains Mono', monospace;
            margin: 0;
            padding: 20px;
            background: #1e1e1e;
            color: #cccccc;
            font-size: 14px;
            line-height: 1.5;
        }
        .header {
            background: #2d2d30;
            padding: 12px 16px;
            border-radius: 8px 8px 0 0;
            border-bottom: 1px solid #3e3e42;
            font-weight: 600;
        }
        .content {
            background: #252526;
            padding: 20px;
            border-radius: 0 0 8px 8px;
            min-height: 300px;
        }
        .file-icon {
            display: inline-block;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <span class="file-icon">📄</span>
        ${props.url}
    </div>
    <div class="content">
        <p>This is a preview of your file.</p>
        <p>Content will be displayed here when you edit the file in Monaco Editor.</p>
        <br>
        <p style="color: #569cd6;">// Start editing to see your content here!</p>
    </div>
</body>
</html>
    `;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  };

  /**
   * Handle iframe load
   */
  const handleLoad = () => {
    setIsLoading(false);
    setError(null);
    props.onLoad?.();
  };

  /**
   * Get current URL for preview
   */
  const currentUrl = () => {
    if (mode() === 'server') {
      return devServerUrl() || props.url;
    }

    // For file mode, return empty state if no active code
    const code = activeCode();
    if (!code.trim()) {
      const emptyHTML = createEmptyStateHTML();
      return 'data:text/html;charset=utf-8,' + encodeURIComponent(emptyHTML);
    }

    // Return preview HTML for file mode
    const previewHTML = createPreviewHTML(code);
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(previewHTML);
  };

  /**
   * Handle iframe error
   */
  const handleError = () => {
    const errorMsg = `Failed to load preview: ${mode() === 'server' ? devServerUrl() || props.url : 'file preview'}`;
    setError(errorMsg);
    setIsLoading(false);
    props.onError?.(errorMsg);
  };

  /**
   * Refresh preview
   */
  const refresh = () => {
    if (iframeRef) {
      setIsLoading(true);
      setError(null);
      if (mode() === 'file') {
        updatePreview();
      } else {
        iframeRef.src = currentUrl();
      }
    }
  };

  /**
   * Render loading state
   */
  const renderLoading = () => (
    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: rgba(30, 30, 30, 0.95); z-index: 10;">
      <div style="text-align: center; color: #cccccc;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cccccc" stroke-width="2">
            <path d="M8 2C4.5 2 1.5 5 1 8c.5 3 3.5 6 7 6s6.5-3 7-6c-.5-3-3.5-6-7-6z"/>
            <circle cx="8" cy="8" r="2"/>
          </svg>
        </div>
        <div style="font-size: 14px;">Loading Preview...</div>
      </div>
    </div>
  );

  /**
   * Render error state
   */
  const renderError = () => (
    <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: rgba(30, 30, 30, 0.95); z-index: 10;">
      <div style="text-align: center; padding: 20px;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <div style="font-weight: 600; margin-bottom: 8px; color: #ef4444;">Preview Error</div>
        <div style="font-size: 14px; color: #cccccc; margin-bottom: 16px;">{error()}</div>
        <button 
          onClick={refresh}
          style="background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;"
        >
          Retry
        </button>
      </div>
    </div>
  );

  return (
    <div
      style={`width: 100%; height: 100%; position: relative; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}
      onWheel={(e) => {
        // Allow Ctrl+wheel to bubble for canvas zoom, but prevent regular wheel from affecting canvas
        if (!e.ctrlKey && !e.metaKey) {
          e.stopPropagation();
        }
      }}
    >
      {/* Draggable Browser Chrome Title Bar */}
      <div
        style="
          background: #374151;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 8px 8px 0 0;
          cursor: move;
          user-select: none;
          position: relative;
        "
        onMouseDown={(e) => {
          // Use the drag handler from context
          if (handleTitleBarDrag) {
            handleTitleBarDrag(e, props.id);
          }
        }}
      >
        <div style="display: flex; gap: 4px;">
          <div style="width: 12px; height: 12px; background: #ef4444; border-radius: 50%;"></div>
          <div style="width: 12px; height: 12px; background: #f59e0b; border-radius: 50%;"></div>
          <div style="width: 12px; height: 12px; background: #10b981; border-radius: 50%;"></div>
        </div>

        {/* Centered title text */}
        <div style="
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          color: #d1d5db;
          font-size: 13px;
          font-family: monospace;
          pointer-events: none;
          white-space: nowrap;
        ">
          {mode() === 'file'
            ? (activePath() ? `Preview - ${activePath()?.split('/').pop()}` : 'Preview')
            : (devServerUrl() ? 'Live Preview • tldraw-ng' : 'Server Preview')
          }
        </div>

        {/* Mode toggle button */}
        <div style="margin-left: auto;">
          <button
            onClick={toggleMode}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
            style={`
              padding: 4px 8px;
              font-size: 12px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              color: white;
              background: ${mode() === 'file' ? '#16a34a' : '#6b7280'};
              transition: background-color 0.2s;
            `}
            title={mode() === 'file' ? 'Switch to Server Preview' : 'Switch to File Preview'}
          >
            {mode() === 'file' ? '📄 File' : '🌐 Server'}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div style="height: calc(100% - 40px); background: #1e1e1e; border-radius: 0 0 8px 8px; overflow: hidden; position: relative;">
        {/* Only show content when not loading and no error */}
        {!isLoading() && !error() && (
          mode() === 'file' ? (
            <iframe
              ref={iframeRef}
              style="width: 100%; height: 100%; border: none;"
              onLoad={handleLoad}
              onError={handleError}
              sandbox="allow-scripts allow-same-origin"
              title="File Preview"
            />
          ) : (
            devServerUrl() ? (
              <iframe
                src={devServerUrl()}
                style="width: 100%; height: 100%; border: none;"
                onLoad={handleLoad}
                onError={handleError}
                title="Server Preview"
              />
            ) : (
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #cccccc;">
                <div style="text-align: center;">
                  <div style="font-size: 24px; margin-bottom: 8px;">🌐</div>
                  <div style="font-size: 14px; font-weight: 500;">No dev server running</div>
                  <div style="font-size: 12px; margin-top: 4px; color: #888888;">Run your project to see the live preview</div>
                </div>
              </div>
            )
          )
        )}

        {/* Show overlays on top */}
        {isLoading() && renderLoading()}
        {error() && renderError()}
      </div>
    </div>
  );
};

export default PreviewWidget;
