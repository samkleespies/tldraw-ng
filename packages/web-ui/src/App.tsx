import { Component, createSignal, onMount, onCleanup } from 'solid-js';

// Message types for worker communication
type MsgFromUI =
  | { type: 'init'; canvas: OffscreenCanvas; devicePixelRatio: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'pointerMove'; x: number; y: number; buttons: number }
  | { type: 'pointerDown'; x: number; y: number; buttons: number }
  | { type: 'pointerUp'; x: number; y: number }
  | { type: 'wheel'; dx: number; dy: number }
  | { type: 'command'; name: 'undo' | 'redo' | 'duplicate' | 'deleteSelection' | 'clear' }
  | { type: 'toolChange'; tool: 'select' | 'rectangle' | 'ellipse' }
  | { type: 'createShape'; tool: 'rectangle' | 'ellipse'; x: number; y: number; width?: number; height?: number }
  | { type: 'panCamera'; dx: number; dy: number };

type MsgFromWorker =
  | { type: 'initialized' }
  | { type: 'selectionChanged'; selectedIds: string[] }
  | { type: 'shapeCountChanged'; count: number }
  | { type: 'error'; message: string };

type Tool = 'select' | 'rectangle' | 'ellipse';

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

  let canvasRef: HTMLCanvasElement | undefined;
  let worker: Worker | null = null;
  let isMiddleMouseDown = false;

  onMount(() => {
    initializeWorker();
    
    // Add global event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleGlobalMouseUp);
  });

  onCleanup(() => {
    if (worker) {
      worker.terminate();
    }
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
  });

  const initializeWorker = async () => {
    try {
      setStatusMessage('Loading WASM...');

      // Load WASM from public directory
      const response = await fetch('/crates/core/pkg/core.js');
      if (!response.ok) throw new Error('Failed to fetch WASM module');
      const moduleText = await response.text();
      const moduleBlob = new Blob([moduleText], { type: 'application/javascript' });
      const moduleUrl = URL.createObjectURL(moduleBlob);
      const wasmModule = await import(moduleUrl);

      // Initialize WASM with the correct path to the .wasm file
      await wasmModule.default('/crates/core/pkg/core_bg.wasm');
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

  const sendToCore = (msg: MsgFromUI) => {
    const core = (window as any).whiteboardCore;
    if (!core) return;

    switch (msg.type) {
      case 'pointerDown':
        if (selectedTool() === 'select') {
          core.handle_pointer_down(msg.x, msg.y, msg.ctrlKey || false);
          setSelectedCount(core.selected_count());
          setIsDragging(core.is_dragging());
        } else {
          // Create shape at pointer location
          createShapeAtPosition(selectedTool(), msg.x, msg.y);
        }
        core.render_frame();
        break;

      case 'pointerMove':
        if (selectedTool() === 'select') {
          // Update hover state and cursor
          setIsHoveringShape(core.is_point_over_shape(msg.x, msg.y));
          setResizeCursor(core.get_resize_cursor(msg.x, msg.y));
        }
        core.handle_pointer_move(msg.x, msg.y);
        setIsDragging(core.is_dragging());
        core.render_frame();
        break;

      case 'pointerUp':
        core.handle_pointer_up(msg.x, msg.y);
        setIsDragging(core.is_dragging());
        core.render_frame();
        break;

      case 'wheel':
        core.handle_wheel(msg.dx, msg.dy);
        core.render_frame();
        break;

      case 'command':
        handleCoreCommand(msg.name);
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

    const defaultSize = 120; // Smaller, more reasonable size

    // Calculate position so shape center is at cursor position
    const halfSize = defaultSize / 2;
    const centerX = x - halfSize;
    const centerY = y - halfSize;

    switch (tool) {
      case 'rectangle':
        // Create a perfect square
        console.log(`Creating green square at (${centerX}, ${centerY}) with size ${defaultSize}`);
        core.create_rectangle(centerX, centerY, defaultSize, defaultSize);
        break;
      case 'ellipse':
        // Create a perfect circle
        console.log(`Creating red circle at (${centerX}, ${centerY}) with size ${defaultSize}`);
        core.create_ellipse(centerX, centerY, defaultSize, defaultSize);
        break;
    }

    const newCount = core.shape_count();
    console.log(`Shape count after creation: ${newCount}`);
    setShapeCount(newCount);
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
    }
  };

  const handleCanvasPointerDown = (e: PointerEvent) => {
    if (!isInitialized()) return;

    const rect = canvasRef!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 1) { // Middle mouse button
      isMiddleMouseDown = true;
      e.preventDefault();
      return;
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

    sendToCore({
      type: 'pointerMove',
      x,
      y,
      buttons: e.buttons
    });
  };

  const handleCanvasPointerUp = (e: PointerEvent) => {
    if (!isInitialized()) return;

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

    e.preventDefault();
    sendToCore({
      type: 'wheel',
      dx: e.deltaX,
      dy: e.deltaY
    });
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
    if (e.button === 1) { // Middle mouse button
      isMiddleMouseDown = false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isInitialized()) return;

    // Prevent default for our handled keys
    const handled = ['v', 'r', 'o', 'Delete', 'Backspace', 'Escape'].includes(e.key.toLowerCase());
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
    <div class="app">
      {/* Canvas - full screen */}
      <div class="canvas-container">
        <canvas
          ref={canvasRef}
          class={`canvas ${selectedTool() === 'select' ? 'select-tool' : ''} ${
            selectedTool() === 'select' && isHoveringShape() ? 'hovering-shape' : ''
          } ${isDragging() ? 'dragging' : ''} ${
            resizeCursor() !== 'default' ? `resize-${resizeCursor().replace('-resize', '')}` : ''
          }`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onWheel={handleCanvasWheel}
        />
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
      </div>
    </div>
  );
};

export default App;
