import { Component, createSignal, onMount, onCleanup, For, createMemo, Index } from 'solid-js';
import { WidgetLinkingProvider } from '../context/WidgetLinkingContext';
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

export interface ResizeHandle {
  type: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom' | 'left' | 'right';
  x: number;
  y: number;
  size: number;
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
  const [, setFrameRate] = createSignal(0);
  const [, setOverlayCount] = createSignal(0);

  // Resize handles state
  const [resizeHandles, setResizeHandles] = createSignal<ResizeHandle[]>([]);

  // Selection box state
  const [selectionBox, setSelectionBox] = createSignal<{
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  } | null>(null);

  // Selection state for reactive updates
  const [selectedWidgets, setSelectedWidgets] = createSignal<number[]>([]);



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
        updateResizeHandles();
        updateSelectionBox();
        updateSelectionState();

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

    // Debug: Check available methods (only log once)
    if (!(window as any).debugMethodsLogged) {
      console.log(`[DEBUG] Available core methods:`, {
        get_selected_shapes: typeof core.get_selected_shapes,
        add_widget_to_selection: typeof core.add_widget_to_selection,
        remove_widget_from_selection: typeof core.remove_widget_from_selection,
        select_widget: typeof core.select_widget,
        is_selection_dragging: typeof core.is_selection_dragging
      });
      (window as any).debugMethodsLogged = true;
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
            // Always update overlay bounds to ensure size changes are reflected
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
   * Handle widget click to select widget for resize handles
   */
  const handleWidgetClick = (e: MouseEvent, overlay: WidgetOverlay) => {
    e.stopPropagation();
    console.log(`[DEBUG] handleWidgetClick: widget ${overlay.id}, ctrlKey=${e.ctrlKey}`);

    const core = (window as any).whiteboardCore;
    if (!core || !overlay.id) {
      console.log(`[DEBUG] handleWidgetClick: no core or overlay.id`);
      return;
    }

    // Check if Ctrl key is pressed for multi-select
    const ctrlKey = e.ctrlKey || e.metaKey;

    // Get current selection state
    let currentSelectedShapes: number[] = [];
    try {
      const selectedShapesJson = core.get_selected_shapes ? core.get_selected_shapes() : "[]";
      currentSelectedShapes = JSON.parse(selectedShapesJson);
      console.log(`[DEBUG] handleWidgetClick: current selection=${JSON.stringify(currentSelectedShapes)}`);
    } catch (e) {
      currentSelectedShapes = [];
      console.log(`[DEBUG] handleWidgetClick: error getting selection=${e}`);
    }

    if (ctrlKey) {
      // Multi-select mode: toggle widget in selection
      console.log(`[DEBUG] handleWidgetClick: ctrl mode`);
      if (currentSelectedShapes.includes(overlay.id)) {
        // Remove from selection
        console.log(`[DEBUG] handleWidgetClick: removing widget ${overlay.id} from selection`);
        if (typeof core.remove_widget_from_selection === 'function') {
          core.remove_widget_from_selection(overlay.id);
        } else {
          console.log(`[DEBUG] handleWidgetClick: remove_widget_from_selection not available`);
        }
      } else {
        // Add to selection
        console.log(`[DEBUG] handleWidgetClick: adding widget ${overlay.id} to selection`);
        if (typeof core.add_widget_to_selection === 'function') {
          core.add_widget_to_selection(overlay.id);
        } else {
          console.log(`[DEBUG] handleWidgetClick: add_widget_to_selection not available`);
        }
      }
    } else {
      // Single-select mode
      console.log(`[DEBUG] handleWidgetClick: single select mode`);
      if (currentSelectedShapes.length > 1 && currentSelectedShapes.includes(overlay.id)) {
        // Clicking on a widget that's part of a multi-selection - keep the multi-selection
        console.log(`[DEBUG] handleWidgetClick: keeping multi-selection`);
        // Don't change anything
      } else {
        // Single select this widget
        console.log(`[DEBUG] handleWidgetClick: single selecting widget ${overlay.id}`);
        if (typeof core.select_widget === 'function') {
          core.select_widget(overlay.id);
        } else {
          console.log(`[DEBUG] handleWidgetClick: select_widget not available`);
        }
      }
    }

    if (typeof core.render_frame === 'function') {
      core.render_frame();
    } else {
      console.log(`[DEBUG] handleWidgetClick: render_frame not available`);
    }
  };

  /**
   * Update resize handles from core
   */
  const updateResizeHandles = () => {
    const core = (window as any).whiteboardCore;
    if (!core || !props.canvasRef) return;

    try {
      // Get resize handles from core (already returns screen coordinates)
      if (typeof core.get_resize_handles_for_overlay === 'function') {
        const handles = core.get_resize_handles_for_overlay();

        // The handles already come in screen coordinates, no need for additional conversion
        const convertedHandles: ResizeHandle[] = handles.map((handle: any) => ({
          type: handle.type,
          x: handle.x,
          y: handle.y,
          size: handle.size
        }));

        setResizeHandles(convertedHandles);
      } else {
        setResizeHandles([]);
      }
    } catch (e) {
      console.error('Error updating resize handles:', e);
      setResizeHandles([]);
    }
  };

  /**
   * Update selection state from core
   */
  const updateSelectionState = () => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    try {
      const selectedShapesJson = core.get_selected_shapes ? core.get_selected_shapes() : "[]";
      const selectedShapes = JSON.parse(selectedShapesJson);
      setSelectedWidgets(selectedShapes);
    } catch (e) {
      setSelectedWidgets([]);
    }
  };

