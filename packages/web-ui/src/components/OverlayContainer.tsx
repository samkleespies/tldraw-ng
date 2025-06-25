import { Component, createSignal, createEffect, onMount, onCleanup, For, createMemo, Index } from 'solid-js';
import { WidgetLinkingProvider, WidgetLinkingContext } from '../context/WidgetLinkingContext';
import { createStore, produce } from 'solid-js/store';
import { getCoordinateTransformer, type Bounds } from '../utils/coordinates';
import MonacoWidget from './widgets/MonacoWidget';
import TerminalWidget from './widgets/TerminalWidget';
import PreviewWidget from './widgets/PreviewWidget';
import ChatWidget from './widgets/ChatWidget';
import ExplorerWidget from './widgets/ExplorerWidget';
import ConsoleWidget from './widgets/ConsoleWidget';

export interface WidgetOverlay {
  id: number;
  type: 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console';
  active: boolean;
  bounds: Bounds;
  zIndex: number;
}

// Separate interface for widget instances with stable references
interface WidgetInstance {
  id: number;
  type: 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console';
  component: Component;
}

interface OverlayContainerProps {
  canvasRef: HTMLCanvasElement | undefined;
}

/**
 * OverlayContainer manages HTML overlays positioned over the WebGPU canvas
 * It handles coordinate transformation, positioning, and lifecycle management
 */
