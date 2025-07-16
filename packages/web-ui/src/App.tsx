import { Component, createSignal, onMount, onCleanup } from 'solid-js';
import { initializeCoordinateTransformer, getCoordinateTransformer } from './utils/coordinates';
import OverlayContainer from './components/OverlayContainer';
import { WidgetLinkingProvider } from './context/WidgetLinkingContext';
import ShapeToolsDropdown from './components/ShapeToolsDropdown';
// Import Monaco configuration early to prevent worker issues
import './utils/monaco-config';
// Canvas asset management is now handled through AI context
import { createSmoothStroke, getTrianglesFromStroke, getSvgPathFromStroke, strokeToVertexObjects, type DrawPoint } from './utils/perfect-freehand';
import { getStroke } from 'perfect-freehand';

// Drawing utilities
interface Point {
  x: number;
  y: number;
}

interface Vertex {
  position: [number, number];
  color: [number, number, number, number];
  uv: [number, number];
  shape_type: number;
}

// Create a simple line from points using basic triangulation
function createSimpleLine(points: Point[], strokeWidth: number, color: [number, number, number, number]): Vertex[] {
  if (points.length < 2) return [];

  const vertices: Vertex[] = [];
  const halfWidth = strokeWidth / 2;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    // Calculate direction vector
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) continue;

    // Calculate perpendicular vector (normalized)
    const perpX = (-dy / length) * halfWidth;
    const perpY = (dx / length) * halfWidth;

    // Create quad vertices for this line segment
    const v1: Vertex = {
      position: [p1.x + perpX, p1.y + perpY],
      color,
      uv: [0, 0],
      shape_type: 0 // World coordinates with camera transformation
    };
    const v2: Vertex = {
      position: [p1.x - perpX, p1.y - perpY],
      color,
      uv: [0, 1],
      shape_type: 0
    };
    const v3: Vertex = {
      position: [p2.x + perpX, p2.y + perpY],
      color,
      uv: [1, 0],
      shape_type: 0
    };
    const v4: Vertex = {
      position: [p2.x - perpX, p2.y - perpY],
      color,
      uv: [1, 1],
      shape_type: 0
    };

    // Add two triangles to form a quad
    vertices.push(v1, v2, v3); // First triangle
    vertices.push(v2, v4, v3); // Second triangle
  }

  return vertices;
}



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
  | { type: 'startShapeCreation'; tool: 'rectangle' | 'ellipse' | 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console'; x: number; y: number }
  | { type: 'updateShapeCreation'; x: number; y: number }
  | { type: 'finishShapeCreation' }
  | { type: 'cancelShapeCreation' }
  | { type: 'createShape'; tool: 'rectangle' | 'ellipse'; x: number; y: number; width?: number; height?: number }
  | { type: 'panCamera'; dx: number; dy: number }
  | { type: 'startDrawing'; x: number; y: number }
  | { type: 'addDrawPoint'; x: number; y: number }
  | { type: 'finishDrawing' }
  | { type: 'createSmoothDrawShape'; points: Array<{x: number, y: number}> };

// Legacy type - kept for potential future worker implementation
// type MsgFromWorker =
//   | { type: 'initialized' }
//   | { type: 'selectionChanged'; selectedIds: string[] }
//   | { type: 'shapeCountChanged'; count: number }
//   | { type: 'error'; message: string };

type Tool = 'select' | 'rectangle' | 'ellipse' | 'draw' | 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console';

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

  // Drawing state for perfect-freehand
  let currentDrawPoints: DrawPoint[] = [];
  let isCurrentlyDrawing = false;
  let currentDrawShapeId: number | null = null;
  let currentStrokeVertices: Float32Array | null = null;

  onMount(() => {
    initializeWorker();

    // Canvas asset management is now handled through AI context
    console.log('✅ Canvas asset management ready');

    // Add global event listeners
    console.log('🔧 Adding event listeners...');
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('paste', handlePaste);
    console.log('✅ Paste event listener added to window');

    // Also add paste listener to document as backup
    document.addEventListener('paste', handlePaste);
    console.log('✅ Paste event listener added to document');

    // Add focus debugging
    window.addEventListener('focus', () => console.log('🎯 Window focused'));
    document.addEventListener('focus', () => console.log('📄 Document focused'));

    // Add test for any key events
    const testKeyHandler = async (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'v') {
        console.log('🧪 Ctrl+V detected via keydown listener');

        // Try to read clipboard directly
        try {
          const clipboardItems = await navigator.clipboard.read();
          console.log('📋 Clipboard items from navigator.clipboard.read():', clipboardItems);

          for (const item of clipboardItems) {
            console.log('📄 Clipboard item types:', item.types);
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                console.log('🖼️ Found image type:', type);
                const blob = await item.getType(type);
                console.log('📦 Image blob:', blob);

                // Convert blob to data URL
                const dataUrl = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(blob);
                });

                console.log('🔗 Data URL created from clipboard, length:', dataUrl.length);

                // Get image dimensions and decode to RGBA
                const img = new Image();
                img.onload = () => {
                  console.log('📏 Image dimensions:', img.width, 'x', img.height);

                  // Calculate display size
                  const maxSize = 400;
                  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                  const displayWidth = img.width * scale;
                  const displayHeight = img.height * scale;

                  // Get canvas center
                  const canvasBounds = canvasRef!.getBoundingClientRect();
                  const centerX = canvasBounds.width / 2;
                  const centerY = canvasBounds.height / 2;

                  // Decode image to RGBA data
                  const canvas = document.createElement('canvas');
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext('2d')!;
                  ctx.drawImage(img, 0, 0);
                  const imageData = ctx.getImageData(0, 0, img.width, img.height);
                  const rgbaData = imageData.data;

                  console.log('🎨 Decoded RGBA data, length:', rgbaData.length);

                  // Create image with decoded data
                  createImageAtPositionWithRGBA(centerX, centerY, displayWidth, displayHeight, dataUrl, img.width, img.height, rgbaData);
                };
                img.src = dataUrl;

                return; // Exit after processing first image
              }
            }
          }

          console.log('ℹ️ No images found in clipboard');
        } catch (error) {
          console.log('❌ Error reading clipboard:', error);
        }
      }
    };
    window.addEventListener('keydown', testKeyHandler);

    // Test paste event specifically
    const testPasteHandler = (e: ClipboardEvent) => {
      console.log('🧪 TEST: Paste event detected!', e);
    };
    window.addEventListener('paste', testPasteHandler);
  });

  onCleanup(() => {
    // Note: worker is always null in current implementation
    // if (worker) {
    //   worker.terminate();
    // }
    console.log('🧹 Removing event listeners...');
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('mouseup', handleGlobalMouseUp);
    window.removeEventListener('paste', handlePaste);
    document.removeEventListener('paste', handlePaste);
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
      } catch (importError: unknown) {
        console.error('❌ Failed to import WASM module:', importError);
        const errorMessage = importError instanceof Error ? importError.message : String(importError);
        throw new Error(`Failed to import WASM module: ${errorMessage}`);
      }

      // Initialize WASM with the correct path to the .wasm file
      try {
        // Import the WASM file as a URL
        const wasmUrl = new URL('./wasm/core_bg.wasm', import.meta.url);
        await wasmModule.default(wasmUrl);
        console.log('✅ WASM initialized successfully');
      } catch (initError: unknown) {
        console.error('❌ Failed to initialize WASM:', initError);
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        throw new Error(`Failed to initialize WASM: ${errorMessage}`);
      }

      setStatusMessage('Creating core...');

      // Create core instance in main thread
      const core = new (wasmModule as any).WhiteboardCore();

      if (!canvasRef) {
        setTimeout(initializeWorker, 100);
        return;
      }

      setStatusMessage('Initializing WebGPU...');

      // Set up canvas size properly with GPU texture limits
      const rect = canvasRef.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;

      // Calculate desired size
      let desiredWidth = rect.width * devicePixelRatio;
      let desiredHeight = rect.height * devicePixelRatio;

      // Limit to common GPU texture size limits (2048 is safe for most GPUs)
      const maxTextureSize = 2048;
      if (desiredWidth > maxTextureSize || desiredHeight > maxTextureSize) {
        const scale = Math.min(maxTextureSize / desiredWidth, maxTextureSize / desiredHeight);
        desiredWidth = Math.floor(desiredWidth * scale);
        desiredHeight = Math.floor(desiredHeight * scale);
        console.log(`⚠️ Canvas size limited due to GPU constraints: ${desiredWidth}x${desiredHeight}`);
      }

      canvasRef.width = desiredWidth;
      canvasRef.height = desiredHeight;
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

      // Check if create_image function is available
      if (typeof core.create_image === 'function') {
        console.log('✅ create_image function is available');
      } else {
        console.log('❌ create_image function is NOT available');
      }

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
  const setupResizeMouseCapture = (_startX: number, _startY: number) => {
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

      // Reset resize cursor when resize operation ends
      setResizeCursor('default');

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
                tool: currentTool as 'rectangle' | 'ellipse' | 'monaco' | 'terminal' | 'preview' | 'chat' | 'explorer' | 'console',
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
          sendToCore({ type: 'finishShapeCreation' });
          setShapeCount((window as any).whiteboardCore?.shape_count() || 0);

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

      case 'startDrawing':
        // Start drawing using the existing Rust drawing system
        if (!isCurrentlyDrawing) {
          isCurrentlyDrawing = true;
          // Store screen coordinates with pressure for perfect-freehand
          currentDrawPoints = [{ x: msg.x, y: msg.y, pressure: 0.5 }];
          currentDrawShapeId = null;
          currentStrokeVertices = null;

          // Start drawing in Rust core
          core.start_drawing(msg.x, msg.y);
          console.log('🎨 Started smooth drawing at screen coords:', [msg.x, msg.y]);
        }
        break;

      case 'addDrawPoint':
        if (isCurrentlyDrawing) {
          // Add point with pressure for perfect-freehand
          currentDrawPoints.push({ x: msg.x, y: msg.y, pressure: 0.5 });
          console.log('🎨 Added smooth point - Screen:', [msg.x, msg.y], 'Total points:', currentDrawPoints.length);

          // Use the existing Rust drawing system for now to avoid borrow checker issues
          if (currentDrawPoints.length >= 2) {
            // Get the last two points
            const p1 = currentDrawPoints[currentDrawPoints.length - 2];
            const p2 = currentDrawPoints[currentDrawPoints.length - 1];

            // Convert to world coordinates
            const world1 = core.screen_to_world(p1.x, p1.y);
            const world2 = core.screen_to_world(p2.x, p2.y);

            // Add the point to the current drawing path in Rust
            core.add_draw_point(p2.x, p2.y);
            core.render_frame();
          }
        }
        break;

      case 'finishDrawing':
        if (isCurrentlyDrawing) {
          // Finish drawing in Rust core
          core.finish_drawing();
          setShapeCount(core.shape_count());
          console.log('🎨 Finished drawing with', currentDrawPoints.length, 'points');
        }

        // Reset drawing state
        isCurrentlyDrawing = false;
        currentDrawPoints = [];
        currentDrawShapeId = null;
        currentStrokeVertices = null;
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

  const createImageAtPosition = (x: number, y: number, width: number, height: number, dataUrl: string, originalWidth: number, originalHeight: number) => {
    console.log('🎨 createImageAtPosition called with:', { x, y, width, height, originalWidth, originalHeight });

    const core = (window as any).whiteboardCore;
    if (!core) {
      console.log('❌ No core instance available');
      return;
    }

    console.log('✅ Core instance found');

    // Convert screen coordinates to world coordinates
    const camera_scale = core.get_camera_scale();
    const camera_translation = core.get_camera_translation();
    console.log('📷 Camera state:', { scale: camera_scale, translation: camera_translation });

    const world_x = (x / camera_scale) + camera_translation[0];
    const world_y = (y / camera_scale) + camera_translation[1];
    console.log('🌍 World coordinates:', { world_x, world_y });

    // Calculate position so image center is at cursor position (in world coordinates)
    const centerX = world_x - width / 2;
    const centerY = world_y - height / 2;
    console.log('🎯 Final position:', { centerX, centerY });

    // Create image shape
    console.log('🔧 Calling core.create_image...');
    const imageId = core.create_image(centerX, centerY, width, height, dataUrl, originalWidth, originalHeight);
    console.log('🆔 Image ID returned:', imageId);

    const newCount = core.shape_count();
    console.log('📊 New shape count:', newCount);
    setShapeCount(newCount);

    // Render the frame to make the image visible immediately
    console.log('🎬 Rendering frame...');
    core.render_frame();

    console.log(`✅ Created image shape ${imageId} at (${centerX.toFixed(2)}, ${centerY.toFixed(2)}) with size ${width}x${height}`);
  };

  const createImageAtPositionWithRGBA = (x: number, y: number, width: number, height: number, dataUrl: string, originalWidth: number, originalHeight: number, rgbaData: Uint8ClampedArray) => {
    console.log('🎨 createImageAtPositionWithRGBA called with:', {
      x, y, width, height, originalWidth, originalHeight,
      dataUrlLength: dataUrl.length,
      rgbaDataLength: rgbaData.length
    });

    const core = (window as any).whiteboardCore;
    if (!core) {
      console.error('❌ Core instance not found');
      return;
    }
    console.log('✅ Core instance found');

    // Check if create_image_with_rgba function exists
    if (typeof core.create_image_with_rgba === 'function') {
      console.log('🔧 Using create_image_with_rgba...');

      // Convert screen coordinates to world coordinates
      const camera_scale = core.get_camera_scale();
      const camera_translation = core.get_camera_translation();
      console.log('📷 Camera state:', { scale: camera_scale, translation: camera_translation });

      const world_x = (x / camera_scale) + camera_translation[0];
      const world_y = (y / camera_scale) + camera_translation[1];
      console.log('🌍 World coordinates:', { world_x, world_y });

      // Calculate position so image center is at cursor position (in world coordinates)
      const centerX = world_x - width / 2;
      const centerY = world_y - height / 2;
      console.log('🎯 Final position:', { centerX, centerY });

      // Create the image shape with RGBA data
      const imageId = core.create_image_with_rgba(centerX, centerY, width, height, dataUrl, originalWidth, originalHeight, rgbaData);
      console.log('🆔 Image ID returned:', imageId);

      const newCount = core.shape_count();
      console.log('📊 New shape count:', newCount);
      setShapeCount(newCount);

      // Render the frame to make the image visible immediately
      console.log('🎬 Rendering frame...');
      core.render_frame();

      console.log(`✅ Created image shape ${imageId} at (${centerX.toFixed(2)}, ${centerY.toFixed(2)}) with size ${width}x${height}`);
    } else {
      console.log('⚠️ create_image_with_rgba not available, falling back to regular create_image');
      createImageAtPosition(x, y, width, height, dataUrl, originalWidth, originalHeight);
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

    // Handle draw tool
    if (selectedTool() === 'draw') {
      sendToCore({
        type: 'startDrawing',
        x,
        y
      });
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

    // Handle drawing
    if (selectedTool() === 'draw' && e.buttons === 1) { // Left mouse button pressed
      sendToCore({
        type: 'addDrawPoint',
        x,
        y
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

    // Handle draw tool
    if (selectedTool() === 'draw') {
      sendToCore({
        type: 'finishDrawing'
      });
      return;
    }

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

  // Helper function to convert File to data URL
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Helper function to get image dimensions
  const getImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = dataUrl;
    });
  };

  const handlePaste = async (e: ClipboardEvent) => {
    console.log('🔍 Paste event triggered');

    if (!isInitialized()) {
      console.log('❌ Canvas not initialized yet');
      return;
    }

    // Check if the focus is inside a Monaco editor or other input element
    const activeElement = document.activeElement;
    const isInEditor = activeElement && (
      activeElement.classList.contains('monaco-editor') ||
      activeElement.closest('.monaco-editor') ||
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      (activeElement as HTMLElement).contentEditable === 'true'
    );

    console.log('🎯 Active element:', activeElement?.tagName, 'isInEditor:', isInEditor);

    // If we're in an editor, let the default paste behavior happen
    if (isInEditor) {
      console.log('📝 In editor, allowing default paste behavior');
      return;
    }

    // Prevent default paste behavior for canvas
    e.preventDefault();
    console.log('🚫 Prevented default paste behavior');

    const clipboardData = e.clipboardData;
    if (!clipboardData) {
      console.log('❌ No clipboard data available');
      return;
    }

    // Look for image data in clipboard
    const items = Array.from(clipboardData.items);
    console.log('📋 Clipboard items:', items.map(item => ({ type: item.type, kind: item.kind })));

    const imageItem = items.find(item => item.type.startsWith('image/'));
    console.log('🖼️ Found image item:', imageItem?.type);

    if (imageItem) {
      try {
        console.log('🔄 Processing image...');
        const file = imageItem.getAsFile();
        if (!file) {
          console.log('❌ Could not get file from image item');
          return;
        }

        console.log('📁 File details:', { name: file.name, size: file.size, type: file.type });

        // Convert image to data URL
        const dataUrl = await fileToDataUrl(file);
        console.log('🔗 Data URL created, length:', dataUrl.length);

        // Get image dimensions
        const { width: originalWidth, height: originalHeight } = await getImageDimensions(dataUrl);
        console.log('📏 Image dimensions:', originalWidth, 'x', originalHeight);

        // Calculate display size (scale down if too large)
        const maxSize = 400;
        const scale = Math.min(maxSize / originalWidth, maxSize / originalHeight, 1);
        const displayWidth = originalWidth * scale;
        const displayHeight = originalHeight * scale;
        console.log('📐 Display size:', displayWidth, 'x', displayHeight, 'scale:', scale);

        // Get canvas center for placement
        const canvasBounds = canvasRef!.getBoundingClientRect();
        const centerX = canvasBounds.width / 2;
        const centerY = canvasBounds.height / 2;
        console.log('🎯 Canvas center:', centerX, centerY);

        // Create image shape at canvas center
        console.log('🎨 Creating image shape...');
        createImageAtPosition(centerX, centerY, displayWidth, displayHeight, dataUrl, originalWidth, originalHeight);
        console.log('✅ Image shape created successfully!');

      } catch (error) {
        console.error('❌ Error pasting image:', error);
      }
    } else {
      console.log('ℹ️ No image found in clipboard');
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
      (activeElement as HTMLElement).contentEditable === 'true'
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
      case 'd':
        setSelectedTool('draw');
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

        {/* Draw Tool */}
        <button
          class={`tool-btn ${selectedTool() === 'draw' ? 'active' : ''}`}
          onClick={() => handleToolChange('draw')}
          disabled={!isInitialized()}
          title="Draw (D)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
            <circle cx="11" cy="11" r="2"/>
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

        {/* Shape Tools Dropdown - rightmost position */}
        <ShapeToolsDropdown
          selectedTool={selectedTool()}
          onToolChange={handleToolChange}
          disabled={!isInitialized()}
        />
      </div>
    </div>
    </WidgetLinkingProvider>
  );
};

export default App;
