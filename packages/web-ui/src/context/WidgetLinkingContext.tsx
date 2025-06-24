import { createContext, useContext, createSignal, createEffect, onCleanup } from 'solid-js';

interface FileSystemEntry {
  path: string;
  content: string;
  language?: string;
}

interface WidgetLinkingContextType {
  // File operations
  openFileInEditor: (filePath: string) => void;
  getFileContent: (filePath: string) => string;
  setFileContent: (filePath: string, content: string) => void;

  // Widget communication
  currentFile: () => string;
  setCurrentFile: (filePath: string) => void;

  // File system
  fileSystem: () => Record<string, string>;

  // Widget dragging
  handleTitleBarDrag?: (e: MouseEvent, widgetId: number) => void;
}

const WidgetLinkingContext = createContext<WidgetLinkingContextType>();

// Simple Hello World project from canvas/src/ide/files.ts
const defaultFileSystem: Record<string, string> = {
  '/src/App.tsx': `function App() {
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

export default App;`,

  '/src/main.tsx': `import { render } from 'solid-js/web';
import App from './App';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <App />, root);`,

  '/src/index.css': `body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}`,

  '/src/components/Header.tsx': `import { Component } from 'solid-js';

interface HeaderProps {
  title: string;
}

const Header: Component<HeaderProps> = (props) => {
  return (
    <header style="background: #333; color: white; padding: 1rem;">
      <h1>{props.title}</h1>
    </header>
  );
};

export default Header;`,

  '/src/components/Sidebar.tsx': `import { Component } from 'solid-js';

const Sidebar: Component = () => {
  return (
    <aside style="width: 250px; background: #f5f5f5; padding: 1rem;">
      <h3>Navigation</h3>
      <ul>
        <li><a href="#home">Home</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </aside>
  );
};

export default Sidebar;`,

  '/src/utils.ts': `export const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};`,

  '/package.json': `{
  "name": "tldraw-ng-project",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "solid-js": "^1.8.0"
  },
  "devDependencies": {
    "typescript": "^5.2.2",
    "vite": "^5.0.0",
    "vite-plugin-solid": "^2.10.2"
  }
}`,

  '/index.html': `<!DOCTYPE html>
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
</html>`,

  '/vite.config.ts': `import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  server: {
    host: true,
  },
})`,

  '/tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}`,

  '/tsconfig.node.json': `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}`,

  '/README.md': `# Hello World App

A simple Hello World application built with SolidJS and Vite.

## Features

- 🎉 Interactive counter
- 🎨 Beautiful gradient design
- 📝 Live editing with Monaco
- 🔄 Hot reload
- 📁 File explorer integration

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev
\`\`\`

## Development

This project uses:
- **SolidJS** for reactive UI
- **Vite** for fast development
- **TypeScript** for type safety

Edit files in the Monaco editor and see changes instantly in the preview!
`
};

export function WidgetLinkingProvider(props: {
  children: any;
  handleTitleBarDrag?: (e: MouseEvent, widgetId: number) => void;
}) {
  const [fileSystem, setFileSystem] = createSignal<Record<string, string>>(defaultFileSystem);
  const [currentFile, setCurrentFile] = createSignal<string>('/src/App.tsx');

  const getFileContent = (filePath: string): string => {
    return fileSystem()[filePath] || `// File not found: ${filePath}`;
  };

  const setFileContent = (filePath: string, content: string) => {
    setFileSystem(prev => ({
      ...prev,
      [filePath]: content
    }));

    // Broadcast file change event
    console.log('Broadcasting file-updated event:', filePath);
    window.dispatchEvent(new CustomEvent('file-updated', {
      detail: { filePath, content }
    }));
  };

  const openFileInEditor = (filePath: string) => {
    console.log('Opening file in editor:', filePath);
    setCurrentFile(filePath);
    
    // Broadcast file open event
    window.dispatchEvent(new CustomEvent('open-file-in-editor', {
      detail: { filePath, content: getFileContent(filePath) }
    }));
  };

  const contextValue: WidgetLinkingContextType = {
    openFileInEditor,
    getFileContent,
    setFileContent,
    currentFile,
    setCurrentFile,
    fileSystem,
    handleTitleBarDrag: props.handleTitleBarDrag
  };

  return (
    <WidgetLinkingContext.Provider value={contextValue}>
      {props.children}
    </WidgetLinkingContext.Provider>
  );
}

export function useWidgetLinking() {
  const context = useContext(WidgetLinkingContext);
  if (!context) {
    throw new Error('useWidgetLinking must be used within a WidgetLinkingProvider');
  }
  return context;
}
