// Worker entry point - runs in a dedicated Web Worker thread
// Handles communication between UI thread and Rust WASM core

import { MsgFromUI, MsgFromWorker, isMsgFromUI } from './protocol';

let core: any = null; // WhiteboardCore instance
let canvas: OffscreenCanvas | null = null;
let isInitialized = false;
let currentTool = 'select';

// Listen for messages from the main UI thread
self.addEventListener('message', async (event) => {
  const msg = event.data;
  
  if (!isMsgFromUI(msg)) {
    console.warn('Worker received invalid message:', msg);
    return;
  }

  try {
    await handleMessage(msg);
  } catch (error) {
    console.error('Error handling worker message:', error);
    const response: MsgFromWorker = { 
      type: 'error', 
      message: error instanceof Error ? error.message : String(error) 
    };
    self.postMessage(response);
  }
});

async function handleMessage(msg: MsgFromUI) {
  switch (msg.type) {
    case 'init':
      await handleInit(msg.canvas, msg.devicePixelRatio);
      break;
      
    case 'resize':
      if (core && isInitialized) {
        core.resize_viewport(msg.width, msg.height, 1.0);
        render();
      }
      break;
      
    case 'pointerDown':
      if (core && isInitialized) {
        if (currentTool === 'select') {
          core.handle_pointer_down(msg.x, msg.y);
          notifySelectionChanged();
        } else {
          // Create shape at pointer location
          createShapeAtPosition(currentTool, msg.x, msg.y);
        }
        render();
      }
      break;
      
    case 'pointerMove':
      if (core && isInitialized) {
        core.handle_pointer_move(msg.x, msg.y);
        render();
      }
      break;
      
    case 'pointerUp':
      if (core && isInitialized) {
        core.handle_pointer_up(msg.x, msg.y);
        render();
      }
      break;
      
    case 'wheel':
      if (core && isInitialized) {
        core.handle_wheel(msg.dx, msg.dy);
        render();
      }
      break;
      
    case 'command':
      if (core && isInitialized) {
        handleCommand(msg.name);
      }
      break;
      
    case 'toolChange':
      currentTool = msg.tool;
      break;
      
    case 'createShape':
      if (core && isInitialized) {
        createShape(msg);
        render();
      }
      break;
      
    case 'panCamera':
      if (core && isInitialized) {
        core.pan_camera(msg.dx, msg.dy);
        render();
      }
      break;
  }
}

async function handleInit(offscreenCanvas: OffscreenCanvas, devicePixelRatio: number) {
  try {
    // Store canvas reference
    canvas = offscreenCanvas;
    
    // Initialize WASM module
    const wasmModule = await import('core');
    await wasmModule.default();
    
    // Create core instance
    core = new (wasmModule as any).WhiteboardCore();
    
    // Try to initialize WebGPU
    try {
      await core.initialize_webgpu(canvas);
      console.log('✅ WebGPU initialized successfully');
    } catch (webgpuError) {
      console.warn('⚠️ WebGPU initialization failed:', webgpuError);
      throw webgpuError;
    }
    
    // Set initial viewport size
    core.resize_viewport(canvas.width, canvas.height, devicePixelRatio);
    
    isInitialized = true;
    
    // Initial render
    render();
    
    // Notify UI thread that worker is ready
    const response: MsgFromWorker = { type: 'initialized' };
    self.postMessage(response);
    
  } catch (error) {
    console.error('Failed to initialize worker:', error);
    const response: MsgFromWorker = { 
      type: 'error', 
      message: `Failed to initialize: ${error}` 
    };
    self.postMessage(response);
  }
}

function render() {
  if (!core || !canvas) {
    return;
  }
  
  try {
    core.render_frame();
  } catch (error) {
    console.error('Render failed:', error);
  }
}

function createShapeAtPosition(tool: string, x: number, y: number) {
  if (!core) return;
  
  const defaultSize = 100;
  
  switch (tool) {
    case 'rectangle':
      core.create_rectangle(x, y, defaultSize, defaultSize);
      break;
    case 'ellipse':
      core.create_ellipse(x, y, defaultSize, defaultSize);
      break;
    case 'line':
      core.create_line(x, y, x + defaultSize, y + defaultSize);
      break;
  }
  
  notifyShapeCountChanged();
}

function createShape(msg: any) {
  if (!core) return;
  
  switch (msg.tool) {
    case 'rectangle':
      core.create_rectangle(msg.x, msg.y, msg.width || 100, msg.height || 100);
      break;
    case 'ellipse':
      core.create_ellipse(msg.x, msg.y, msg.width || 100, msg.height || 100);
      break;
    case 'line':
      core.create_line(msg.x, msg.y, msg.endX || msg.x + 100, msg.endY || msg.y + 100);
      break;
  }
  
  notifyShapeCountChanged();
}

function handleCommand(command: string) {
  if (!core) return;
  
  switch (command) {
    case 'clear':
      core.clear_all();
      notifyShapeCountChanged();
      notifySelectionChanged();
      render();
      break;
    case 'deleteSelection':
      // TODO: Implement delete selected shapes
      break;
    case 'undo':
    case 'redo':
    case 'duplicate':
      // TODO: Implement these commands
      break;
  }
}

function notifySelectionChanged() {
  if (!core) return;
  
  const selectedCount = core.selected_count();
  const response: MsgFromWorker = { 
    type: 'selectionChanged', 
    selectedIds: Array(selectedCount).fill(0).map((_, i) => `shape-${i}`) 
  };
  self.postMessage(response);
}

function notifyShapeCountChanged() {
  if (!core) return;
  
  const count = core.shape_count();
  const response: MsgFromWorker = { 
    type: 'shapeCountChanged', 
    count 
  };
  self.postMessage(response);
}