  /**
   * Update selection box from core
   */
  const updateSelectionBox = () => {
    const core = (window as any).whiteboardCore;
    if (!core || !props.canvasRef) return;

    try {
      const isDragging = core.is_selection_dragging && core.is_selection_dragging();

      if (isDragging) {
        // Get selection box coordinates from core
        if (typeof core.get_selection_box_for_overlay === 'function') {
          const box = core.get_selection_box_for_overlay();
          if (box) {
            setSelectionBox({
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              visible: true
            });
          }
        }
      } else {
        // Selection box finished - check what was selected
        const wasSelecting = selectionBox()?.visible;
        if (wasSelecting) {
          console.log(`[DEBUG] Selection box finished, checking selected shapes...`);
          try {
            const selectedShapesJson = core.get_selected_shapes ? core.get_selected_shapes() : "[]";
            const selectedShapes = JSON.parse(selectedShapesJson);
            console.log(`[DEBUG] After selection box: selected shapes = ${JSON.stringify(selectedShapes)}`);
          } catch (e) {
            console.log(`[DEBUG] Error getting selected shapes after selection: ${e}`);
          }
        }
        setSelectionBox(null);
      }
    } catch (e) {
      console.error('Error updating selection box:', e);
      setSelectionBox(null);
    }
  };

  /**
   * Handle resize handle mouse down
   */
  const handleResizeHandleMouseDown = (e: MouseEvent, _handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();

    const core = (window as any).whiteboardCore;
    if (!core || !props.canvasRef) return;

    // Get canvas bounds for coordinate conversion
    const canvasBounds = props.canvasRef.getBoundingClientRect();

    // Convert to canvas coordinates
    const canvasX = e.clientX - canvasBounds.left;
    const canvasY = e.clientY - canvasBounds.top;

    // Start resize operation in core
    core.handle_pointer_down(canvasX, canvasY, false);

    // Set up global mouse capture for resize operations (similar to App.tsx)
    if (core.is_resizing && core.is_resizing()) {
      setupResizeMouseCapture(canvasX, canvasY);
    }

    core.render_frame();
  };