export const OverlayContainer: Component<OverlayContainerProps> = (props) => {
  // Use stores for efficient updates without recreation
  const [overlayStore, setOverlayStore] = createStore<Record<number, WidgetOverlay>>({});
  const [widgetInstances, setWidgetInstances] = createStore<Record<number, WidgetInstance>>({});
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [frameRate, setFrameRate] = createSignal(0);
  const [overlayCount, setOverlayCount] = createSignal(0);



  let containerRef: HTMLDivElement | undefined;
  let animationFrameId: number | null = null;
  let lastFrameTime = performance.now();
  let frameCount = 0;

  onMount(() => {
    setIsInitialized(true);
    startUpdateLoop();
  });

  onCleanup(() => {
    console.log('🎨 OverlayContainer cleanup');
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
  });

  /**
   * Start the update loop to sync overlay positions with canvas
   */
  const startUpdateLoop = () => {
    const updateOverlays = () => {
      const currentTime = performance.now();

      if (isInitialized()) {
        syncOverlaysWithCanvas();

        // Calculate frame rate every second
        frameCount++;
        if (currentTime - lastFrameTime >= 1000) {
          const fps = Math.round((frameCount * 1000) / (currentTime - lastFrameTime));
          setFrameRate(fps);
          frameCount = 0;
          lastFrameTime = currentTime;
        }
      }

      animationFrameId = requestAnimationFrame(updateOverlays);
    };
    updateOverlays();
  };

  /**
   * Sync overlay positions with canvas widgets
   */
  const syncOverlaysWithCanvas = () => {
    const core = (window as any).whiteboardCore;
    const transformer = getCoordinateTransformer();

    if (!core || !transformer || !props.canvasRef) {
      return;
    }

    try {
      // Get active widgets from core
      const activeWidgetsJson = core.get_active_widgets();
      const activeWidgets = JSON.parse(activeWidgetsJson);

      // Track current widget IDs
      const currentIds = new Set(Object.keys(overlayStore).map(Number));
      const newIds = new Set(activeWidgets.map((w: any) => w.id));

      // Remove widgets that no longer exist
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          setOverlayStore(produce(store => {
            delete store[id];
          }));
          setWidgetInstances(produce(instances => {
            delete instances[id];
          }));
        }
      }

      // Update or create widgets
      for (const widget of activeWidgets) {
        const domBounds = transformer.getWidgetTransform(widget.id).domBounds;

        if (domBounds) {
          const newOverlay: WidgetOverlay = {
            id: widget.id,
            type: widget.type,
            active: widget.active,
            bounds: domBounds,
            zIndex: 50 + widget.id, // Keep widgets below toolbar (z-index: 100)
          };

          const currentOverlay = overlayStore[widget.id];

          // Create new widget instance if it doesn't exist
          if (!currentOverlay) {
            setOverlayStore(widget.id, newOverlay);
            createWidgetInstance(widget.id, widget.type);
          } else {
            // Update existing overlay (positions, active state) without recreation
            setOverlayStore(widget.id, newOverlay);
          }
        }
      }

      setOverlayCount(Object.keys(overlayStore).length);
    } catch (error) {
      // Silently handle JSON parsing errors (expected during initialization)
    }
  };

  /**
   * Create a stable widget instance that persists across position updates
   */
  const createWidgetInstance = (id: number, type: string) => {
    const widgetComponent = () => {
      const overlay = () => overlayStore[id];
      if (!overlay()) return null;

      return (
        <WidgetLinkingProvider handleTitleBarDrag={handleWidgetTitleBarDrag}>
          {renderWidgetContent(overlay())}
        </WidgetLinkingProvider>
      );
    };

    setWidgetInstances(id, {
      id,
      type: type as any,
      component: widgetComponent
    });
  };

  /**
   * Handle widget click to prevent canvas interaction
   */
  const handleWidgetClick = (e: MouseEvent, overlay: WidgetOverlay) => {
    e.stopPropagation();

    // Clear any shape selection but don't add widgets to selection
    // Widgets should never show selection outlines
    const core = (window as any).whiteboardCore;
    if (core) {
      if (typeof core.clear_selection === 'function') {
        core.clear_selection();
      }
      // Don't add widgets to selection - they should have no visual selection outline
      if (typeof core.render_frame === 'function') {
        core.render_frame();
      }
    }
  };

  /**
   * Handle widget title bar drag start
   */
  const handleWidgetTitleBarDrag = (e: MouseEvent, widgetId: number) => {
    // Only handle left mouse button
    if (e.button !== 0) return;

    e.stopPropagation();
    e.preventDefault();

    const core = (window as any).whiteboardCore;
    if (!core) return;

    // Get mouse position relative to canvas
    const canvasBounds = props.canvasRef?.getBoundingClientRect();
    if (!canvasBounds) return;

    const x = e.clientX - canvasBounds.left;
    const y = e.clientY - canvasBounds.top;

    // Start widget drag in core
    core.start_widget_drag(widgetId, x, y);

    // Set up mouse move and up handlers for the drag operation
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const moveX = moveEvent.clientX - canvasBounds.left;
      const moveY = moveEvent.clientY - canvasBounds.top;
      core.handle_pointer_move(moveX, moveY);
      core.render_frame();
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const upX = upEvent.clientX - canvasBounds.left;
      const upY = upEvent.clientY - canvasBounds.top;
      core.handle_pointer_up(upX, upY);
      core.render_frame();

      // Clean up event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global event listeners for drag operation
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  /**
   * Handle widget mouse events to prevent canvas interference
   */
  const handleWidgetMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const handleWidgetMouseMove = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const handleWidgetMouseUp = (e: MouseEvent) => {
    e.stopPropagation();
  };

  /**
   * Get overlay style for positioning
   */
  const getOverlayStyle = (overlay: WidgetOverlay): string => {
    const canvasBounds = props.canvasRef?.getBoundingClientRect();
    if (!canvasBounds) {
      return 'display: none;';
    }

    return `
      position: absolute;
      left: ${overlay.bounds.x}px;
      top: ${overlay.bounds.y}px;
      width: ${overlay.bounds.width}px;
      height: ${overlay.bounds.height}px;
      z-index: ${overlay.zIndex};
      pointer-events: ${overlay.active ? 'auto' : 'none'};
      border-radius: 8px;
      overflow: hidden;
      cursor: ${overlay.active ? 'default' : 'pointer'};
      box-shadow: none !important;
      outline: 0 !important;
      border: 0 !important;
      outline-width: 0 !important;
      border-width: 0 !important;
      outline-style: none !important;
      border-style: none !important;
    `;
  };

  /**
   * Render actual widget content or placeholder
   */
  const renderWidgetContent = (overlay: WidgetOverlay) => {
    const core = (window as any).whiteboardCore;
    if (core) {
      const widgetInfo = core.get_widget_info(overlay.id);
      if (widgetInfo) {
        try {
          const info = JSON.parse(widgetInfo);



          // Render Monaco Editor
          if (overlay.type === 'monaco') {
            // Always create fresh instance with current props
            return (
              <MonacoWidget
                id={overlay.id}
                language={info.props.language || 'typescript'}
                filePath={info.props.file_path || 'untitled.ts'}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onContentChange={(content) => {
                  // Content changed - no logging for performance
                }}
              />
            );
          }

          // Render Terminal
          if (overlay.type === 'terminal') {
            return (
              <TerminalWidget
                id={overlay.id}
                sessionId={info.props.session_id || `session_${overlay.id}`}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onCommand={(command) => {
                  // Command executed - no logging for performance
                }}
              />
            );
          }

          // Render Preview
          if (overlay.type === 'preview') {
            return (
              <PreviewWidget
                id={overlay.id}
                url={info.props.url || 'http://localhost:3000'}
                previewType={info.props.preview_type === 'Server' ? 'server' : 'file'}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onLoad={() => {
                  // Preview loaded - no logging for performance
                }}
                onError={(error) => {
                  // Preview error - no logging for performance
                }}
              />
            );
          }

          // Render Chat
          if (overlay.type === 'chat') {
            return (
              <ChatWidget
                id={overlay.id}
                conversationId={info.props.conversation_id || `conv_${overlay.id}`}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onMessage={(message) => {
                  // Message sent - no logging for performance
                }}
              />
            );
          }

          // Render Explorer
          if (overlay.type === 'explorer') {
            return (
              <ExplorerWidget
                id={overlay.id}
                rootPath={info.props.root_path || '/workspace'}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onFileSelect={(file) => {
                  // File selected - no logging for performance
                }}
              />
            );
          }

          // Render Console
          if (overlay.type === 'console') {
            return (
              <ConsoleWidget
                id={overlay.id}
                logLevel={info.props.log_level || 'all'}
                width={overlay.bounds.width}
                height={overlay.bounds.height}
                active={overlay.active}
                onLogEntry={(entry) => {
                  // Log entry - no logging for performance
                }}
              />
            );
          }
        } catch (e) {
          console.error('Failed to parse widget info:', e);
        }
      }
    }

    // Fallback to placeholder content for other widgets or errors
    return renderPlaceholderContent(overlay);
  };

  /**
   * Render widget placeholder content
   */
  const renderPlaceholderContent = (overlay: WidgetOverlay) => {
    const iconStyle = "width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.6;";
    const titleStyle = "color: white; font-size: 18px; font-weight: 600; margin-bottom: 8px;";
    const subtitleStyle = "color: rgba(255, 255, 255, 0.7); font-size: 14px;";
    const containerStyle = "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 20px; text-align: center;";

    switch (overlay.type) {
      case 'monaco':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6l2 2-2 2M8 10h4"/>
              <rect x="2" y="2" width="20" height="20" rx="2"/>
            </svg>
            <div style={titleStyle}>Monaco Editor</div>
            <div style={subtitleStyle}>Code editor widget</div>
          </div>
        );
      
      case 'terminal':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M2 4l3 3-3 3M7 10h10"/>
              <rect x="1" y="2" width="22" height="20" rx="2"/>
            </svg>
            <div style={titleStyle}>Terminal</div>
            <div style={subtitleStyle}>Command line interface</div>
          </div>
        );
      
      case 'preview':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 2C4.5 2 1.5 5 1 8c.5 3 3.5 6 7 6s6.5-3 7-6c-.5-3-3.5-6-7-6z"/>
              <circle cx="8" cy="8" r="2"/>
            </svg>
            <div style={titleStyle}>Preview</div>
            <div style={subtitleStyle}>Live application preview</div>
          </div>
        );
      
      case 'chat':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div style={titleStyle}>AI Chat</div>
            <div style={subtitleStyle}>OpenAI integration</div>
          </div>
        );
      
      case 'explorer':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <div style={titleStyle}>File Explorer</div>
            <div style={subtitleStyle}>Project file browser</div>
          </div>
        );
      
      case 'console':
        return (
          <div style={containerStyle}>
            <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <div style={titleStyle}>Console</div>
            <div style={subtitleStyle}>Application logs</div>
          </div>
        );

      default:
        return (
          <div style={containerStyle}>
            <div style={titleStyle}>Unknown Widget</div>
            <div style={subtitleStyle}>Type: {overlay.type}</div>
          </div>
        );
    }
  };

  // Create a memo for overlay IDs to prevent unnecessary re-renders
  const overlayIds = createMemo(() => Object.keys(overlayStore).map(Number));

  return (
    <div
      ref={containerRef}
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 50;"
    >
      <Index each={overlayIds()} fallback={<div>No widgets</div>}>
        {(overlayId) => {
          const id = overlayId();
          const overlay = () => overlayStore[id];
          const widgetInstance = () => widgetInstances[id];

          return (
            <div
              style={getOverlayStyle(overlay())}
              data-widget-id={id}
              data-widget-type={overlay()?.type}
              onClick={(e) => handleWidgetClick(e, overlay())}
              onMouseDown={handleWidgetMouseDown}
              onMouseMove={handleWidgetMouseMove}
              onMouseUp={handleWidgetMouseUp}
            >
              {/* Use stable widget instance instead of recreating */}
              {widgetInstance()?.component?.()}
            </div>
          );
        }}
      </Index>
    </div>
  );
};

export default OverlayContainer;
