import { Component, createSignal, onMount, onCleanup } from 'solid-js';
import { initializeCoordinateTransformer, getCoordinateTransformer } from './utils/coordinates';
import OverlayContainer from './components/OverlayContainer';
import { WidgetLinkingProvider } from './context/WidgetLinkingContext';
// Import Monaco configuration early to prevent worker issues
import './utils/monaco-config';

// Message types for worker communication
type MsgFromUI =
  | { type: 'init'; canvas: OffscreenCanvas; devicePixelRatio: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'pointerMove'; x: number; y: number; buttons: number }
  | { type: 'pointerDown'; x: number; y: number; buttons: number; ctrlKey?: boolean }
  | { type: 'pointerUp'; x: number; y: number }
  | { type: 'wheel'; dx: number; dy: number }
  | { type: 'wheelZoom'; dx: number; dy: number; cursorX: number; cursorY: number }
  | { type: 'command'; name: 'undo' | 'redo' | 'duplicate' | 'deleteSelection' | 'clear' }
  | { type: 'createWidget'; widgetType: 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console'; x: number; y: number }
  | { type: 'toolChange'; tool: 'select' | 'rectangle' | 'ellipse' }
  | { type: 'startShapeCreation'; tool: 'rectangle' | 'ellipse'; x: number; y: number }
  | { type: 'updateShapeCreation'; x: number; y: number }
  | { type: 'finishShapeCreation' }
  | { type: 'cancelShapeCreation' }
  | { type: 'createShape'; tool: 'rectangle' | 'ellipse'; x: number; y: number; width?: number; height?: number }
  | { type: 'panCamera'; dx: number; dy: number };

// Legacy type - kept for potential future worker implementation
// type MsgFromWorker =
//   | { type: 'initialized' }
//   | { type: 'selectionChanged'; selectedIds: string[] }
//   | { type: 'shapeCountChanged'; count: number }
//   | { type: 'error'; message: string };

type Tool = 'select' | 'rectangle' | 'ellipse' | 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console';

const App: Component = () => {
  // State signals
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [selectedTool, setSelectedTool] = createSignal<Tool>('select');
  const [statusMessage, setStatusMessage] = createSignal('Initializing...');
  const [shapeCount, setShapeCount] = createSignal(0);
  const [selectedCount, setSelectedCount] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isHoveringShape, setIsHoveringShape] = createSignal(false);
  const [resizeCursor, setResizeCursor] = createSignal('default');
  const [isPanning, setIsPanning] = createSignal(false);
  const [isCreatingShape, setIsCreatingShape] = createSignal(false);

  let canvasRef: HTMLCanvasElement | undefined;
  // let worker: Worker | null = null; // Legacy - not used in current implementation
  let isMiddleMouseDown = false;
  let shapeCreationStartPos = { x: 0, y: 0 };
  let isWaitingForShapeCreation = false;

  onMount(() => {
    initializeWorker();
    
    // Add global event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  });

  onCleanup(() => {
    // Note: worker is always null in current implementation
    // if (worker) {
    //   worker.terminate();
    // }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
  });

  const initializeWorker = async () => {
    try {
      setStatusMessage('Loading WASM...');
      console.log('🔄 Starting WASM initialization...');

      // Try to load WASM module with error handling
      let wasmModule;
      try {
        wasmModule = await import('./wasm/core.js');
        console.log('✅ WASM module loaded successfully');
      } catch (importError) {
        console.error('❌ Failed to import WASM module:', importError);
        throw new Error(`Failed to import WASM module: ${importError.message}`);
      }

      // Initialize WASM with the correct path to the .wasm file
      try {
        // Import the WASM file as a URL
        const wasmUrl = new URL('./wasm/core_bg.wasm', import.meta.url);
        await wasmModule.default(wasmUrl);
        console.log('✅ WASM initialized successfully');
      } catch (initError) {
        console.error('❌ Failed to initialize WASM:', initError);
        throw new Error(`Failed to initialize WASM: ${initError.message}`);
      }

      setStatusMessage('Creating core...');

      // Create core instance in main thread
      const core = new (wasmModule as any).WhiteboardCore();

      if (!canvasRef) {
        setTimeout(initializeWorker, 100);
        return;
      }

      setStatusMessage('Initializing WebGPU...');

      // Set up canvas size properly
      const rect = canvasRef.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;
      canvasRef.width = rect.width * devicePixelRatio;
      canvasRef.height = rect.height * devicePixelRatio;
      canvasRef.style.width = rect.width + 'px';
      canvasRef.style.height = rect.height + 'px';

      console.log(`Canvas setup: ${canvasRef.width}x${canvasRef.height} (${rect.width}x${rect.height} CSS)`);

      try {
        // Try using the canvas directly instead of OffscreenCanvas
        await core.initialize_webgpu(canvasRef);
        console.log('✅ WebGPU initialized successfully with regular canvas');
      } catch (webgpuError) {
        console.warn('⚠️ WebGPU initialization failed:', webgpuError);
        throw webgpuError;
      }

      core.resize_viewport(canvasRef.width, canvasRef.height, devicePixelRatio);

      // Store core instance globally for event handlers
      (window as any).whiteboardCore = core;

      // Initialize coordinate transformer
      initializeCoordinateTransformer(core);
      console.log('✅ Coordinate transformer initialized');

      // Test coordinate transformation
      const transformer = getCoordinateTransformer();
      if (transformer) {
        console.log('🧪 Testing coordinate transformation:');
        console.log('Camera scale:', transformer.getScale());
        console.log('Camera translation:', transformer.getTranslation());

        // Test coordinate conversion
        const testPoint = { x: 100, y: 100 };
        const worldPoint = transformer.screenToWorld(testPoint.x, testPoint.y);
        const backToScreen = transformer.worldToScreen(worldPoint.x, worldPoint.y);
        console.log(`Screen ${testPoint.x},${testPoint.y} → World ${worldPoint.x.toFixed(2)},${worldPoint.y.toFixed(2)} → Screen ${backToScreen.x.toFixed(2)},${backToScreen.y.toFixed(2)}`);
      }

      setIsInitialized(true);
      setStatusMessage('Ready');
      setErrorMessage(null);

      // Initial render
      core.render_frame();



    } catch (error) {
      console.error('Failed to initialize:', error);
      setErrorMessage(`Failed to initialize: ${error}`);
    }
  };

  /**
   * Set up global mouse capture for resize operations to prevent interruption
   */
  const setupResizeMouseCapture = (startX: number, startY: number) => {
    const core = (window as any).whiteboardCore;
    if (!core || !canvasRef) return;

    const canvasBounds = canvasRef.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const moveX = moveEvent.clientX - canvasBounds.left;
      const moveY = moveEvent.clientY - canvasBounds.top;

      // Update resize cursor and handle resize
      setResizeCursor(core.get_resize_cursor(moveX, moveY));
      core.handle_pointer_move(moveX, moveY);
      core.render_frame();
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const upX = upEvent.clientX - canvasBounds.left;
      const upY = upEvent.clientY - canvasBounds.top;

      core.handle_pointer_up(upX, upY);
      setIsDragging(core.is_dragging());
      core.render_frame();

      // Clean up global event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Add global event listeners for resize operation
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const sendToCore = (msg: MsgFromUI) => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    switch (msg.type) {
      case 'pointerDown':
        if (selectedTool() === 'select') {
          core.handle_pointer_down(msg.x, msg.y, msg.ctrlKey || false);
          setSelectedCount(core.selected_count());
          setIsDragging(core.is_dragging());

          // Check if we started a resize operation and set up global mouse capture
          if (core.is_resizing && core.is_resizing()) {
            setupResizeMouseCapture(msg.x, msg.y);
          }

          core.render_frame();
        }
        // For shape tools, we don't do anything on mouse down - wait for move or up
        break;

      case 'pointerMove':
        if (selectedTool() === 'select') {
          // Update hover state and cursor
          setIsHoveringShape(core.is_point_over_shape(msg.x, msg.y));
          setResizeCursor(core.get_resize_cursor(msg.x, msg.y));
          core.handle_pointer_move(msg.x, msg.y);
          setIsDragging(core.is_dragging());
          core.render_frame();
        } else if (isWaitingForShapeCreation) {
          // Check if we've moved enough to start drag creation
          const dragDistance = Math.sqrt(
            Math.pow(msg.x - shapeCreationStartPos.x, 2) +
            Math.pow(msg.y - shapeCreationStartPos.y, 2)
          );

          if (dragDistance > 3) { // 3px tolerance for tiny movements
            // Start drag creation on significant movement
            const currentTool = selectedTool();
            if (currentTool !== 'select') {
              sendToCore({
                type: 'startShapeCreation',
                tool: currentTool,
                x: shapeCreationStartPos.x,
                y: shapeCreationStartPos.y
              });
            }
            isWaitingForShapeCreation = false;
            // Then update with current position
            sendToCore({
              type: 'updateShapeCreation',
              x: msg.x,
              y: msg.y
            });
          }
        } else if (isCreatingShape()) {
          // Continue updating shape creation
          sendToCore({
            type: 'updateShapeCreation',
            x: msg.x,
            y: msg.y
          });
        }
        break;

      case 'pointerUp':
        if (selectedTool() === 'select') {
          core.handle_pointer_up(msg.x, msg.y);
          setIsDragging(core.is_dragging());
          core.render_frame();
        } else if (isWaitingForShapeCreation) {
          // Mouse up without movement - create default shape or widget
          const tool = selectedTool();
          if (tool === 'rectangle' || tool === 'ellipse') {
            createShapeAtPosition(tool, shapeCreationStartPos.x, shapeCreationStartPos.y);
          } else if (['monaco', 'terminal', 'preview', 'chat', 'explorer', 'console'].includes(tool)) {
            createWidgetAtPosition(tool, shapeCreationStartPos.x, shapeCreationStartPos.y);
          }
          isWaitingForShapeCreation = false;
        } else if (isCreatingShape()) {
          // Finish drag creation (works for both shapes and widgets)
          const shapeId = sendToCore({ type: 'finishShapeCreation' });
          if (shapeId) {
            setShapeCount((window as any).whiteboardCore?.shape_count() || 0);
          }

          // Auto-switch to select tool after drag-to-size creation
          setSelectedTool('select');
        }
        break;

      case 'wheel':
        core.handle_wheel(msg.dx, msg.dy);
        core.render_frame();
        break;

      case 'wheelZoom':
        core.handle_wheel_zoom(msg.dx, msg.dy, msg.cursorX, msg.cursorY);
        core.render_frame();
        break;

      case 'command':
        handleCoreCommand(msg.name);
        break;

      case 'startShapeCreation':
        core.start_shape_creation(msg.x, msg.y, msg.tool);
        setIsCreatingShape(true);
        core.render_frame();
        break;

      case 'updateShapeCreation':
        core.update_shape_creation(msg.x, msg.y);
        core.render_frame();
        break;

      case 'finishShapeCreation':
        const shapeId = core.finish_shape_creation();
        if (shapeId) {
          setShapeCount(core.shape_count());
        }
        setIsCreatingShape(false);
        core.render_frame();
        break;

      case 'cancelShapeCreation':
        core.cancel_shape_creation();
        setIsCreatingShape(false);
        core.render_frame();
        break;

      case 'panCamera':
        core.pan_camera(msg.dx, msg.dy);
        core.render_frame();
        break;
    }
  };

  const createShapeAtPosition = (tool: string, x: number, y: number) => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    // Convert screen coordinates to world coordinates (same as in Rust core)
    const camera_scale = core.get_camera_scale();
    const camera_translation = core.get_camera_translation();
    const world_x = (x / camera_scale) + camera_translation[0];
    const world_y = (y / camera_scale) + camera_translation[1];

    const defaultSize = 120; // Smaller, more reasonable size

    // Calculate position so shape center is at cursor position (in world coordinates)
    const halfSize = defaultSize / 2;
    const centerX = world_x - halfSize;
    const centerY = world_y - halfSize;

    switch (tool) {
      case 'rectangle':
        // Create a perfect square
        // Creating green square at world coordinates
        core.create_rectangle(centerX, centerY, defaultSize, defaultSize);
        break;
      case 'ellipse':
        // Create a perfect circle
        // Creating red circle at world coordinates
        core.create_ellipse(centerX, centerY, defaultSize, defaultSize);
        break;
    }

    const newCount = core.shape_count();
    setShapeCount(newCount);

    // Render the frame to make the shape visible immediately
    core.render_frame();

    // Auto-switch to select tool after creating a shape
    setSelectedTool('select');
  };

  const createWidgetAtPosition = (widgetType: string, x: number, y: number) => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    // Convert screen coordinates to world coordinates (same as in Rust core)
    const camera_scale = core.get_camera_scale();
    const camera_translation = core.get_camera_translation();
    const world_x = (x / camera_scale) + camera_translation[0];
    const world_y = (y / camera_scale) + camera_translation[1];

    // Default widget dimensions
    const width = 500;
    const height = 400;

    // Calculate position so widget center is at cursor position (in world coordinates)
    const centerX = world_x - width / 2;
    const centerY = world_y - height / 2;

    switch (widgetType) {
      case 'monaco':
        core.create_monaco_widget(centerX, centerY, width, height, 'typescript', 'untitled.ts');
        break;
      case 'terminal':
        core.create_terminal_widget(centerX, centerY, width, height, `session_${Date.now()}`);
        break;
      case 'preview':
        core.create_preview_widget(centerX, centerY, width, height, 'http://localhost:3000', false);
        break;
      case 'chat':
        core.create_chat_widget(centerX, centerY, width, height, `conv_${Date.now()}`);
        break;
      case 'explorer':
        core.create_explorer_widget(centerX, centerY, width, height, '/workspace');
        break;
      case 'console':
        core.create_console_widget(centerX, centerY, width, height, 'all');
        break;
    }

    const newCount = core.shape_count();
    setShapeCount(newCount);

    // Render the frame to make the widget visible immediately
    core.render_frame();

    // Auto-switch to select tool after creating a widget
    setSelectedTool('select');

    // Test coordinate transformation for the new widget
    const transformer = getCoordinateTransformer();
    if (transformer) {
      // Get the widget ID (it should be the latest shape)
      const shapeCount = core.shape_count();
      console.log(`🧪 Testing widget coordinate transformation for widget ID: ${shapeCount}`);

      // Test getting widget bounds
      setTimeout(() => {
        const widgetBounds = transformer.getWidgetScreenBounds(shapeCount);
        if (widgetBounds) {
          console.log('Widget screen bounds:', widgetBounds);
          const domBounds = transformer.screenBoundsToDOM(widgetBounds);
          console.log('Widget DOM bounds:', domBounds);
        }
      }, 100); // Small delay to ensure widget is created
    }
  };

  const handleCoreCommand = (command: string) => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    switch (command) {
      case 'clear':
        core.clear_all();
        setShapeCount(core.shape_count());
        setSelectedCount(core.selected_count());
        core.render_frame();
        break;
      case 'deleteSelection':
        const deletedCount = core.delete_selected();
        if (deletedCount > 0) {
          console.log(`Deleted ${deletedCount} selected shapes`);
          setShapeCount(core.shape_count());
          setSelectedCount(core.selected_count());
          core.render_frame();
        }
        break;
      case 'undo':
        core.undo();
        setShapeCount(core.shape_count());
        setSelectedCount(core.selected_count());
        core.render_frame();
        break;
      case 'redo':
        core.redo();
        setShapeCount(core.shape_count());
        setSelectedCount(core.selected_count());
        core.render_frame();
        break;
    }
  };

  const handleCanvasPointerDown = (e: PointerEvent) => {
    if (!isInitialized()) return;

    const rect = canvasRef!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 1) { // Middle mouse button
      isMiddleMouseDown = true;
      setIsPanning(true);
      e.preventDefault();
      return;
    }

    // Store creation start info for shape tools
    if (selectedTool() !== 'select') {
      shapeCreationStartPos = { x, y };
      isWaitingForShapeCreation = true;
    }

    sendToCore({
      type: 'pointerDown',
      x,
      y,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey || e.metaKey // Support both Ctrl (Windows/Linux) and Cmd (Mac)
    });
  };

  const handleCanvasPointerMove = (e: PointerEvent) => {
    if (!isInitialized()) return;

    const rect = canvasRef!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isMiddleMouseDown) {
      sendToCore({
        type: 'panCamera',
        dx: e.movementX,
        dy: e.movementY
      });
      return;
    }

    // No need for drag distance calculation - we handle it in the message processing

    sendToCore({
      type: 'pointerMove',
      x,
      y,
      buttons: e.buttons
    });
  };

  const handleCanvasPointerUp = (e: PointerEvent) => {
    if (!isInitialized()) return;

    // Handle middle mouse button release
    if (e.button === 1) {
      isMiddleMouseDown = false;
      setIsPanning(false);
      return;
    }

    const rect = canvasRef!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    sendToCore({
      type: 'pointerUp',
      x,
      y
    });
  };

  const handleCanvasWheel = (e: WheelEvent) => {
    if (!isInitialized()) return;

    e.preventDefault(); // Prevent page scroll

    // Get cursor position relative to canvas
    const rect = canvasRef!.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // Removed debug logging

    // Check if Ctrl/Cmd is held for zooming (like tldraw)
    if (e.ctrlKey || e.metaKey) {
      sendToCore({
        type: 'wheelZoom',
        dx: e.deltaX,
        dy: e.deltaY,
        cursorX,
        cursorY
      });
    } else {
      // Regular wheel scrolling (vertical movement)
      sendToCore({
        type: 'wheel',
        dx: e.deltaX,
        dy: e.deltaY
      });
    }
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
    if (e.button === 1) { // Middle mouse button
      isMiddleMouseDown = false;
      setIsPanning(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isInitialized()) return;

    // Check if the focus is inside a Monaco editor or other input element
    const activeElement = document.activeElement;
    const isInEditor = activeElement && (
      activeElement.classList.contains('monaco-editor') ||
      activeElement.closest('.monaco-editor') ||
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.contentEditable === 'true'
    );

    // If we're in an editor, only handle global shortcuts (Ctrl+Z, Ctrl+Y)
    if (isInEditor) {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'z':
            if (e.shiftKey) {
              // Ctrl+Shift+Z = Redo
              sendToCore({ type: 'command', name: 'redo' });
              e.preventDefault();
              return;
            } else {
              // Ctrl+Z = Undo
              sendToCore({ type: 'command', name: 'undo' });
              e.preventDefault();
              return;
            }
          case 'y':
            // Ctrl+Y = Redo (alternative)
            sendToCore({ type: 'command', name: 'redo' });
            e.preventDefault();
            return;
        }
      }
      // For all other keys in editor, let them pass through
      return;
    }

    // Handle Ctrl/Cmd combinations for global shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          if (e.shiftKey) {
            // Ctrl+Shift+Z = Redo
            sendToCore({ type: 'command', name: 'redo' });
          } else {
            // Ctrl+Z = Undo
            sendToCore({ type: 'command', name: 'undo' });
          }
          e.preventDefault();
          return;
        case 'y':
          // Ctrl+Y = Redo (alternative)
          sendToCore({ type: 'command', name: 'redo' });
          e.preventDefault();
          return;
      }
    }

    // Prevent default for our handled keys
    const handled = ['v', 'r', 'o', 'm', 't', 'p', 'c', 'e', 'l', 'Delete', 'Backspace', 'Escape'].includes(e.key.toLowerCase());
    if (handled) {
      e.preventDefault();
    }

    switch (e.key.toLowerCase()) {
      case 'v':
        setSelectedTool('select');
        break;
      case 'r':
        setSelectedTool('rectangle');
        break;
      case 'o':
        setSelectedTool('ellipse');
        break;
      case 'm':
        setSelectedTool('monaco');
        break;
      case 't':
        setSelectedTool('terminal');
        break;
      case 'p':
        setSelectedTool('preview');
        break;
      case 'c':
        setSelectedTool('chat');
        break;
      case 'e':
        setSelectedTool('explorer');
        break;
      case 'l':
        setSelectedTool('console');
        break;
      case 'delete':
      case 'backspace':
        sendToCore({ type: 'command', name: 'deleteSelection' });
        break;
      case 'escape':
        setSelectedTool('select');
        break;
    }
  };

  const handleToolChange = (tool: Tool) => {
    setSelectedTool(tool);
  };

  const handleCommand = (command: string) => {
    sendToCore({ type: 'command', name: command as any });
  };

  const handleCanvasResize = () => {
    if (!isInitialized()) return;

    const core = (window as any).whiteboardCore;
    if (core) {
      // Note: After transferControlToOffscreen(), we can't directly resize the canvas
      // The OffscreenCanvas size is managed by the WebGPU context
      // We'll need to handle this differently if dynamic resizing is needed
      core.render_frame();
    }
  };

  // Handle window resize
  onMount(() => {
    const resizeObserver = new ResizeObserver(handleCanvasResize);
    if (canvasRef) {
      resizeObserver.observe(canvasRef);
    }
    
    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  return (
    <WidgetLinkingProvider>
      <div class="app">
      {/* Canvas - full screen */}
      <div class="canvas-container">
        <canvas
          ref={canvasRef}
          class={`canvas ${selectedTool() === 'select' ? 'select-tool' : ''} ${
            selectedTool() === 'select' && isHoveringShape() ? 'hovering-shape' : ''
          } ${isDragging() ? 'dragging' : ''} ${isPanning() ? 'panning' : ''} ${
            resizeCursor() !== 'default' ? `resize-${resizeCursor().replace('-resize', '')}` : ''
          }`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onWheel={handleCanvasWheel}
        />

        {/* Widget Overlay Container */}
        <OverlayContainer canvasRef={canvasRef} />
      </div>

      {/* Status indicator - top left */}
      <div class={`status-indicator ${errorMessage() ? 'error' : 'success'}`}>
        {errorMessage() || statusMessage()}
      </div>

      {/* Shape counter - top right */}
      <div class="shape-counter">
        {shapeCount()} shapes • {selectedCount()} selected
      </div>

      {/* Toolbar - bottom center, tldraw style */}
      <div class="toolbar">
        <button
          class={`tool-btn ${selectedTool() === 'select' ? 'active' : ''}`}
          onClick={() => handleToolChange('select')}
          disabled={!isInitialized()}
          title="Select (V)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"/>
          </svg>
        </button>

        <div class="tool-separator" />

        <button
          class={`tool-btn ${selectedTool() === 'rectangle' ? 'active' : ''}`}
          onClick={() => handleToolChange('rectangle')}
          disabled={!isInitialized()}
          title="Square (R)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="4" y="4" width="8" height="8" rx="1"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'ellipse' ? 'active' : ''}`}
          onClick={() => handleToolChange('ellipse')}
          disabled={!isInitialized()}
          title="Circle (O)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="4"/>
          </svg>
        </button>

        <div class="tool-separator" />

        {/* Widget Tools */}
        <button
          class={`tool-btn ${selectedTool() === 'monaco' ? 'active' : ''}`}
          onClick={() => handleToolChange('monaco')}
          disabled={!isInitialized()}
          title="Code Editor (M)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16,18 22,12 16,6"/>
            <polyline points="8,6 2,12 8,18"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'terminal' ? 'active' : ''}`}
          onClick={() => handleToolChange('terminal')}
          disabled={!isInitialized()}
          title="Terminal (T)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 5L9 12L4 19"/>
            <path d="M11 19H20"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'preview' ? 'active' : ''}`}
          onClick={() => handleToolChange('preview')}
          disabled={!isInitialized()}
          title="Preview (P)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="5" width="18" height="14" rx="2"/>
            <line x1="3" y1="8" x2="21" y2="8"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'chat' ? 'active' : ''}`}
          onClick={() => handleToolChange('chat')}
          disabled={!isInitialized()}
          title="AI Chat (C)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M20 6C20 4.343 18.657 3 17 3H7C5.343 3 4 4.343 4 6V14C4 15.657 5.343 17 7 17H8V21L12 17H17C18.657 17 20 15.657 20 14V6Z"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'explorer' ? 'active' : ''}`}
          onClick={() => handleToolChange('explorer')}
          disabled={!isInitialized()}
          title="File Explorer (E)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 6C3 4.895 3.895 4 5 4H10L12 6H19C20.105 6 21 6.895 21 8V17C21 18.105 20.105 19 19 19H5C3.895 19 3 18.105 3 17V6Z"/>
          </svg>
        </button>

        <button
          class={`tool-btn ${selectedTool() === 'console' ? 'active' : ''}`}
          onClick={() => handleToolChange('console')}
          disabled={!isInitialized()}
          title="Console (L)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="8" y="7" width="8" height="10" rx="3"/>
            <circle cx="12" cy="5" r="2"/>
            <path d="M5 10L8 11"/>
            <path d="M5 14L8 13"/>
            <path d="M19 10L16 11"/>
            <path d="M19 14L16 13"/>
          </svg>
        </button>

        <div class="tool-separator" />

        <button
          class="tool-btn"
          onClick={() => handleCommand('clear')}
          disabled={!isInitialized() || shapeCount() === 0}
          title="Clear All"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 6h10l-1 8H4L3 6zM5 6V4a1 1 0 011-1h4a1 1 0 011 1v2M7 9v3M9 9v3"/>
          </svg>
        </button>

        <div class="tool-separator" />

        {/* Undo/Redo buttons on the far right */}
        <button
          class="tool-btn"
          onClick={() => handleCommand('undo')}
          disabled={!isInitialized()}
          title="Undo (Ctrl+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>
        <button
          class="tool-btn"
          onClick={() => handleCommand('redo')}
          disabled={!isInitialized()}
          title="Redo (Ctrl+Y)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 7v6h-6"/>
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>
          </svg>
        </button>
      </div>
    </div>
    </WidgetLinkingProvider>
  );
};

export default App;
