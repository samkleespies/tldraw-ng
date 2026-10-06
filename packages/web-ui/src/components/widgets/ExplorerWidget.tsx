import { Component, createSignal, onMount, For } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  expanded?: boolean;
  size?: number;
  modified?: Date;
}

export interface ExplorerWidgetProps {
  id: number;
  rootPath: string;
  width: number;
  height: number;
  active: boolean;
  onFileSelect?: (file: FileNode) => void;
  onFileCreate?: (path: string, type: 'file' | 'folder') => void;
}

/**
 * File Explorer Widget - VSCode-style file browser
 */
export const ExplorerWidget: Component<ExplorerWidgetProps> = (props) => {
  const [fileTree, setFileTree] = createSignal<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; node: FileNode } | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const { openFileInEditor, fileSystem, handleTitleBarDrag } = useWidgetLinking();

  onMount(() => {
    loadFileTree();
  });

  /**
   * Load file tree from the file system
   */
  const loadFileTree = () => {
    // Simulate loading delay
    setTimeout(() => {
      const files = fileSystem();
      const tree = buildFileTree(files);
      setFileTree(tree);
      setIsLoading(false);
    }, 500);
  };

  /**
   * Build file tree from flat file system
   */
  const buildFileTree = (files: Record<string, string>): FileNode[] => {
    const tree: FileNode[] = [];
    const folderMap = new Map<string, FileNode>();

    // Sort paths to ensure folders are created before their children
    const sortedPaths = Object.keys(files).sort();

    for (const filePath of sortedPaths) {
      const content = files[filePath];
      const pathParts = filePath.split('/').filter(part => part !== '');

      let currentPath = '';
      let currentLevel = tree;

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        currentPath += '/' + part;
        const isFile = i === pathParts.length - 1;

        // Find existing node at current level
        let existingNode = currentLevel.find(node => node.name === part);

        if (!existingNode) {
          const newNode: FileNode = {
            name: part,
            path: currentPath,
            type: isFile ? 'file' : 'folder',
            expanded: currentPath === '/src', // Expand src folder by default
            size: isFile ? content.length : undefined,
            modified: new Date(),
            children: isFile ? undefined : []
          };

          currentLevel.push(newNode);
          if (!isFile) {
            folderMap.set(currentPath, newNode);
          }
          existingNode = newNode;
        }

        if (!isFile && existingNode.children) {
          currentLevel = existingNode.children;
        }
      }
    }

    return tree;
  };

  /**
   * Toggle folder expansion
   */
  const toggleFolder = (path: string) => {
    setFileTree(prev => updateNodeExpansion(prev, path));
  };

  /**
   * Update node expansion recursively
   */
  const updateNodeExpansion = (nodes: FileNode[], targetPath: string): FileNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath && node.type === 'folder') {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children) {
        return { ...node, children: updateNodeExpansion(node.children, targetPath) };
      }
      return node;
    });
  };

  /**
   * Handle file selection - single click opens file in editor
   */
  const selectFile = (node: FileNode) => {
    if (node.type === 'file') {
      setSelectedFile(node.path);
      props.onFileSelect?.(node);
      // Single-click opens file in editor (like canvas version)
      openFileInEditor(node.path);
    } else {
      toggleFolder(node.path);
    }
  };

  /**
   * Handle file double-click - open in Monaco editor
   */
  const handleFileDoubleClick = (node: FileNode) => {
    if (node.type === 'file') {
      openFileInEditor(node.path);
    }
  };

  /**
   * Handle context menu
   */
  const handleContextMenu = (e: MouseEvent, node: FileNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  };

  /**
   * Close context menu
   */
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  /**
   * Get file icon
   */
  const getFileIcon = (node: FileNode): string => {
    if (node.type === 'folder') {
      return node.expanded ? '📂' : '📁';
    }
    
    const ext = node.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'tsx':
      case 'jsx': return '⚛️';
      case 'ts':
      case 'js': return '📜';
      case 'html': return '🌐';
      case 'css':
      case 'scss': return '🎨';
      case 'json': return '📋';
      case 'md': return '📝';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'svg': return '🖼️';
      default: return '📄';
    }
  };

  /**
   * Format file size
   */
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  };

  /**
   * Render file tree node
   */
  const renderNode = (node: FileNode, depth: number = 0) => (
    <div>
      <div
        style={`
          display: flex;
          align-items: center;
          padding: 4px 8px;
          padding-left: ${8 + depth * 16}px;
          cursor: pointer;
          user-select: none;
          background: ${selectedFile() === node.path ? '#e3f2fd' : 'transparent'};
          border-radius: 4px;
          margin: 1px 4px;
        `}
        onClick={() => selectFile(node)}
        onDblClick={() => handleFileDoubleClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
        onMouseEnter={(e) => e.currentTarget.style.background = selectedFile() === node.path ? '#264f78' : '#2a2d2e'}
        onMouseLeave={(e) => e.currentTarget.style.background = selectedFile() === node.path ? '#264f78' : 'transparent'}
      >
        <span style="margin-right: 6px; font-size: 14px;">{getFileIcon(node)}</span>
        <span style="flex: 1; font-size: 13px; color: #cccccc;">{node.name}</span>
        {node.type === 'file' && node.size && (
          <span style="font-size: 11px; color: #888888; margin-left: 8px;">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>
      {node.type === 'folder' && node.expanded && node.children && (
        <For each={node.children}>
          {(child) => renderNode(child, depth + 1)}
        </For>
      )}
    </div>
  );

  /**
   * Render context menu
   */
  const renderContextMenu = () => {
    const menu = contextMenu();
    if (!menu) return null;

    return (
      <div
        style={`
          position: fixed;
          top: ${menu.y}px;
          left: ${menu.x}px;
          background: #2d2d30;
          border: 1px solid #3e3e42;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          min-width: 160px;
          color: #cccccc;
        `}
        onClick={closeContextMenu}
      >
        <div style="padding: 4px 0;">
          <div
            style="padding: 8px 12px; cursor: pointer; font-size: 13px;"
            onMouseEnter={(e) => e.currentTarget.style.background = '#3e3e42'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            onClick={() => {
              if (menu.node.type === 'file') {
                openFileInEditor(menu.node.path);
              }
              closeContextMenu();
            }}
          >
            📝 Open in Monaco
          </div>
          <div style="padding: 8px 12px; cursor: pointer; font-size: 13px;" onMouseEnter={(e) => e.currentTarget.style.background = '#3e3e42'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            📋 Copy Path
          </div>
          <div style="height: 1px; background: #3e3e42; margin: 4px 0;"></div>
          <div style="padding: 8px 12px; cursor: pointer; font-size: 13px;" onMouseEnter={(e) => e.currentTarget.style.background = '#3e3e42'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            📁 New File
          </div>
          <div style="padding: 8px 12px; cursor: pointer; font-size: 13px;" onMouseEnter={(e) => e.currentTarget.style.background = '#3e3e42'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            📂 New Folder
          </div>
          <div style="height: 1px; background: #3e3e42; margin: 4px 0;"></div>
          <div style="padding: 8px 12px; cursor: pointer; font-size: 13px; color: #f87171;" onMouseEnter={(e) => e.currentTarget.style.background = '#3e3e42'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            🗑️ Delete
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={`width: 100%; height: 100%; background: #1e1e1e; border-radius: 8px; overflow: hidden; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}
      onClick={closeContextMenu}
      onWheel={(e) => {
        // Allow Ctrl+wheel to bubble for canvas zoom, but prevent regular wheel from affecting canvas
        if (!e.ctrlKey && !e.metaKey) {
          e.stopPropagation();
        }
      }}
    >
      {/* Draggable Title Bar */}
      <div
        style="
          background: #2d2d30;
          border-bottom: 1px solid #3e3e42;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 8px;
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cccccc" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span style="font-weight: 600; font-size: 14px; color: #cccccc;">Explorer</span>
        <span style="font-size: 12px; color: #888888; margin-left: auto;">{props.rootPath}</span>
      </div>

      {/* File Tree */}
      <div style="height: calc(100% - 49px); overflow-y: auto; padding: 8px 0;">
        {isLoading() ? (
          <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #888888;">
            <div style="text-align: center;">
              <div style="margin-bottom: 8px;">📁</div>
              <div style="font-size: 13px;">Loading files...</div>
            </div>
          </div>
        ) : (
          <For each={fileTree()}>
            {(node) => renderNode(node)}
          </For>
        )}
      </div>

      {/* Context Menu */}
      {renderContextMenu()}
    </div>
  );
};

export default ExplorerWidget;