  /**
   * Set up global mouse capture for resize operations
   */
  const setupResizeMouseCapture = (_startX: number, _startY: number) => {
    const core = (window as any).whiteboardCore;
    if (!core || !props.canvasRef) return;

    const canvasBounds = props.canvasRef.getBoundingClientRect();

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

      // Update resize handles after resize operation ends
      updateResizeHandles();

      // Remove global event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global event listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
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
   * Note: When selection dragging is active, widgets should be completely transparent to mouse events
   * Also allow middle mouse button events to pass through for canvas panning
   */
  const handleWidgetMouseDown = (e: MouseEvent) => {
    // Always allow selection box events to pass through
    const core = (window as any).whiteboardCore;
    if (core && core.is_selection_dragging && core.is_selection_dragging()) {
      // Don't stop propagation - let the event reach the canvas
      return;
    }

    // Allow middle mouse button events to pass through for canvas panning
    if (e.button === 1) {
      return;
    }

    e.stopPropagation();
  };

  const handleWidgetMouseMove = (e: MouseEvent) => {
    // Always allow selection box events to pass through
    const core = (window as any).whiteboardCore;
    if (core && core.is_selection_dragging && core.is_selection_dragging()) {
      // Don't stop propagation - let the event reach the canvas
      return;
    }

    // Allow middle mouse button events to pass through for canvas panning
    if (e.buttons & 4) { // Middle mouse button is pressed
      return;
    }

    e.stopPropagation();
  };

  const handleWidgetMouseUp = (e: MouseEvent) => {
    // Always allow selection box events to pass through
    const core = (window as any).whiteboardCore;
    if (core && core.is_selection_dragging && core.is_selection_dragging()) {
      // Don't stop propagation - let the event reach the canvas
      return;
    }

    // Allow middle mouse button events to pass through for canvas panning
    if (e.button === 1) {
      return;
    }

    e.stopPropagation();
  };

  /**
   * Check if a widget is selected (reactive)
   */
  const isWidgetSelected = (widgetId: number): boolean => {
    return selectedWidgets().includes(widgetId);
  };

  /**
   * Get overlay style for positioning
   */
  const getOverlayStyle = (overlay: WidgetOverlay): string => {
    const canvasBounds = props.canvasRef?.getBoundingClientRect();
    if (!canvasBounds) {
      return 'display: none;';
    }

    // Check if selection dragging is active to disable pointer events
    const core = (window as any).whiteboardCore;
    const isSelectionDragging = core && core.is_selection_dragging && core.is_selection_dragging();

    // Check if resizing is active to disable pointer events on other widgets
    const isResizing = core && core.is_resizing && core.is_resizing();

    // Check if shape creation is active to disable pointer events on other widgets
    const isCreatingShape = core && core.is_creating_shape && core.is_creating_shape();

    // Disable pointer events during selection dragging, resizing, or shape creation to prevent interference
    const pointerEvents = (isSelectionDragging || isResizing || isCreatingShape) ? 'none' : (overlay.active ? 'auto' : 'none');

    // Check if this widget is selected
    const isSelected = isWidgetSelected(overlay.id);
    const selectionBorder = isSelected ? '2px solid rgba(77, 153, 255, 0.8)' : '0';
    const selectionBoxShadow = isSelected ? '0 0 0 1px rgba(77, 153, 255, 0.3)' : 'none';

    // Get camera scale for content scaling
    const cameraScale = core ? core.get_camera_scale() : 1.0;

    // Calculate the unscaled dimensions (original widget size)
    const unscaledWidth = overlay.bounds.width / cameraScale;
    const unscaledHeight = overlay.bounds.height / cameraScale;

    return `
      position: absolute;
      left: ${overlay.bounds.x}px;
      top: ${overlay.bounds.y}px;
      width: ${unscaledWidth}px;
      height: ${unscaledHeight}px;
      transform: scale(${cameraScale});
      transform-origin: top left;
      z-index: ${overlay.zIndex};
      pointer-events: ${pointerEvents};
      border-radius: 8px;
      overflow: hidden;
      cursor: ${overlay.active ? 'default' : 'pointer'};
      border: ${selectionBorder};
      box-shadow: ${selectionBoxShadow};
      outline: 0 !important;
      outline-width: 0 !important;
      outline-style: none !important;
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
                onContentChange={() => {
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
                onCommand={() => {
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
                onError={() => {
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
                onMessage={() => {
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
                onFileSelect={() => {
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
                onLogEntry={() => {
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

  // Debug function to check selection state
  const debugSelection = () => {
    const core = (window as any).whiteboardCore;
    if (!core) {
      console.log('[DEBUG] No core available');
      return;
    }

    try {
      const selectedShapesJson = core.get_selected_shapes ? core.get_selected_shapes() : "[]";
      const selectedShapes = JSON.parse(selectedShapesJson);
      console.log('[DEBUG] Current selection:', selectedShapes);

      // Check if any widgets are selected
      const widgets = Object.keys(overlayStore).map(Number);
      const selectedWidgets = widgets.filter(id => selectedShapes.includes(id));
      console.log('[DEBUG] Selected widgets:', selectedWidgets);
      console.log('[DEBUG] All widgets:', widgets);
    } catch (e) {
      console.log('[DEBUG] Error checking selection:', e);
    }
  };

  // Add debug function to window for easy access
  (window as any).debugSelection = debugSelection;

  return (
    <div
      ref={containerRef}
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 50;"
    >
      <Index each={overlayIds()}>
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
              {widgetInstance()?.component?.({})}
            </div>
          );
        }}
      </Index>

      {/* Resize handles - rendered on top of widgets */}
      <For each={resizeHandles()}>
        {(handle) => (
          <div
            style={`
              position: absolute;
              left: ${handle.x - handle.size / 2}px;
              top: ${handle.y - handle.size / 2}px;
              width: ${handle.size}px;
              height: ${handle.size}px;
              background: white;
              border: 1px solid black;
              cursor: ${handle.type}-resize;
              z-index: 1000;
              pointer-events: auto;
              box-sizing: border-box;
            `}
            data-resize-handle={handle.type}
            onMouseDown={(e) => handleResizeHandleMouseDown(e, handle)}
          />
        )}
      </For>

      {/* Selection Box Overlay - Always on top */}
      {selectionBox() && (
        <div
          style={`
            position: absolute;
            left: ${selectionBox()!.x}px;
            top: ${selectionBox()!.y}px;
            width: ${selectionBox()!.width}px;
            height: ${selectionBox()!.height}px;
            background: rgba(77, 153, 255, 0.2);
            border: 1px solid rgba(77, 153, 255, 0.8);
            z-index: 2000;
            pointer-events: none;
            box-sizing: border-box;
          `}
        />
      )}
    </div>
  );
};

export default OverlayContainer;
