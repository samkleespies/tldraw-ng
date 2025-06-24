import { Component, createSignal, createEffect, onMount, onCleanup, For, createMemo, createRoot, useContext } from 'solid-js';
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
  component?: Component;
}

interface OverlayContainerProps {
  canvasRef: HTMLCanvasElement | undefined;
}

/**
 * OverlayContainer manages HTML overlays positioned over the WebGPU canvas
 * It handles coordinate transformation, positioning, and lifecycle management
 */
export const OverlayContainer: Component<OverlayContainerProps> = (props) => {
  const [overlays, setOverlays] = createSignal<WidgetOverlay[]>([]);
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

      // Update overlays based on active widgets
      const newOverlays: WidgetOverlay[] = [];
      const currentOverlays = overlays();

      for (const widget of activeWidgets) {
        const domBounds = transformer.getWidgetTransform(widget.id).domBounds;

        if (domBounds) {
          newOverlays.push({
            id: widget.id,
            type: widget.type,
            active: widget.active,
            bounds: domBounds,
            zIndex: 1000 + widget.id, // Ensure overlays are above canvas
            component: undefined // Will be set when we implement actual widgets
          });
        }
      }

      // Check if widget count or types changed (not just positions)
      const currentIds = new Set(currentOverlays.map(o => o.id));
      const newIds = new Set(newOverlays.map(o => o.id));
      const idsChanged = currentIds.size !== newIds.size ||
                        [...currentIds].some(id => !newIds.has(id)) ||
                        [...newIds].some(id => !currentIds.has(id));

      // Check if active states changed
      const activeStatesChanged = newOverlays.some(newOverlay => {
        const currentOverlay = currentOverlays.find(o => o.id === newOverlay.id);
        return !currentOverlay || currentOverlay.active !== newOverlay.active;
      });

      // Only update if widget count, types, or active states changed (not just positions)
      if (idsChanged || activeStatesChanged) {
        setOverlays(newOverlays);
        setOverlayCount(newOverlays.length);

        // Widget set changed - no logging needed for performance
      } else {
        // Just update positions without recreating overlays
        setOverlays(newOverlays);
      }
    } catch (error) {
      // Silently handle JSON parsing errors (expected during initialization)
    }
  };

  /**
   * Handle widget click to prevent canvas interaction
   */
  const handleWidgetClick = (e: MouseEvent, overlay: WidgetOverlay) => {
    e.stopPropagation();

    // Focus the widget
    const core = (window as any).whiteboardCore;
    if (core) {
      if (typeof core.clear_selection === 'function') {
        core.clear_selection();
      }
      if (typeof core.add_to_selection === 'function') {
        core.add_to_selection(overlay.id);
      }
      if (typeof core.render_frame === 'function') {
        core.render_frame();
      }
    }
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
      border: 2px solid ${overlay.active ? '#0ea5e9' : '#6b7280'};
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
      overflow: hidden;
      cursor: ${overlay.active ? 'default' : 'pointer'};
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

  return (
    <div 
      ref={containerRef}
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1000;"
    >
      <For each={overlays()} fallback={<div>No widgets</div>}>
        {(overlay) => (
          <div
            key={overlay.id}
            style={getOverlayStyle(overlay)}
            data-widget-id={overlay.id}
            data-widget-type={overlay.type}
            onClick={(e) => handleWidgetClick(e, overlay)}
            onMouseDown={handleWidgetMouseDown}
            onMouseMove={handleWidgetMouseMove}
            onMouseUp={handleWidgetMouseUp}
          >
            {createRoot(() => (
              <WidgetLinkingProvider>
                {renderWidgetContent(overlay)}
              </WidgetLinkingProvider>
            ))}
          </div>
        )}
      </For>
    </div>
  );
};

export default OverlayContainer;
