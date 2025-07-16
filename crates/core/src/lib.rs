//! Clean whiteboard core compiled to WebAssembly.
//!
//! This crate provides a basic shape management system for a drawing whiteboard.

// Remove unused lyon imports for now
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use base64;

mod gpu;
mod utils;
use gpu::{GpuState, Vertex};

#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen(start)]
pub fn main() {
    utils::set_panic_hook();
    console_error_panic_hook::set_once();
}

/// Unique identifier for a shape
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ShapeId(pub u32);

/// Simple point structure
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[wasm_bindgen]
impl Point {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// Shape types supported by the whiteboard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ShapeType {
    Rectangle { width: f64, height: f64 },
    Ellipse { width: f64, height: f64 },
    Image { width: f64, height: f64, data_url: String, original_width: f64, original_height: f64 },
    Widget { widget_type: WidgetType, width: f64, height: f64, active: bool },
    Draw { points: Vec<Point>, stroke_width: f64 },
    DrawPreTriangulated {
        vertices: Vec<Vertex>,
        bounding_points: Vec<Point>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WidgetType {
    Monaco { language: String, file_path: String },
    Terminal { session_id: String },
    Preview { url: String, preview_type: PreviewType },
    Chat { conversation_id: String },
    Explorer { root_path: String },
    Console { log_level: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PreviewType {
    File,
    Server,
}

/// A shape on the whiteboard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shape {
    pub id: ShapeId,
    pub position: Point,
    pub shape_type: ShapeType,
    pub color: [f32; 4], // RGBA
}

/// Bounding box for hit testing
#[derive(Debug, Clone, Copy)]
pub struct BoundingBox {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// Resize handle types
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ResizeHandle {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Top,
    Bottom,
    Left,
    Right,
}

/// Resize handle with position and type
#[derive(Debug, Clone, Copy)]
pub struct ResizeHandleInfo {
    pub handle_type: ResizeHandle,
    pub position: Point,
    pub size: f64, // Handle size in pixels
}

/// Simplified state snapshot for undo/redo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasState {
    shapes: HashMap<ShapeId, Shape>,
    selected_shapes: Vec<ShapeId>,
    next_id: u32,
}

/// History manager for undo/redo using state snapshots
#[derive(Debug, Clone)]
pub struct History {
    undo_stack: Vec<CanvasState>,
    redo_stack: Vec<CanvasState>,
    max_history: usize,
}

impl History {
    pub fn new() -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_history: 50, // Reduced since we're storing full states
        }
    }

    pub fn push_state(&mut self, state: CanvasState) {
        // Clear redo stack when new state is added
        self.redo_stack.clear();

        // Add to undo stack
        self.undo_stack.push(state);

        // Limit history size
        if self.undo_stack.len() > self.max_history {
            self.undo_stack.remove(0);
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo_with_current_state(&mut self, current_state: CanvasState) -> Option<CanvasState> {
        if let Some(previous_state) = self.undo_stack.pop() {
            // Save current state to redo stack
            self.redo_stack.push(current_state);
            // Return the previous state to restore
            Some(previous_state)
        } else {
            None
        }
    }

    pub fn redo_with_current_state(&mut self, current_state: CanvasState) -> Option<CanvasState> {
        if let Some(next_state) = self.redo_stack.pop() {
            // Save current state to undo stack
            self.undo_stack.push(current_state);
            // Return the next state to restore
            Some(next_state)
        } else {
            None
        }
    }
}

/// Data structure for resize operations
#[derive(Debug, Clone)]
struct ResizeData {
    new_position: Option<Point>,
    new_width: Option<f64>,
    new_height: Option<f64>,
}

/// Apply resize data to a shape
fn apply_resize(shape: &mut Shape, resize_data: ResizeData) {
    if let Some(new_position) = resize_data.new_position {
        shape.position = new_position;
    }

    match &mut shape.shape_type {
        ShapeType::Rectangle { width, height } | ShapeType::Ellipse { width, height } => {
            if let Some(new_width) = resize_data.new_width {
                *width = new_width;
            }
            if let Some(new_height) = resize_data.new_height {
                *height = new_height;
            }
        }
        ShapeType::Image { width, height, .. } => {
            if let Some(new_width) = resize_data.new_width {
                *width = new_width;
            }
            if let Some(new_height) = resize_data.new_height {
                *height = new_height;
            }
        }
        ShapeType::Widget { width, height, .. } => {
            if let Some(new_width) = resize_data.new_width {
                *width = new_width;
            }
            if let Some(new_height) = resize_data.new_height {
                *height = new_height;
            }
        }
        ShapeType::Draw { .. } => {
            // Draw shapes don't support traditional resizing
            // They could be scaled, but that's more complex
        }
        ShapeType::DrawPreTriangulated { .. } => {
            // Pre-triangulated draw shapes don't support traditional resizing
        }
    }
}

impl BoundingBox {
    pub fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self { min_x, min_y, max_x, max_y }
    }

    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }
}

impl Shape {
    pub fn bounding_box(&self) -> BoundingBox {
        let x = self.position.x;
        let y = self.position.y;

        match &self.shape_type {
            ShapeType::Rectangle { width, height } => {
                BoundingBox::new(x, y, x + width, y + height)
            }
            ShapeType::Ellipse { width, height } => {
                BoundingBox::new(x, y, x + width, y + height)
            }
            ShapeType::Image { width, height, .. } => {
                BoundingBox::new(x, y, x + width, y + height)
            }
            ShapeType::Widget { width, height, .. } => {
                BoundingBox::new(x, y, x + width, y + height)
            }
            ShapeType::Draw { points, stroke_width } => {
                if points.is_empty() {
                    return BoundingBox::new(x, y, x, y);
                }

                let mut min_x = points[0].x;
                let mut min_y = points[0].y;
                let mut max_x = points[0].x;
                let mut max_y = points[0].y;

                for point in points {
                    min_x = min_x.min(point.x);
                    min_y = min_y.min(point.y);
                    max_x = max_x.max(point.x);
                    max_y = max_y.max(point.y);
                }

                // Add stroke width padding
                let padding = stroke_width / 2.0;
                BoundingBox::new(
                    min_x - padding,
                    min_y - padding,
                    max_x + padding,
                    max_y + padding
                )
            }
            ShapeType::DrawPreTriangulated { bounding_points, .. } => {
                if bounding_points.is_empty() {
                    return BoundingBox::new(x, y, x, y);
                }

                let mut min_x = bounding_points[0].x;
                let mut min_y = bounding_points[0].y;
                let mut max_x = bounding_points[0].x;
                let mut max_y = bounding_points[0].y;

                for point in bounding_points {
                    min_x = min_x.min(point.x);
                    min_y = min_y.min(point.y);
                    max_x = max_x.max(point.x);
                    max_y = max_y.max(point.y);
                }

                BoundingBox::new(min_x, min_y, max_x, max_y)
            }
        }
    }
}

/// Main whiteboard core
#[wasm_bindgen]
pub struct WhiteboardCore {
    shapes: HashMap<ShapeId, Shape>,
    next_id: u32,
    selected_shapes: Vec<ShapeId>,
    gpu: Option<GpuState>,
    camera_translation: [f32; 2],
    camera_scale: f32,
    // Drag state
    is_dragging: bool,
    drag_start: Option<Point>,
    drag_offset: HashMap<ShapeId, Point>, // Offset from drag start to shape origin
    dragged_widget: Option<ShapeId>, // Track which widget is being dragged (separate from selection)
    // Widget selection state (separate from regular shape selection)
    selected_widget: Option<ShapeId>, // Track which widget is selected for resize handles
    // Resize state
    is_resizing: bool,
    resize_handle: Option<ResizeHandle>,
    resize_shape_id: Option<ShapeId>,
    resize_start_bounds: Option<BoundingBox>,
    // Selection rectangle state
    is_selection_dragging: bool,
    selection_start: Option<Point>,
    selection_current: Option<Point>,
    // Shape creation state
    is_creating_shape: bool,
    creation_start: Option<Point>,
    creation_current: Option<Point>,
    creation_shape_type: Option<String>,
    creation_shape_id: Option<ShapeId>,
    // Drawing state
    is_drawing: bool,
    current_draw_points: Vec<Point>,
    current_draw_id: Option<ShapeId>,
    // History for undo/redo
    history: History,
}

#[wasm_bindgen]
impl WhiteboardCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            shapes: HashMap::new(),
            next_id: 1,
            selected_shapes: Vec::new(),
            gpu: None,
            camera_translation: [0.0, 0.0],
            camera_scale: 1.0,
            // Drag state
            is_dragging: false,
            drag_start: None,
            drag_offset: HashMap::new(),
            dragged_widget: None,
            // Widget selection state
            selected_widget: None,
            // Resize state
            is_resizing: false,
            resize_handle: None,
            resize_shape_id: None,
            resize_start_bounds: None,
            // Selection rectangle state
            is_selection_dragging: false,
            selection_start: None,
            selection_current: None,
            // Shape creation state
            is_creating_shape: false,
            creation_start: None,
            creation_current: None,
            creation_shape_type: None,
            creation_shape_id: None,
            // Drawing state
            is_drawing: false,
            current_draw_points: Vec::new(),
            current_draw_id: None,
            // History for undo/redo
            history: History::new(),
        }
    }

    /// Initialize WebGPU
    pub async fn initialize_webgpu(
        &mut self,
        canvas: &web_sys::OffscreenCanvas,
    ) -> Result<(), JsValue> {
        match GpuState::new(canvas).await {
            Ok(gpu) => {
                self.gpu = Some(gpu);
                Ok(())
            }
            Err(e) => {
                web_sys::console::error_1(&e);
                Err(e)
            }
        }
    }

    /// Resize the viewport
    pub fn resize_viewport(&mut self, width: f64, height: f64, pixel_ratio: f64) {
        let w = width as u32;
        let h = height as u32;
        if let Some(gpu) = &mut self.gpu {
            gpu.resize(w, h, pixel_ratio);
        }
    }

    /// Create a new rectangle shape
    #[wasm_bindgen]
    pub fn create_rectangle(&mut self, x: f64, y: f64, width: f64, height: f64) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Rectangle { width, height },
            color: [1.0, 1.0, 1.0, 1.0], // White
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a new ellipse shape
    #[wasm_bindgen]
    pub fn create_ellipse(&mut self, x: f64, y: f64, width: f64, height: f64) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Ellipse { width, height },
            color: [1.0, 1.0, 1.0, 1.0], // White
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a new image shape
    #[wasm_bindgen]
    pub fn create_image(&mut self, x: f64, y: f64, width: f64, height: f64, data_url: &str, original_width: f64, original_height: f64) -> u32 {
        // Save state before operation
        self.save_state();

        // Process the image data and create texture
        if let Err(e) = self.process_image_data(data_url, original_width as u32, original_height as u32) {
            web_sys::console::error_1(&format!("Failed to process image data: {}", e).into());
        }

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Image {
                width,
                height,
                data_url: data_url.to_string(),
                original_width,
                original_height
            },
            color: [1.0, 1.0, 1.0, 1.0], // White (not used for images)
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a new image shape with RGBA data directly
    #[wasm_bindgen]
    pub fn create_image_with_rgba(&mut self, x: f64, y: f64, width: f64, height: f64, data_url: &str, original_width: f64, original_height: f64, rgba_data: &[u8]) -> u32 {
        // Save state before operation
        self.save_state();

        // Process the RGBA data and create texture
        if let Err(e) = self.process_rgba_data(data_url, rgba_data, original_width as u32, original_height as u32) {
            web_sys::console::error_1(&format!("Failed to process RGBA data: {}", e).into());
        }

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Image {
                width,
                height,
                data_url: data_url.to_string(),
                original_width,
                original_height
            },
            color: [1.0, 1.0, 1.0, 1.0], // White (not used for images)
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Process image data URL and create GPU texture
    fn process_image_data(&mut self, data_url: &str, width: u32, height: u32) -> Result<(), String> {
        // Parse data URL format: data:image/png;base64,<base64_data>
        if !data_url.starts_with("data:image/") {
            return Err("Invalid data URL format".to_string());
        }

        let parts: Vec<&str> = data_url.split(',').collect();
        if parts.len() != 2 {
            return Err("Invalid data URL structure".to_string());
        }

        let base64_data = parts[1];

        // Decode base64 data
        use base64::Engine;
        let image_bytes = base64::engine::general_purpose::STANDARD.decode(base64_data)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        // For now, we'll assume the image is already in RGBA format
        // In a production system, you'd want to use an image decoding library
        // But for this demo, we'll create a simple conversion
        let rgba_data = self.convert_to_rgba(&image_bytes, width, height)?;

        // Create texture in GPU
        if let Some(gpu) = &mut self.gpu {
            gpu.create_texture_from_data(data_url, &rgba_data, width, height)
                .map_err(|e| format!("Failed to create GPU texture: {}", e))?;
        }

        Ok(())
    }

    /// Process RGBA data directly and create GPU texture
    fn process_rgba_data(&mut self, data_url: &str, rgba_data: &[u8], width: u32, height: u32) -> Result<(), String> {
        // Validate RGBA data size
        let expected_size = (width * height * 4) as usize;
        if rgba_data.len() != expected_size {
            return Err(format!("RGBA data size mismatch: expected {}, got {}", expected_size, rgba_data.len()));
        }

        // Create texture in GPU
        if let Some(gpu) = &mut self.gpu {
            gpu.create_texture_from_data(data_url, rgba_data, width, height)
                .map_err(|e| format!("Failed to create GPU texture: {}", e))?;
        }

        Ok(())
    }

    /// Convert image bytes to RGBA format (simplified for demo)
    fn convert_to_rgba(&self, _image_bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
        // For this demo, we'll create a simple pattern
        // In production, you'd use an image decoding library like `image` crate
        let mut rgba_data = Vec::with_capacity((width * height * 4) as usize);

        for y in 0..height {
            for x in 0..width {
                // Create a simple gradient pattern for demo
                let r = ((x as f32 / width as f32) * 255.0) as u8;
                let g = ((y as f32 / height as f32) * 255.0) as u8;
                let b = 128;
                let a = 255;

                rgba_data.push(r);
                rgba_data.push(g);
                rgba_data.push(b);
                rgba_data.push(a);
            }
        }

        Ok(rgba_data)
    }

    /// Get all image shapes as JSON for AI context
    #[wasm_bindgen]
    pub fn get_image_shapes(&self) -> String {
        let mut images = Vec::new();

        for shape in self.shapes.values() {
            if let ShapeType::Image { width, height, data_url, original_width, original_height } = &shape.shape_type {
                let image_info = serde_json::json!({
                    "id": shape.id.0,
                    "position": {
                        "x": shape.position.x,
                        "y": shape.position.y
                    },
                    "width": width,
                    "height": height,
                    "original_width": original_width,
                    "original_height": original_height,
                    "data_url": data_url
                });
                images.push(image_info);
            }
        }

        serde_json::to_string(&images).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get count of image shapes
    #[wasm_bindgen]
    pub fn image_count(&self) -> u32 {
        self.shapes.values()
            .filter(|shape| matches!(shape.shape_type, ShapeType::Image { .. }))
            .count() as u32
    }



    /// Delete a shape by ID
    #[wasm_bindgen]
    pub fn delete_shape(&mut self, shape_id: u32) -> bool {
        let id = ShapeId(shape_id);
        self.selected_shapes.retain(|&s| s != id);
        self.shapes.remove(&id).is_some()
    }

    /// Delete selected shapes
    #[wasm_bindgen]
    pub fn delete_selected(&mut self) -> usize {
        let mut deleted_count = 0;

        // Check if we have any shapes or widgets to delete
        if self.selected_shapes.is_empty() && self.selected_widget.is_none() {
            return 0;
        }

        // Save state before operation
        self.save_state();

        // Delete selected regular shapes
        if !self.selected_shapes.is_empty() {
            deleted_count += self.selected_shapes.len();
            for &shape_id in &self.selected_shapes {
                self.shapes.remove(&shape_id);
            }
            self.selected_shapes.clear();
        }

        // Delete selected widget
        if let Some(widget_id) = self.selected_widget {
            self.shapes.remove(&widget_id);
            self.selected_widget = None;
            deleted_count += 1;
        }

        deleted_count
    }

    /// Clear all shapes
    #[wasm_bindgen]
    pub fn clear_all(&mut self) {
        if self.shapes.is_empty() {
            return;
        }

        // Save state before operation
        self.save_state();

        self.shapes.clear();
        self.selected_shapes.clear();
    }

    /// Create a Monaco editor widget
    #[wasm_bindgen]
    pub fn create_monaco_widget(&mut self, x: f64, y: f64, width: f64, height: f64, language: &str, file_path: &str) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Monaco {
                    language: language.to_string(),
                    file_path: file_path.to_string(),
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a terminal widget
    #[wasm_bindgen]
    pub fn create_terminal_widget(&mut self, x: f64, y: f64, width: f64, height: f64, session_id: &str) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Terminal {
                    session_id: session_id.to_string(),
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a preview widget
    #[wasm_bindgen]
    pub fn create_preview_widget(&mut self, x: f64, y: f64, width: f64, height: f64, url: &str, is_server: bool) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let preview_type = if is_server { PreviewType::Server } else { PreviewType::File };

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Preview {
                    url: url.to_string(),
                    preview_type,
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a chat widget
    #[wasm_bindgen]
    pub fn create_chat_widget(&mut self, x: f64, y: f64, width: f64, height: f64, conversation_id: &str) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Chat {
                    conversation_id: conversation_id.to_string(),
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create an explorer widget
    #[wasm_bindgen]
    pub fn create_explorer_widget(&mut self, x: f64, y: f64, width: f64, height: f64, root_path: &str) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Explorer {
                    root_path: root_path.to_string(),
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a console widget
    #[wasm_bindgen]
    pub fn create_console_widget(&mut self, x: f64, y: f64, width: f64, height: f64, log_level: &str) -> u32 {
        // Save state before operation
        self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Widget {
                widget_type: WidgetType::Console {
                    log_level: log_level.to_string(),
                },
                width,
                height,
                active: true,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White outline
        };

        self.shapes.insert(id, shape);
        id.0
    }



    /// Toggle widget active state
    #[wasm_bindgen]
    pub fn toggle_widget_active(&mut self, shape_id: u32) -> bool {
        let shape_id = ShapeId(shape_id);
        if let Some(shape) = self.shapes.get_mut(&shape_id) {
            if let ShapeType::Widget { active, .. } = &mut shape.shape_type {
                *active = !*active;
                return *active;
            }
        }
        false
    }

    /// Get widget info as JSON string
    #[wasm_bindgen]
    pub fn get_widget_info(&self, shape_id: u32) -> Option<String> {
        let shape_id = ShapeId(shape_id);
        if let Some(shape) = self.shapes.get(&shape_id) {
            if let ShapeType::Widget { widget_type, width, height, active } = &shape.shape_type {
                let info = serde_json::json!({
                    "id": shape_id.0,
                    "type": match widget_type {
                        WidgetType::Monaco { .. } => "monaco",
                        WidgetType::Terminal { .. } => "terminal",
                        WidgetType::Preview { .. } => "preview",
                        WidgetType::Chat { .. } => "chat",
                        WidgetType::Explorer { .. } => "explorer",
                        WidgetType::Console { .. } => "console",
                    },
                    "position": {
                        "x": shape.position.x,
                        "y": shape.position.y
                    },
                    "size": {
                        "width": width,
                        "height": height
                    },
                    "active": active,
                    "props": widget_type
                });
                return Some(info.to_string());
            }
        }
        None
    }

    /// Get all active widgets as JSON string
    #[wasm_bindgen]
    pub fn get_active_widgets(&self) -> String {
        let mut widgets = Vec::new();

        for shape in self.shapes.values() {
            if let ShapeType::Widget { active: true, .. } = &shape.shape_type {
                if let Some(widget_info) = self.get_widget_info(shape.id.0) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&widget_info) {
                        widgets.push(parsed);
                    }
                }
            }
        }

        serde_json::json!(widgets).to_string()
    }

    /// Convert world coordinates to screen coordinates
    #[wasm_bindgen]
    pub fn world_to_screen(&self, world_x: f64, world_y: f64) -> Vec<f64> {
        let screen_x = (world_x - self.camera_translation[0] as f64) * self.camera_scale as f64;
        let screen_y = (world_y - self.camera_translation[1] as f64) * self.camera_scale as f64;
        vec![screen_x, screen_y]
    }

    /// Convert screen coordinates to world coordinates
    #[wasm_bindgen]
    pub fn screen_to_world(&self, screen_x: f64, screen_y: f64) -> Vec<f64> {
        let world_x = (screen_x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (screen_y / self.camera_scale as f64) + self.camera_translation[1] as f64;
        vec![world_x, world_y]
    }

    /// Get widget screen bounds for overlay positioning
    #[wasm_bindgen]
    pub fn get_widget_screen_bounds(&self, shape_id: u32) -> Option<String> {
        let shape_id = ShapeId(shape_id);
        if let Some(shape) = self.shapes.get(&shape_id) {
            if let ShapeType::Widget { width, height, .. } = &shape.shape_type {
                // Convert widget world coordinates to screen coordinates
                let screen_pos = self.world_to_screen(shape.position.x, shape.position.y);
                let screen_width = width * self.camera_scale as f64;
                let screen_height = height * self.camera_scale as f64;

                let bounds = serde_json::json!({
                    "x": screen_pos[0],
                    "y": screen_pos[1],
                    "width": screen_width,
                    "height": screen_height,
                    "scale": self.camera_scale
                });
                return Some(bounds.to_string());
            }
        }
        None
    }

    /// Get the number of shapes
    #[wasm_bindgen]
    pub fn shape_count(&self) -> usize {
        self.shapes.len()
    }

    /// Get the number of selected shapes
    #[wasm_bindgen]
    pub fn selected_count(&self) -> usize {
        self.selected_shapes.len()
    }

    /// Get selected shape IDs as JSON array
    #[wasm_bindgen]
    pub fn get_selected_shapes(&self) -> String {
        let selected_ids: Vec<u32> = self.selected_shapes.iter().map(|id| id.0).collect();
        serde_json::to_string(&selected_ids).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get selected image shapes as JSON for AI context
    #[wasm_bindgen]
    pub fn get_selected_image_shapes(&self) -> String {
        let mut selected_images = Vec::new();

        for &shape_id in &self.selected_shapes {
            if let Some(shape) = self.shapes.get(&shape_id) {
                if let ShapeType::Image { width, height, data_url, original_width, original_height } = &shape.shape_type {
                    let image_info = serde_json::json!({
                        "id": shape.id.0,
                        "position": {
                            "x": shape.position.x,
                            "y": shape.position.y
                        },
                        "width": width,
                        "height": height,
                        "original_width": original_width,
                        "original_height": original_height,
                        "data_url": data_url
                    });
                    selected_images.push(image_info);
                }
            }
        }

        serde_json::to_string(&selected_images).unwrap_or_else(|_| "[]".to_string())
    }

    /// Check if a point is over any shape (for hover detection)
    #[wasm_bindgen]
    pub fn is_point_over_shape(&self, x: f64, y: f64) -> bool {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        // Check if any shape contains this point
        for shape in self.shapes.values() {
            if shape.bounding_box().contains_point(world_x, world_y) {
                return true;
            }
        }
        false
    }

    /// Check if currently dragging
    #[wasm_bindgen]
    pub fn is_dragging(&self) -> bool {
        self.is_dragging
    }

    /// Check if currently resizing
    #[wasm_bindgen]
    pub fn is_resizing(&self) -> bool {
        self.is_resizing
    }

    /// Check if currently dragging selection rectangle
    #[wasm_bindgen]
    pub fn is_selection_dragging(&self) -> bool {
        self.is_selection_dragging
    }

    /// Get selection box for overlay rendering (returns screen coordinates)
    #[wasm_bindgen]
    pub fn get_selection_box_for_overlay(&self) -> Option<js_sys::Object> {
        if !self.is_selection_dragging {
            return None;
        }

        if let (Some(start), Some(current)) = (self.selection_start, self.selection_current) {
            // Convert world coordinates to screen coordinates
            let start_screen = self.world_to_screen(start.x, start.y);
            let current_screen = self.world_to_screen(current.x, current.y);

            let min_x = start_screen[0].min(current_screen[0]);
            let max_x = start_screen[0].max(current_screen[0]);
            let min_y = start_screen[1].min(current_screen[1]);
            let max_y = start_screen[1].max(current_screen[1]);

            let js_box = js_sys::Object::new();
            js_sys::Reflect::set(&js_box, &"x".into(), &min_x.into()).unwrap();
            js_sys::Reflect::set(&js_box, &"y".into(), &min_y.into()).unwrap();
            js_sys::Reflect::set(&js_box, &"width".into(), &(max_x - min_x).into()).unwrap();
            js_sys::Reflect::set(&js_box, &"height".into(), &(max_y - min_y).into()).unwrap();

            Some(js_box)
        } else {
            None
        }
    }

    /// Get current camera scale for coordinate conversion
    #[wasm_bindgen]
    pub fn get_camera_scale(&self) -> f64 {
        self.camera_scale as f64
    }

    /// Get current camera translation for coordinate conversion
    #[wasm_bindgen]
    pub fn get_camera_translation(&self) -> Vec<f64> {
        vec![self.camera_translation[0] as f64, self.camera_translation[1] as f64]
    }

    /// Start creating a shape with click and drag
    #[wasm_bindgen]
    pub fn start_shape_creation(&mut self, x: f64, y: f64, shape_type: &str) {
        // Save state before creating the shape
        self.save_state();

        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        self.is_creating_shape = true;
        self.creation_start = Some(Point { x: world_x, y: world_y });
        self.creation_current = Some(Point { x: world_x, y: world_y });
        self.creation_shape_type = Some(shape_type.to_string());

        // Create a minimal shape that will be resized
        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = match shape_type {
            "rectangle" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Rectangle { width: 1.0, height: 1.0 },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "ellipse" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Ellipse { width: 1.0, height: 1.0 },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "image" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Image {
                    width: 100.0,
                    height: 100.0,
                    data_url: "".to_string(), // Will be set later
                    original_width: 100.0,
                    original_height: 100.0
                },
                color: [1.0, 1.0, 1.0, 1.0], // White (not used for images)
            },
            "monaco" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Monaco {
                        language: "typescript".to_string(),
                        file_path: "untitled.ts".to_string(),
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "terminal" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Terminal {
                        session_id: format!("session_{}", id.0),
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "preview" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Preview {
                        url: "http://localhost:3000".to_string(),
                        preview_type: PreviewType::Server,
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "chat" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Chat {
                        conversation_id: format!("conv_{}", id.0),
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "explorer" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Explorer {
                        root_path: "/workspace".to_string(),
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            "console" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Widget {
                    widget_type: WidgetType::Console {
                        log_level: "all".to_string(),
                    },
                    width: 100.0,
                    height: 100.0,
                    active: true,
                },
                color: [1.0, 1.0, 1.0, 1.0], // White
            },
            _ => return, // Unknown shape type
        };

        self.shapes.insert(id, shape);
        self.creation_shape_id = Some(id);
    }

    /// Update shape creation during drag
    #[wasm_bindgen]
    pub fn update_shape_creation(&mut self, x: f64, y: f64) {
        if !self.is_creating_shape {
            return;
        }

        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        self.creation_current = Some(Point { x: world_x, y: world_y });

        // Update the existing shape in real-time
        if let (Some(start), Some(shape_id)) = (self.creation_start, self.creation_shape_id) {
            if let Some(shape) = self.shapes.get_mut(&shape_id) {
                // Calculate new dimensions and position
                let width = (world_x - start.x).abs().max(10.0);
                let height = (world_y - start.y).abs().max(10.0);
                let new_x = start.x.min(world_x);
                let new_y = start.y.min(world_y);

                // Update the shape
                shape.position = Point { x: new_x, y: new_y };
                match &mut shape.shape_type {
                    ShapeType::Rectangle { width: w, height: h } => {
                        *w = width;
                        *h = height;
                    }
                    ShapeType::Ellipse { width: w, height: h } => {
                        *w = width;
                        *h = height;
                    }
                    ShapeType::Image { width: w, height: h, .. } => {
                        *w = width;
                        *h = height;
                    }
                    ShapeType::Widget { width: w, height: h, .. } => {
                        *w = width;
                        *h = height;
                    }
                    ShapeType::Draw { .. } => {
                        // Draw shapes don't support drag creation
                    }
                    ShapeType::DrawPreTriangulated { .. } => {
                        // Pre-triangulated draw shapes don't support drag creation
                    }
                }
            }
        }
    }

    /// Finish shape creation and finalize the existing shape
    #[wasm_bindgen]
    pub fn finish_shape_creation(&mut self) -> Option<u32> {
        if !self.is_creating_shape {
            return None;
        }

        let shape_id = self.creation_shape_id?;

        // Reset creation state (state was already saved in start_shape_creation)
        self.is_creating_shape = false;
        self.creation_start = None;
        self.creation_current = None;
        self.creation_shape_type = None;
        self.creation_shape_id = None;

        Some(shape_id.0)
    }

    /// Cancel shape creation
    #[wasm_bindgen]
    pub fn cancel_shape_creation(&mut self) {
        // Remove the shape if it was created
        if let Some(shape_id) = self.creation_shape_id {
            self.shapes.remove(&shape_id);
        }

        self.is_creating_shape = false;
        self.creation_start = None;
        self.creation_current = None;
        self.creation_shape_type = None;
        self.creation_shape_id = None;
    }

    /// Check if currently creating a shape
    #[wasm_bindgen]
    pub fn is_creating_shape(&self) -> bool {
        self.is_creating_shape
    }

    /// Start drawing a new path
    #[wasm_bindgen]
    pub fn start_drawing(&mut self, x: f64, y: f64) {
        // Save state before operation
        self.save_state();

        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        web_sys::console::log_1(&format!("🎨 Starting drawing at screen ({}, {}) -> world ({}, {})", x, y, world_x, world_y).into());

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        // Start with the initial point
        let initial_point = Point { x: world_x, y: world_y };
        self.current_draw_points = vec![initial_point];
        self.current_draw_id = Some(id);
        self.is_drawing = true;

        // Create the initial draw shape
        let shape = Shape {
            id,
            position: initial_point, // Position is the first point
            shape_type: ShapeType::Draw {
                points: self.current_draw_points.clone(),
                stroke_width: 5.0, // Increased to 5.0 for slightly thicker lines
            },
            color: [1.0, 1.0, 1.0, 1.0], // White color for better visibility
        };

        self.shapes.insert(id, shape);
        web_sys::console::log_1(&format!("🎨 Created draw shape with ID {}", id.0).into());
    }

    /// Add a point to the current drawing path
    #[wasm_bindgen]
    pub fn add_draw_point(&mut self, x: f64, y: f64) {
        if !self.is_drawing || self.current_draw_id.is_none() {
            return;
        }

        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        let new_point = Point { x: world_x, y: world_y };

        // Apply distance filtering to reduce noise and create smoother lines
        let min_distance = 2.0; // Minimum distance between points
        if let Some(last_point) = self.current_draw_points.last() {
            let dx = new_point.x - last_point.x;
            let dy = new_point.y - last_point.y;
            let distance = (dx * dx + dy * dy).sqrt();

            // Only add point if it's far enough from the last point
            if distance < min_distance {
                return;
            }
        }

        // Add point to current path
        self.current_draw_points.push(new_point);
        web_sys::console::log_1(&format!("🎨 Added point {}: ({}, {}) - total points: {}",
            self.current_draw_points.len(), world_x, world_y, self.current_draw_points.len()).into());

        // Update the shape with new points
        if let Some(shape_id) = self.current_draw_id {
            if let Some(shape) = self.shapes.get_mut(&shape_id) {
                if let ShapeType::Draw { points, .. } = &mut shape.shape_type {
                    *points = self.current_draw_points.clone();
                }
            }
        }
    }

    /// Finish the current drawing path
    #[wasm_bindgen]
    pub fn finish_drawing(&mut self) -> Option<u32> {
        if !self.is_drawing {
            return None;
        }

        let shape_id = self.current_draw_id?;

        // Reset drawing state
        self.is_drawing = false;
        self.current_draw_points.clear();
        self.current_draw_id = None;

        Some(shape_id.0)
    }

    /// Cancel the current drawing
    #[wasm_bindgen]
    pub fn cancel_drawing(&mut self) {
        if let Some(shape_id) = self.current_draw_id {
            self.shapes.remove(&shape_id);
        }

        self.is_drawing = false;
        self.current_draw_points.clear();
        self.current_draw_id = None;
    }

    /// Check if currently drawing
    #[wasm_bindgen]
    pub fn is_drawing(&self) -> bool {
        self.is_drawing
    }

    /// Create a draw shape from pre-triangulated vertices (from perfect-freehand JavaScript)
    #[wasm_bindgen]
    pub fn create_draw_shape_from_triangles(&mut self, vertices_js: &js_sys::Array) -> u32 {
        self.create_smooth_draw_shape(vertices_js)
    }

    /// Create a draw shape from pre-triangulated vertices (from perfect-freehand JavaScript)
    #[wasm_bindgen]
    pub fn create_smooth_draw_shape(&mut self, vertices_js: &js_sys::Array) -> u32 {
        // Don't save state for live drawing - only save at start/end of drawing session
        // self.save_state();

        let id = ShapeId(self.next_id);
        self.next_id += 1;

        // Convert the pre-triangulated vertices from JavaScript
        let mut vertices = Vec::new();
        let mut positions = Vec::new();

        web_sys::console::log_1(&format!("Rust: Received {} vertex objects from JS", vertices_js.length()).into());

        for i in 0..vertices_js.length() {
            if let Ok(vertex_obj) = vertices_js.get(i).dyn_into::<js_sys::Object>() {
                // Debug: log what we're receiving
                if i == 0 {
                    web_sys::console::log_1(&format!("Rust: First vertex object type: {:?}", vertex_obj).into());

                    // Try to get all properties
                    let keys = js_sys::Object::keys(&vertex_obj);
                    let mut key_names = Vec::new();
                    for j in 0..keys.length() {
                        if let Some(key) = keys.get(j).as_string() {
                            key_names.push(key);
                        }
                    }
                    web_sys::console::log_1(&format!("Rust: Vertex object keys: {:?}", key_names).into());
                }

                // Extract position
                if let Ok(position_val) = js_sys::Reflect::get(&vertex_obj, &"position".into()) {
                    if i == 0 {
                        web_sys::console::log_1(&format!("Rust: Position value type: {:?}", position_val).into());
                    }
                    if let Ok(position_array) = position_val.dyn_into::<js_sys::Array>() {
                        if position_array.length() >= 2 {
                            if let (Some(x), Some(y)) = (
                                position_array.get(0).as_f64(),
                                position_array.get(1).as_f64()
                            ) {
                                // For pre-triangulated vertices, keep screen coordinates
                                // The triangulation was done in screen space and should stay that way
                                positions.push(Point { x, y });

                                // Extract other vertex properties
                                let color = if let Ok(color_val) = js_sys::Reflect::get(&vertex_obj, &"color".into()) {
                                    if let Ok(color_array) = color_val.dyn_into::<js_sys::Array>() {
                                        [
                                            color_array.get(0).as_f64().unwrap_or(1.0) as f32,
                                            color_array.get(1).as_f64().unwrap_or(1.0) as f32,
                                            color_array.get(2).as_f64().unwrap_or(1.0) as f32,
                                            color_array.get(3).as_f64().unwrap_or(1.0) as f32,
                                        ]
                                    } else {
                                        [1.0, 1.0, 1.0, 1.0]
                                    }
                                } else {
                                    [1.0, 1.0, 1.0, 1.0]
                                };

                                let uv = if let Ok(uv_val) = js_sys::Reflect::get(&vertex_obj, &"uv".into()) {
                                    if let Ok(uv_array) = uv_val.dyn_into::<js_sys::Array>() {
                                        [
                                            uv_array.get(0).as_f64().unwrap_or(0.0) as f32,
                                            uv_array.get(1).as_f64().unwrap_or(0.0) as f32,
                                        ]
                                    } else {
                                        [0.0, 0.0]
                                    }
                                } else {
                                    [0.0, 0.0]
                                };

                                let shape_type = js_sys::Reflect::get(&vertex_obj, &"shape_type".into())
                                    .ok()
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.0) as f32;

                                vertices.push(Vertex {
                                    position: [x as f32, y as f32],  // Keep screen coordinates
                                    color,
                                    uv,
                                    shape_type: 4.0, // Special shape type for pre-triangulated vertices
                                });
                            }
                        }
                    } else {
                        if i == 0 {
                            web_sys::console::log_1(&"Rust: Failed to convert position to array".into());
                        }
                    }
                } else {
                    if i == 0 {
                        web_sys::console::log_1(&"Rust: Failed to get position property".into());
                    }
                }
            } else {
                if i == 0 {
                    web_sys::console::log_1(&"Rust: Failed to convert to JS object".into());
                }
            }
        }

        if vertices.is_empty() || positions.is_empty() {
            web_sys::console::log_1(&"Rust: No vertices parsed, returning 0".into());
            return 0; // Invalid shape
        }

        web_sys::console::log_1(&format!("Rust: Successfully parsed {} vertices, {} positions", vertices.len(), positions.len()).into());

        // Calculate bounding box for position
        let min_x = positions.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let min_y = positions.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);

        let shape = Shape {
            id,
            position: Point { x: min_x, y: min_y },
            shape_type: ShapeType::DrawPreTriangulated {
                vertices,
                bounding_points: positions,
            },
            color: [1.0, 1.0, 1.0, 1.0], // White
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Update an existing draw shape with new points (for live drawing)
    #[wasm_bindgen]
    pub fn update_draw_shape(&mut self, shape_id: u32, vertices_js: &js_sys::Array) -> bool {
        let id = ShapeId(shape_id);

        if let Some(shape) = self.shapes.get_mut(&id) {
            // Check if this is a pre-triangulated shape
            if let ShapeType::DrawPreTriangulated { vertices: ref mut shape_vertices, bounding_points: ref mut bounding_points } = &mut shape.shape_type {
                // Convert the pre-triangulated vertices from JavaScript (same as create_smooth_draw_shape)
                let mut vertices = Vec::new();
                let mut positions = Vec::new();

                for i in 0..vertices_js.length() {
                    if let Ok(vertex_obj) = vertices_js.get(i).dyn_into::<js_sys::Object>() {
                        // Extract position array
                        if let Ok(position_val) = js_sys::Reflect::get(&vertex_obj, &"position".into()) {
                            if let Ok(position_array) = position_val.dyn_into::<js_sys::Array>() {
                                if position_array.length() >= 2 {
                                    if let (Some(x), Some(y)) = (
                                        position_array.get(0).as_f64(),
                                        position_array.get(1).as_f64()
                                    ) {
                                        positions.push(Point { x, y });

                                        // Extract other vertex properties
                                        let color = if let Ok(color_val) = js_sys::Reflect::get(&vertex_obj, &"color".into()) {
                                            if let Ok(color_array) = color_val.dyn_into::<js_sys::Array>() {
                                                [
                                                    color_array.get(0).as_f64().unwrap_or(1.0) as f32,
                                                    color_array.get(1).as_f64().unwrap_or(1.0) as f32,
                                                    color_array.get(2).as_f64().unwrap_or(1.0) as f32,
                                                    color_array.get(3).as_f64().unwrap_or(1.0) as f32,
                                                ]
                                            } else { [1.0, 1.0, 1.0, 1.0] }
                                        } else { [1.0, 1.0, 1.0, 1.0] };

                                        let uv = if let Ok(uv_val) = js_sys::Reflect::get(&vertex_obj, &"uv".into()) {
                                            if let Ok(uv_array) = uv_val.dyn_into::<js_sys::Array>() {
                                                [
                                                    uv_array.get(0).as_f64().unwrap_or(0.0) as f32,
                                                    uv_array.get(1).as_f64().unwrap_or(0.0) as f32,
                                                ]
                                            } else { [0.0, 0.0] }
                                        } else { [0.0, 0.0] };

                                        let shape_type = if let Ok(st_val) = js_sys::Reflect::get(&vertex_obj, &"shape_type".into()) {
                                            st_val.as_f64().unwrap_or(0.0) as f32
                                        } else { 0.0 };

                                        vertices.push(Vertex {
                                            position: [x as f32, y as f32],
                                            color,
                                            uv,
                                            shape_type,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }

                if !vertices.is_empty() {
                    // Update the shape's vertices and bounding points
                    *shape_vertices = vertices;
                    *bounding_points = positions;

                    // Update position to new bounding box
                    let min_x = bounding_points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
                    let min_y = bounding_points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
                    shape.position = Point { x: min_x, y: min_y };

                    return true;
                }
            } else if let ShapeType::Draw { points: ref mut shape_points, .. } = &mut shape.shape_type {
                // Handle regular draw shapes (legacy)
                let mut points = Vec::new();
                for i in 0..vertices_js.length() {
                    if let Ok(vertex_obj) = vertices_js.get(i).dyn_into::<js_sys::Object>() {
                        if let (Ok(x_val), Ok(y_val)) = (
                            js_sys::Reflect::get(&vertex_obj, &"x".into()),
                            js_sys::Reflect::get(&vertex_obj, &"y".into())
                        ) {
                            if let (Some(x), Some(y)) = (x_val.as_f64(), y_val.as_f64()) {
                                // Convert screen coordinates to world coordinates
                                let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
                                let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;
                                points.push(Point { x: world_x, y: world_y });
                            }
                        }
                    }
                }

                if !points.is_empty() {
                    *shape_points = points;

                    // Update position to new bounding box
                    let min_x = shape_points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
                    let min_y = shape_points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
                    shape.position = Point { x: min_x, y: min_y };

                    return true;
                }
            }
        }

        false
    }

    /// Check if undo is available
    #[wasm_bindgen]
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    /// Check if redo is available
    #[wasm_bindgen]
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    /// Undo the last operation
    #[wasm_bindgen]
    pub fn undo(&mut self) {
        if self.history.can_undo() {
            // Save current state to redo stack before undoing
            let current_state = CanvasState {
                shapes: self.shapes.clone(),
                selected_shapes: self.selected_shapes.clone(),
                next_id: self.next_id,
            };

            // Get the previous state and save current state to redo stack
            if let Some(previous_state) = self.history.undo_with_current_state(current_state) {
                self.restore_state(previous_state);
            }
        }
    }

    /// Redo the last undone operation
    #[wasm_bindgen]
    pub fn redo(&mut self) {
        if self.history.can_redo() {
            // Save current state to undo stack before redoing
            let current_state = CanvasState {
                shapes: self.shapes.clone(),
                selected_shapes: self.selected_shapes.clone(),
                next_id: self.next_id,
            };

            // Get the next state and save current state to undo stack
            if let Some(next_state) = self.history.redo_with_current_state(current_state) {
                self.restore_state(next_state);
            }
        }
    }

    /// Save current state for undo/redo (call before any operation)
    fn save_state(&mut self) {
        let state = CanvasState {
            shapes: self.shapes.clone(),
            selected_shapes: self.selected_shapes.clone(),
            next_id: self.next_id,
        };
        self.history.push_state(state);
    }

    /// Restore a previous state
    fn restore_state(&mut self, state: CanvasState) {
        self.shapes = state.shapes;
        self.selected_shapes = state.selected_shapes;
        self.next_id = state.next_id;
    }



    /// Get cursor type for resize handle at position (for cursor feedback)
    #[wasm_bindgen]
    pub fn get_resize_cursor(&self, x: f64, y: f64) -> String {
        if let Some((handle_type, _)) = self.hit_test_resize_handle(x, y) {
            match handle_type {
                ResizeHandle::TopLeft | ResizeHandle::BottomRight => "nw-resize".to_string(),
                ResizeHandle::TopRight | ResizeHandle::BottomLeft => "ne-resize".to_string(),
                ResizeHandle::Top | ResizeHandle::Bottom => "ns-resize".to_string(),
                ResizeHandle::Left | ResizeHandle::Right => "ew-resize".to_string(),
            }
        } else {
            "default".to_string()
        }
    }

    /// Get shapes within a selection rectangle
    fn get_shapes_in_rectangle(&self, start: Point, end: Point) -> Vec<ShapeId> {
        let min_x = start.x.min(end.x);
        let max_x = start.x.max(end.x);
        let min_y = start.y.min(end.y);
        let max_y = start.y.max(end.y);

        let selection_rect = BoundingBox::new(min_x, min_y, max_x, max_y);

        let mut selected_shapes = Vec::new();
        for (id, shape) in &self.shapes {
            let shape_bbox = shape.bounding_box();

            // Check if shape intersects with selection rectangle
            if shape_bbox.max_x >= selection_rect.min_x &&
               shape_bbox.min_x <= selection_rect.max_x &&
               shape_bbox.max_y >= selection_rect.min_y &&
               shape_bbox.min_y <= selection_rect.max_y {
                selected_shapes.push(*id);
            }
        }

        selected_shapes
    }

    /// Get widgets within a selection rectangle
    fn get_widgets_in_rectangle(&self, start: Point, end: Point) -> Vec<ShapeId> {
        let min_x = start.x.min(end.x);
        let max_x = start.x.max(end.x);
        let min_y = start.y.min(end.y);
        let max_y = start.y.max(end.y);

        let selection_rect = BoundingBox::new(min_x, min_y, max_x, max_y);

        let mut selected_widgets = Vec::new();
        for (id, shape) in &self.shapes {
            // Only include widgets
            if matches!(shape.shape_type, ShapeType::Widget { .. }) {
                let shape_bbox = shape.bounding_box();

                // Check if widget intersects with selection rectangle
                if shape_bbox.max_x >= selection_rect.min_x &&
                   shape_bbox.min_x <= selection_rect.max_x &&
                   shape_bbox.max_y >= selection_rect.min_y &&
                   shape_bbox.min_y <= selection_rect.max_y {
                    selected_widgets.push(*id);
                }
            }
        }

        selected_widgets
    }

    /// Get resize handles for selected shapes or widgets
    fn get_resize_handles(&self) -> Vec<ResizeHandleInfo> {
        let mut handles = Vec::new();

        // Determine which shape to show resize handles for
        let target_shape_id = if self.selected_shapes.len() == 1 {
            // Exactly one shape/widget is selected (could be regular shape or widget)
            Some(self.selected_shapes[0])
        } else if let Some(widget_id) = self.selected_widget {
            // Single widget is selected via old selection system
            Some(widget_id)
        } else {
            None
        };

        if let Some(shape_id) = target_shape_id {
            if let Some(shape) = self.shapes.get(&shape_id) {
                let bbox = shape.bounding_box();
                let handle_size = 8.0; // Handle size in pixels

                // Corner handles
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::TopLeft,
                    position: Point { x: bbox.min_x, y: bbox.min_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::TopRight,
                    position: Point { x: bbox.max_x, y: bbox.min_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::BottomLeft,
                    position: Point { x: bbox.min_x, y: bbox.max_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::BottomRight,
                    position: Point { x: bbox.max_x, y: bbox.max_y },
                    size: handle_size,
                });

                // Edge handles (middle of each side)
                let mid_x = (bbox.min_x + bbox.max_x) / 2.0;
                let mid_y = (bbox.min_y + bbox.max_y) / 2.0;

                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::Top,
                    position: Point { x: mid_x, y: bbox.min_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::Bottom,
                    position: Point { x: mid_x, y: bbox.max_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::Left,
                    position: Point { x: bbox.min_x, y: mid_y },
                    size: handle_size,
                });
                handles.push(ResizeHandleInfo {
                    handle_type: ResizeHandle::Right,
                    position: Point { x: bbox.max_x, y: mid_y },
                    size: handle_size,
                });
            }
        }

        handles
    }

    /// Check if a point hits a resize handle
    fn hit_test_resize_handle(&self, x: f64, y: f64) -> Option<(ResizeHandle, ShapeId)> {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        let handles = self.get_resize_handles();

        for handle in handles {
            let half_size = handle.size / 2.0;
            let handle_bbox = BoundingBox::new(
                handle.position.x - half_size,
                handle.position.y - half_size,
                handle.position.x + half_size,
                handle.position.y + half_size,
            );

            if handle_bbox.contains_point(world_x, world_y) {
                // Return the handle type and the shape being resized
                // Check both regular shapes and widgets
                if let Some(&shape_id) = self.selected_shapes.first() {
                    return Some((handle.handle_type, shape_id));
                } else if let Some(widget_id) = self.selected_widget {
                    return Some((handle.handle_type, widget_id));
                }
            }
        }

        None
    }

    /// Calculate resize parameters without mutating the shape
    fn calculate_resize(&self, shape: &Shape, handle_type: ResizeHandle, mouse_x: f64, mouse_y: f64, start_bounds: BoundingBox) -> ResizeData {
        let mut resize_data = ResizeData {
            new_position: None,
            new_width: None,
            new_height: None,
        };
        // Set minimum size based on shape type
        let (min_width, min_height) = match &shape.shape_type {
            ShapeType::Widget { .. } => (200.0, 150.0), // Larger minimum for widgets to show content
            _ => (10.0, 10.0), // Small minimum for basic shapes
        };

        match &shape.shape_type {
            ShapeType::Rectangle { .. } | ShapeType::Ellipse { .. } | ShapeType::Image { .. } | ShapeType::Widget { .. } => {
                match handle_type {
                    ResizeHandle::TopLeft => {
                        let new_width = start_bounds.max_x - mouse_x;
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_width > min_width && new_height > min_height {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: mouse_x, y: mouse_y });
                        }
                    }
                    ResizeHandle::TopRight => {
                        let new_width = mouse_x - start_bounds.min_x;
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_width > min_width && new_height > min_height {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: shape.position.x, y: mouse_y });
                        }
                    }
                    ResizeHandle::BottomLeft => {
                        let new_width = start_bounds.max_x - mouse_x;
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_width > min_width && new_height > min_height {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: mouse_x, y: shape.position.y });
                        }
                    }
                    ResizeHandle::BottomRight => {
                        let new_width = mouse_x - start_bounds.min_x;
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_width > min_width && new_height > min_height {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                        }
                    }
                    ResizeHandle::Top => {
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_height > min_height {
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: shape.position.x, y: mouse_y });
                        }
                    }
                    ResizeHandle::Bottom => {
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_height > min_height {
                            resize_data.new_height = Some(new_height);
                        }
                    }
                    ResizeHandle::Left => {
                        let new_width = start_bounds.max_x - mouse_x;
                        if new_width > min_width {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_position = Some(Point { x: mouse_x, y: shape.position.y });
                        }
                    }
                    ResizeHandle::Right => {
                        let new_width = mouse_x - start_bounds.min_x;
                        if new_width > min_width {
                            resize_data.new_width = Some(new_width);
                        }
                    }
                }
            }
            ShapeType::Draw { .. } => {
                // Draw shapes don't support traditional resizing
                // Could implement scaling in the future
            }
            ShapeType::DrawPreTriangulated { .. } => {
                // Pre-triangulated draw shapes don't support traditional resizing
            }
        }

        resize_data
    }



    /// Handle pointer down event
    #[wasm_bindgen]
    pub fn handle_pointer_down(&mut self, x: f64, y: f64, ctrl_key: bool) {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        // First check if we're clicking on a resize handle
        if let Some((handle_type, shape_id)) = self.hit_test_resize_handle(x, y) {
            // Start resizing
            self.is_resizing = true;
            self.resize_handle = Some(handle_type);
            self.resize_shape_id = Some(shape_id);

            // Store the original bounds for resize calculations
            if let Some(shape) = self.shapes.get(&shape_id) {
                self.resize_start_bounds = Some(shape.bounding_box());
            }
            return;
        }

        // Find shape under cursor (excluding widgets - they have their own interaction system)
        let mut hit_shape = None;
        for (id, shape) in &self.shapes {
            // Skip widgets - they should never be selected via canvas clicks
            if matches!(shape.shape_type, ShapeType::Widget { .. }) {
                continue;
            }

            if shape.bounding_box().contains_point(world_x, world_y) {
                hit_shape = Some(*id);
                break;
            }
        }

        if let Some(shape_id) = hit_shape {
            // Clear widget selection when selecting regular shapes
            self.selected_widget = None;

            if ctrl_key {
                // Multi-select mode: toggle selection of the clicked shape
                if self.selected_shapes.contains(&shape_id) {
                    // Remove from selection
                    self.selected_shapes.retain(|&id| id != shape_id);
                } else {
                    // Add to selection
                    self.selected_shapes.push(shape_id);
                }
            } else {
                // Single-select mode: but preserve multi-selection if clicking on an already selected shape
                if self.selected_shapes.contains(&shape_id) && self.selected_shapes.len() > 1 {
                    // Don't change selection - keep all selected shapes for dragging
                } else {
                    // Select only this shape
                    self.selected_shapes.clear();
                    self.selected_shapes.push(shape_id);
                }
            }

            // Start dragging only if we have selected shapes
            if !self.selected_shapes.is_empty() {
                // Save state before starting drag
                self.save_state();

                self.is_dragging = true;
                self.drag_start = Some(Point { x: world_x, y: world_y });

                // Calculate drag offsets for all selected shapes
                self.drag_offset.clear();
                for &selected_id in &self.selected_shapes {
                    if let Some(shape) = self.shapes.get(&selected_id) {
                        self.drag_offset.insert(selected_id, Point {
                            x: shape.position.x - world_x,
                            y: shape.position.y - world_y,
                        });
                    }
                }
            }
        } else {
            // Start selection rectangle drag when clicking on empty space
            if !ctrl_key {
                self.selected_shapes.clear();
                // Also clear widget selection when clicking on empty space
                self.selected_widget = None;
            }

            // Start selection rectangle dragging
            self.is_selection_dragging = true;
            self.selection_start = Some(Point { x: world_x, y: world_y });
            self.selection_current = Some(Point { x: world_x, y: world_y });
        }
    }

    /// Handle pointer move event
    #[wasm_bindgen]
    pub fn handle_pointer_move(&mut self, x: f64, y: f64) {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        if self.is_resizing {
            // Handle resizing
            if let (Some(handle_type), Some(shape_id), Some(start_bounds)) =
                (self.resize_handle, self.resize_shape_id, self.resize_start_bounds) {

                // Calculate new dimensions first, then apply them
                if let Some(shape) = self.shapes.get(&shape_id) {
                    let resize_data = self.calculate_resize(shape, handle_type, world_x, world_y, start_bounds);

                    // Now apply the resize
                    if let Some(shape) = self.shapes.get_mut(&shape_id) {
                        apply_resize(shape, resize_data);
                    }
                }
            }
        } else if self.is_selection_dragging {
            // Handle selection rectangle dragging
            self.selection_current = Some(Point { x: world_x, y: world_y });

            // Update selection based on current rectangle
            if let (Some(start), Some(current)) = (self.selection_start, self.selection_current) {
                let shapes_in_rect = self.get_shapes_in_rectangle(start, current);
                let widgets_in_rect = self.get_widgets_in_rectangle(start, current);

                // Combine shapes and widgets in selection
                let mut all_selected = shapes_in_rect;
                all_selected.extend(widgets_in_rect);

                self.selected_shapes = all_selected;

                // Clear single widget selection since we're now using multi-selection
                self.selected_widget = None;
            }
        } else if self.is_dragging {
            // Handle dragging
            if let Some(widget_id) = self.dragged_widget {
                // Dragging a widget - update only the widget position
                if let (Some(shape), Some(offset)) = (self.shapes.get_mut(&widget_id), self.drag_offset.get(&widget_id)) {
                    shape.position.x = world_x + offset.x;
                    shape.position.y = world_y + offset.y;
                }
            } else {
                // Dragging regular shapes - update positions of all selected shapes
                for &selected_id in &self.selected_shapes {
                    if let (Some(shape), Some(offset)) = (self.shapes.get_mut(&selected_id), self.drag_offset.get(&selected_id)) {
                        shape.position.x = world_x + offset.x;
                        shape.position.y = world_y + offset.y;
                    }
                }
            }
        }
    }

    /// Handle pointer up event
    #[wasm_bindgen]
    pub fn handle_pointer_up(&mut self, _x: f64, _y: f64) {
        self.is_dragging = false;
        self.drag_start = None;
        self.drag_offset.clear();
        self.dragged_widget = None;

        // End resizing
        self.is_resizing = false;
        self.resize_handle = None;
        self.resize_shape_id = None;
        self.resize_start_bounds = None;

        // End selection rectangle dragging
        self.is_selection_dragging = false;
        self.selection_start = None;
        self.selection_current = None;
    }

    /// Select a widget for resize handles (without starting drag)
    #[wasm_bindgen]
    pub fn select_widget(&mut self, widget_id: u32) {
        let shape_id = ShapeId(widget_id);

        // Check if the widget exists
        if !self.shapes.contains_key(&shape_id) {
            return;
        }

        // Clear regular shape selection and set widget selection
        self.selected_shapes.clear();
        self.selected_widget = Some(shape_id);
    }

    /// Add a widget to the current multi-selection
    #[wasm_bindgen]
    pub fn add_widget_to_selection(&mut self, widget_id: u32) {
        let shape_id = ShapeId(widget_id);

        // Check if the widget exists
        if !self.shapes.contains_key(&shape_id) {
            return;
        }

        // Add to selected_shapes if not already there
        if !self.selected_shapes.contains(&shape_id) {
            self.selected_shapes.push(shape_id);
        }

        // Clear single widget selection since we're using multi-selection
        self.selected_widget = None;
    }

    /// Remove a widget from the current multi-selection
    #[wasm_bindgen]
    pub fn remove_widget_from_selection(&mut self, widget_id: u32) {
        let shape_id = ShapeId(widget_id);
        self.selected_shapes.retain(|&id| id != shape_id);
    }

    /// Get resize handles for overlay rendering (returns screen coordinates)
    #[wasm_bindgen]
    pub fn get_resize_handles_for_overlay(&self) -> js_sys::Array {
        let handles = self.get_resize_handles();
        let js_array = js_sys::Array::new();

        for handle in handles {
            let js_handle = js_sys::Object::new();

            // Convert handle type to string
            let handle_type_str = match handle.handle_type {
                ResizeHandle::TopLeft => "nw",
                ResizeHandle::TopRight => "ne",
                ResizeHandle::BottomLeft => "sw",
                ResizeHandle::BottomRight => "se",
                ResizeHandle::Top => "n",
                ResizeHandle::Bottom => "s",
                ResizeHandle::Left => "w",
                ResizeHandle::Right => "e",
            };

            // Convert world coordinates to screen coordinates
            let screen_x = (handle.position.x - self.camera_translation[0] as f64) * self.camera_scale as f64;
            let screen_y = (handle.position.y - self.camera_translation[1] as f64) * self.camera_scale as f64;

            js_sys::Reflect::set(&js_handle, &"type".into(), &handle_type_str.into()).unwrap();
            js_sys::Reflect::set(&js_handle, &"x".into(), &screen_x.into()).unwrap();
            js_sys::Reflect::set(&js_handle, &"y".into(), &screen_y.into()).unwrap();
            js_sys::Reflect::set(&js_handle, &"size".into(), &handle.size.into()).unwrap();

            js_array.push(&js_handle);
        }

        js_array
    }

    /// Start dragging a specific widget from its title bar
    #[wasm_bindgen]
    pub fn start_widget_drag(&mut self, widget_id: u32, x: f64, y: f64) {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        let shape_id = ShapeId(widget_id);

        // Check if the widget exists
        if !self.shapes.contains_key(&shape_id) {
            return;
        }

        // Save state before starting drag
        self.save_state();

        // Don't add widgets to selected_shapes - they should have no visual selection outline
        self.selected_shapes.clear();

        // Select this widget for resize handles
        self.selected_widget = Some(shape_id);

        // Start dragging this specific widget
        self.is_dragging = true;
        self.dragged_widget = Some(shape_id);
        self.drag_start = Some(Point { x: world_x, y: world_y });

        // Calculate drag offset for this widget
        self.drag_offset.clear();
        if let Some(shape) = self.shapes.get(&shape_id) {
            self.drag_offset.insert(shape_id, Point {
                x: shape.position.x - world_x,
                y: shape.position.y - world_y,
            });
        }
    }

    /// Handle wheel event for vertical scrolling (like tldraw)
    #[wasm_bindgen]
    pub fn handle_wheel(&mut self, _dx: f64, dy: f64) {
        // Vertical scrolling like tldraw - wheel moves camera up/down
        // Use a much smaller scroll speed - typical wheel delta is around 100, so 0.3 gives ~30px movement
        let scroll_speed = 0.3;
        self.camera_translation[1] += (dy * scroll_speed) as f32;

        if let Some(gpu) = &mut self.gpu {
            gpu.update_camera(self.camera_translation, self.camera_scale);
        }
    }

    /// Handle wheel event with modifier keys for zooming at cursor position
    #[wasm_bindgen]
    pub fn handle_wheel_zoom(&mut self, _dx: f64, dy: f64, cursor_x: f64, cursor_y: f64) {
        // Zoom implementation (for Ctrl+wheel) - zoom to cursor position like tldraw
        let zoom_factor = if dy > 0.0 { 0.9 } else { 1.1 };
        let old_scale = self.camera_scale;
        let new_scale = (old_scale * zoom_factor).clamp(0.1, 10.0);

        // Only proceed if scale actually changed (within limits)
        if (new_scale - old_scale).abs() > f32::EPSILON {
            // Convert cursor position to world coordinates before zoom
            let world_x_before = (cursor_x / old_scale as f64) + self.camera_translation[0] as f64;
            let world_y_before = (cursor_y / old_scale as f64) + self.camera_translation[1] as f64;

            // Update scale
            self.camera_scale = new_scale;

            // Convert the same world point back to screen coordinates with new scale
            let world_x_after = (cursor_x / new_scale as f64) + self.camera_translation[0] as f64;
            let world_y_after = (cursor_y / new_scale as f64) + self.camera_translation[1] as f64;

            // Adjust camera translation to keep the cursor point fixed
            self.camera_translation[0] += (world_x_before - world_x_after) as f32;
            self.camera_translation[1] += (world_y_before - world_y_after) as f32;

            if let Some(gpu) = &mut self.gpu {
                gpu.update_camera(self.camera_translation, self.camera_scale);
            }
        }
    }

    /// Pan the camera (for middle mouse drag)
    #[wasm_bindgen]
    pub fn pan_camera(&mut self, dx: f64, dy: f64) {
        // Apply movement directly - dx/dy are already in the right direction from mouse movement
        // Invert the movement so dragging right moves the view right (like tldraw)
        self.camera_translation[0] -= dx as f32;
        self.camera_translation[1] -= dy as f32;

        if let Some(gpu) = &mut self.gpu {
            gpu.update_camera(self.camera_translation, self.camera_scale);
        }
    }

    /// Render a frame
    #[wasm_bindgen]
    pub fn render_frame(&mut self) {
        // Clean up any widgets that might have accidentally gotten into selected_shapes
        self.clean_widget_selection();

        // Split the borrow to avoid borrow checker issues
        let (vertices, texture_data_urls) = self.tessellate_shapes_with_textures();
        if let Some(gpu) = &mut self.gpu {
            gpu.render_shapes_with_textures(&vertices, &texture_data_urls, true);
        }
    }

    /// Remove any invalid shape IDs from the selected_shapes list
    fn clean_widget_selection(&mut self) {
        self.selected_shapes.retain(|&shape_id| {
            // Only remove invalid shape IDs, but allow widgets to be selected
            self.shapes.contains_key(&shape_id)
        });
    }



    /// Tessellate all shapes into vertices for GPU rendering, with texture data URLs
    fn tessellate_shapes_with_textures(&self) -> (Vec<Vertex>, Vec<Option<String>>) {
        let mut vertices = Vec::new();
        let mut texture_data_urls = Vec::new();

        // Clean up any widgets that might have accidentally gotten into selected_shapes
        // This is a safety measure to ensure widgets never show selection outlines

        // Render shapes first as outlines (always in their original colors)
        for shape in self.shapes.values() {
            match &shape.shape_type {
                ShapeType::Rectangle { width, height } => {
                    self.tessellate_rectangle_outline(&mut vertices, shape.position, *width, *height, shape.color, 2.0);
                    // Add None for non-image shapes (they don't need textures)
                    texture_data_urls.push(None);
                }
                ShapeType::Ellipse { width, height } => {
                    self.tessellate_ellipse_outline(&mut vertices, shape.position, *width, *height, shape.color, 2.0);
                    // Add None for non-image shapes (they don't need textures)
                    texture_data_urls.push(None);
                }
                ShapeType::Image { width, height, data_url, .. } => {
                    // Render images as textured quads
                    self.tessellate_image_quad(&mut vertices, shape.position, *width, *height);
                    // Add the texture data URL for this image
                    texture_data_urls.push(Some(data_url.clone()));
                }
                ShapeType::Widget { .. } => {
                    // Don't render any outline for widgets - show raw widget form only
                    // Widgets are rendered by the overlay system, not the canvas
                }
                ShapeType::Draw { points, stroke_width } => {
                    // Render draw path as stroke line
                    web_sys::console::log_1(&format!("🎨 Rendering draw shape with {} points, stroke_width: {}", points.len(), stroke_width).into());
                    self.tessellate_draw_path(&mut vertices, points, shape.color, *stroke_width);
                    // Add None for draw shapes (they don't need textures)
                    texture_data_urls.push(None);
                }
                ShapeType::DrawPreTriangulated { vertices: shape_vertices, .. } => {
                    // Use the pre-triangulated vertices directly from JavaScript
                    web_sys::console::log_1(&format!("Rust: Rendering {} pre-triangulated vertices", shape_vertices.len()).into());
                    if !shape_vertices.is_empty() {
                        web_sys::console::log_1(&format!("Rust: First vertex position: [{}, {}]",
                            shape_vertices[0].position[0], shape_vertices[0].position[1]).into());
                        web_sys::console::log_1(&format!("Rust: Last vertex position: [{}, {}]",
                            shape_vertices[shape_vertices.len()-1].position[0],
                            shape_vertices[shape_vertices.len()-1].position[1]).into());
                    }
                    vertices.extend_from_slice(shape_vertices);
                    // Add None for draw shapes (they don't need textures)
                    texture_data_urls.push(None);
                }
            }
        }

        // Render selection outlines for selected shapes (but never for widgets)
        for shape in self.shapes.values() {
            if self.selected_shapes.contains(&shape.id) {
                // Double-check: never render selection outlines for widgets
                if !matches!(shape.shape_type, ShapeType::Widget { .. }) {
                    self.tessellate_selection_outline(&mut vertices, shape);
                    // Selection outlines don't need textures
                    texture_data_urls.push(None);
                }
            }
        }

        // Selection rectangle is now rendered as HTML overlay for proper z-index layering
        // This ensures it appears on top of all widgets and shapes

        // No need for preview rendering - we modify the actual shape in real-time

        // Skip rendering resize handles on canvas - they are now rendered as HTML overlays
        // This prevents z-index issues where handles appear behind widgets

        (vertices, texture_data_urls)
    }

    // Note: These filled tessellation functions are no longer used since we switched to outline-only rendering
    // Keeping them commented for potential future use

    // fn tessellate_rectangle(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4]) {
    //     let x = pos.x as f32;
    //     let y = pos.y as f32;
    //     let w = width as f32;
    //     let h = height as f32;

    //     // Two triangles for a rectangle
    //     vertices.extend_from_slice(&[
    //         // Triangle 1
    //         Vertex { position: [x, y], color, uv: [0.0, 0.0], shape_type: 0.0 },
    //         Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 0.0 },
    //         Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 0.0 },
    //         // Triangle 2
    //         Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 0.0 },
    //         Vertex { position: [x + w, y + h], color, uv: [1.0, 1.0], shape_type: 0.0 },
    //         Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 0.0 },
    //     ]);
    // }

    // fn tessellate_ellipse(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4]) {
    //     let x = pos.x as f32;
    //     let y = pos.y as f32;
    //     let w = width as f32;
    //     let h = height as f32;

    //     // Create a simple quad and let the fragment shader handle the circular shape
    //     // This avoids the "sun" effect from triangle tessellation
    //     vertices.extend_from_slice(&[
    //         // Triangle 1
    //         Vertex { position: [x, y], color, uv: [0.0, 0.0], shape_type: 1.0 },
    //         Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 1.0 },
    //         Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 1.0 },
    //         // Triangle 2
    //         Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 1.0 },
    //         Vertex { position: [x + w, y + h], color, uv: [1.0, 1.0], shape_type: 1.0 },
    //         Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 1.0 },
    //     ]);
    // }





    fn tessellate_selection_outline(&self, vertices: &mut Vec<Vertex>, shape: &Shape) {
        let outline_color = [0.5, 0.7, 1.0, 0.9]; // Subtle blue outline
        let outline_width = 1.5; // Thinner outline

        match &shape.shape_type {
            ShapeType::Rectangle { width, height } => {
                self.tessellate_rectangle_outline(&mut *vertices, shape.position, *width, *height, outline_color, outline_width);
            }
            ShapeType::Ellipse { width, height } => {
                self.tessellate_ellipse_outline(&mut *vertices, shape.position, *width, *height, outline_color, outline_width);
            }
            ShapeType::Image { width, height, .. } => {
                self.tessellate_rectangle_outline(&mut *vertices, shape.position, *width, *height, outline_color, outline_width);
            }
            ShapeType::Widget { .. } => {
                // Don't render selection outline for widgets - keep them completely clean
            }
            ShapeType::Draw { points, .. } => {
                // Render selection outline for draw paths using the bounding box
                let bbox = self.get_draw_bounding_box(points);
                self.tessellate_rectangle_outline(&mut *vertices,
                    Point { x: bbox.min_x, y: bbox.min_y },
                    bbox.max_x - bbox.min_x,
                    bbox.max_y - bbox.min_y,
                    outline_color, outline_width);
            }
            ShapeType::DrawPreTriangulated { bounding_points, .. } => {
                // Render selection outline for pre-triangulated draw paths using the bounding box
                let bbox = self.get_draw_bounding_box(bounding_points);
                self.tessellate_rectangle_outline(&mut *vertices,
                    Point { x: bbox.min_x, y: bbox.min_y },
                    bbox.max_x - bbox.min_x,
                    bbox.max_y - bbox.min_y,
                    outline_color, outline_width);
            }
        }
    }

    fn get_draw_bounding_box(&self, points: &[Point]) -> BoundingBox {
        if points.is_empty() {
            return BoundingBox::new(0.0, 0.0, 0.0, 0.0);
        }

        let mut min_x = points[0].x;
        let mut min_y = points[0].y;
        let mut max_x = points[0].x;
        let mut max_y = points[0].y;

        for point in points {
            min_x = min_x.min(point.x);
            min_y = min_y.min(point.y);
            max_x = max_x.max(point.x);
            max_y = max_y.max(point.y);
        }

        BoundingBox::new(min_x, min_y, max_x, max_y)
    }

    fn tessellate_smooth_polygon(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4]) {
        if points.len() < 4 {
            return;
        }

        // The debug output shows that perfect-freehand creates a proper stroke outline
        // We need to tessellate this outline as a closed polygon, not as curves
        // The issue was that I was trying to create curves when the outline IS the shape

        // Use proper polygon tessellation - the outline points form the boundary
        self.tessellate_polygon_outline(vertices, points, color);
    }

    fn create_smooth_path_from_outline(&self, points: &[Point]) -> Vec<Point> {
        if points.len() < 4 {
            return points.to_vec();
        }

        let mut path_points = Vec::new();

        // Start with the first point
        path_points.push(points[0]);

        // Create smooth curves using the same algorithm as getSvgPathFromStroke
        let mut a = points[0];
        let mut b = points[1];
        let c = points[2];

        // Add the first quadratic curve control point
        path_points.push(b);
        path_points.push(Point {
            x: (b.x + c.x) / 2.0,
            y: (b.y + c.y) / 2.0,
        });

        // Add smooth curve points for the rest
        for i in 2..(points.len() - 1) {
            a = points[i];
            b = points[i + 1];

            // Add the averaged point (this creates the smooth curves)
            path_points.push(Point {
                x: (a.x + b.x) / 2.0,
                y: (a.y + b.y) / 2.0,
            });
        }

        // Close the path
        if points.len() > 3 {
            path_points.push(points[0]);
        }

        path_points
    }

    fn tessellate_smooth_path(&self, vertices: &mut Vec<Vertex>, path_points: &[Point], color: [f32; 4]) {
        if path_points.len() < 3 {
            return;
        }

        // Use fan triangulation from centroid for the smooth path
        let mut centroid = Point { x: 0.0, y: 0.0 };
        for point in path_points {
            centroid.x += point.x;
            centroid.y += point.y;
        }
        centroid.x /= path_points.len() as f64;
        centroid.y /= path_points.len() as f64;

        // Create triangles from centroid to each edge
        for i in 0..path_points.len() {
            let p1 = path_points[i];
            let p2 = path_points[(i + 1) % path_points.len()];

            vertices.extend_from_slice(&[
                Vertex {
                    position: [centroid.x as f32, centroid.y as f32],
                    color,
                    uv: [0.5, 0.5],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p1.x as f32, p1.y as f32],
                    color,
                    uv: [0.0, 0.0],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p2.x as f32, p2.y as f32],
                    color,
                    uv: [1.0, 0.0],
                    shape_type: 0.0
                },
            ]);
        }
    }

    fn tessellate_polygon_outline(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4]) {
        if points.len() < 3 {
            return;
        }

        // Perfect-freehand creates stroke outlines that are closed polygons
        // Instead of complex triangulation, let's use the same approach as the JavaScript triangulation
        // which uses simple fan triangulation from the first point

        // This matches the getTrianglesFromStroke function in perfect-freehand.ts
        let center = points[0];

        for i in 1..points.len() - 1 {
            let p1 = points[i];
            let p2 = points[i + 1];

            // Triangle: center -> p1 -> p2 (same as JavaScript implementation)
            vertices.extend_from_slice(&[
                Vertex {
                    position: [center.x as f32, center.y as f32],
                    color,
                    uv: [0.5, 0.5],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p1.x as f32, p1.y as f32],
                    color,
                    uv: [0.0, 0.0],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p2.x as f32, p2.y as f32],
                    color,
                    uv: [1.0, 0.0],
                    shape_type: 0.0
                },
            ]);
        }
    }

    fn ear_clip_triangulation(&self, points: &[Point]) -> Vec<[Point; 3]> {
        if points.len() < 3 {
            return Vec::new();
        }

        // For stroke outlines from perfect-freehand, we should use a more robust approach
        // Instead of complex ear clipping, let's use a simpler but more reliable method

        let mut triangles = Vec::new();

        // Use a modified approach that works better for stroke outlines
        // Perfect-freehand creates stroke outlines that are essentially "ribbons"
        // We can triangulate them more reliably using a different strategy

        if points.len() == 3 {
            triangles.push([points[0], points[1], points[2]]);
            return triangles;
        }

        // For stroke polygons, try a more robust triangulation
        // Use a combination of ear clipping and constrained triangulation

        let mut remaining_indices: Vec<usize> = (0..points.len()).collect();
        let mut iteration_count = 0;
        let max_iterations = points.len() * 2; // Prevent infinite loops

        while remaining_indices.len() > 3 && iteration_count < max_iterations {
            let mut ear_found = false;
            iteration_count += 1;

            for i in 0..remaining_indices.len() {
                let prev_idx = remaining_indices[(i + remaining_indices.len() - 1) % remaining_indices.len()];
                let curr_idx = remaining_indices[i];
                let next_idx = remaining_indices[(i + 1) % remaining_indices.len()];

                let prev = points[prev_idx];
                let curr = points[curr_idx];
                let next = points[next_idx];

                // Check if this forms a valid ear
                if self.is_ear_robust(&points, &remaining_indices, i) {
                    triangles.push([prev, curr, next]);
                    remaining_indices.remove(i);
                    ear_found = true;
                    break;
                }
            }

            if !ear_found {
                // If no ear found, try a different approach
                // Use a simple strip triangulation for stroke-like polygons
                break;
            }
        }

        // Handle remaining points
        if remaining_indices.len() == 3 {
            let p0 = points[remaining_indices[0]];
            let p1 = points[remaining_indices[1]];
            let p2 = points[remaining_indices[2]];
            triangles.push([p0, p1, p2]);
        } else if remaining_indices.len() > 3 {
            // Fallback: use a simple fan from the first remaining point
            let center_idx = remaining_indices[0];
            let center = points[center_idx];

            for i in 1..remaining_indices.len() - 1 {
                let p1 = points[remaining_indices[i]];
                let p2 = points[remaining_indices[i + 1]];
                triangles.push([center, p1, p2]);
            }
        }

        triangles
    }

    fn is_ear_robust(&self, points: &[Point], remaining_indices: &[usize], index: usize) -> bool {
        let n = remaining_indices.len();
        if n < 3 {
            return false;
        }

        let prev_idx = remaining_indices[(index + n - 1) % n];
        let curr_idx = remaining_indices[index];
        let next_idx = remaining_indices[(index + 1) % n];

        let prev = points[prev_idx];
        let curr = points[curr_idx];
        let next = points[next_idx];

        // Check if the angle is convex (cross product test)
        let cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
        if cross <= 0.0 {
            return false; // Not convex
        }

        // Check if any other remaining point is inside this triangle
        for &other_idx in remaining_indices {
            if other_idx == prev_idx || other_idx == curr_idx || other_idx == next_idx {
                continue;
            }

            if self.point_in_triangle(points[other_idx], prev, curr, next) {
                return false;
            }
        }

        true
    }

    fn is_ear(&self, points: &[Point], index: usize) -> bool {
        let n = points.len();
        let prev = points[(index + n - 1) % n];
        let curr = points[index];
        let next = points[(index + 1) % n];

        // Check if the angle is convex (cross product test)
        let cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
        if cross <= 0.0 {
            return false; // Not convex
        }

        // Check if any other point is inside this triangle
        for i in 0..n {
            if i == index || i == (index + n - 1) % n || i == (index + 1) % n {
                continue;
            }

            if self.point_in_triangle(points[i], prev, curr, next) {
                return false;
            }
        }

        true
    }

    fn point_in_triangle(&self, p: Point, a: Point, b: Point, c: Point) -> bool {
        let denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if denom.abs() < 1e-10 {
            return false;
        }

        let alpha = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
        let beta = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
        let gamma = 1.0 - alpha - beta;

        alpha > 0.0 && beta > 0.0 && gamma > 0.0
    }

    fn triangulate_polygon(&self, points: &[Point]) -> Vec<[Point; 3]> {
        let mut triangles = Vec::new();

        if points.len() < 3 {
            return triangles;
        }

        // For now, use a simple fan triangulation from the centroid
        // This should work better than fan from first vertex
        let mut centroid = Point { x: 0.0, y: 0.0 };
        for point in points {
            centroid.x += point.x;
            centroid.y += point.y;
        }
        centroid.x /= points.len() as f64;
        centroid.y /= points.len() as f64;

        // Create triangles from centroid to each edge
        for i in 0..points.len() {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.len()];
            triangles.push([centroid, p1, p2]);
        }

        triangles
    }

    fn tessellate_consistent_line(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4], stroke_width: f64) {
        if points.len() < 2 {
            return;
        }

        // Create consistent-width lines like tldraw's draw tool
        let half_width = (stroke_width.max(2.0) / 2.0) as f32; // Minimum 1px radius

        // Create line segments between consecutive points with proper joins
        for i in 0..points.len() - 1 {
            let p1 = points[i];
            let p2 = points[i + 1];

            // Calculate direction vector
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let length = (dx * dx + dy * dy).sqrt();

            if length > 0.001 { // Avoid division by zero
                // Normalize direction
                let dir_x = dx / length;
                let dir_y = dy / length;

                // Calculate perpendicular (normal) vector
                let nx = -dir_y as f32 * half_width;
                let ny = dir_x as f32 * half_width;

                let x1 = p1.x as f32;
                let y1 = p1.y as f32;
                let x2 = p2.x as f32;
                let y2 = p2.y as f32;

                // Create quad for this line segment
                // First triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 + nx, y1 + ny], color, uv: [0.0, 0.0], shape_type: 0.0 },
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Second triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 - nx, y2 - ny], color, uv: [1.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);
            }
        }

        // Add rounded caps at start and end for smoother appearance
        if points.len() >= 2 {
            self.tessellate_line_end_cap(vertices, points[0], color, half_width);
            self.tessellate_line_end_cap(vertices, points[points.len() - 1], color, half_width);
        }
    }

    fn tessellate_line_end_cap(&self, vertices: &mut Vec<Vertex>, center: Point, color: [f32; 4], radius: f32) {
        let cx = center.x as f32;
        let cy = center.y as f32;

        // Create a simple rounded cap using a few triangles
        let segments = 8; // Number of segments for the cap
        let angle_step = 2.0 * std::f32::consts::PI / segments as f32;

        for i in 0..segments {
            let angle1 = i as f32 * angle_step;
            let angle2 = (i + 1) as f32 * angle_step;

            let x1 = cx + radius * angle1.cos();
            let y1 = cy + radius * angle1.sin();
            let x2 = cx + radius * angle2.cos();
            let y2 = cy + radius * angle2.sin();

            // Triangle for cap segment
            vertices.extend_from_slice(&[
                Vertex { position: [cx, cy], color, uv: [0.5, 0.5], shape_type: 0.0 },
                Vertex { position: [x1, y1], color, uv: [0.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2, y2], color, uv: [1.0, 0.0], shape_type: 0.0 },
            ]);
        }
    }

    fn tessellate_perfect_freehand_polygon(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4]) {
        if points.len() < 3 {
            return;
        }

        // Perfect-freehand gives us outline points that form a closed polygon
        // We need to tessellate this polygon properly

        // Use ear clipping algorithm for proper polygon tessellation
        // For now, use a simple approach that works well for convex-ish polygons

        // Find a good center point for fan triangulation
        // Use the centroid of the polygon
        let mut centroid_x = 0.0;
        let mut centroid_y = 0.0;
        for point in points {
            centroid_x += point.x;
            centroid_y += point.y;
        }
        centroid_x /= points.len() as f64;
        centroid_y /= points.len() as f64;

        // Create triangles from centroid to each edge of the polygon
        for i in 0..points.len() {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.len()];

            // Create triangle: centroid -> p1 -> p2
            vertices.extend_from_slice(&[
                Vertex {
                    position: [centroid_x as f32, centroid_y as f32],
                    color,
                    uv: [0.5, 0.5],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p1.x as f32, p1.y as f32],
                    color,
                    uv: [0.0, 0.0],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p2.x as f32, p2.y as f32],
                    color,
                    uv: [1.0, 0.0],
                    shape_type: 0.0
                },
            ]);
        }
    }

    fn tessellate_thin_line(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4], stroke_width: f64) {
        if points.len() < 2 {
            return;
        }

        // Use a very thin line width for actual line drawing (not brush strokes)
        let line_width = (stroke_width.min(3.0) / 2.0) as f32; // Max 1.5px radius for thin lines

        // Create thin line segments between consecutive points
        for i in 0..points.len() - 1 {
            let p1 = points[i];
            let p2 = points[i + 1];

            // Calculate direction vector
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let length = (dx * dx + dy * dy).sqrt();

            if length > 0.0 {
                // Normalize direction
                let dir_x = dx / length;
                let dir_y = dy / length;

                // Calculate perpendicular (normal) vector for thin line
                let nx = -dir_y as f32 * line_width;
                let ny = dir_x as f32 * line_width;

                let x1 = p1.x as f32;
                let y1 = p1.y as f32;
                let x2 = p2.x as f32;
                let y2 = p2.y as f32;

                // Create thin quad for this line segment
                // First triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 + nx, y1 + ny], color, uv: [0.0, 0.0], shape_type: 0.0 },
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Second triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 - nx, y2 - ny], color, uv: [1.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Add small rounded caps for smoother joints
                if i == 0 {
                    self.tessellate_small_cap(vertices, p1, line_width, color);
                }
                if i == points.len() - 2 {
                    self.tessellate_small_cap(vertices, p2, line_width, color);
                }
            }
        }
    }

    fn tessellate_small_cap(&self, vertices: &mut Vec<Vertex>, center: Point, radius: f32, color: [f32; 4]) {
        let cx = center.x as f32;
        let cy = center.y as f32;

        // Create a small rounded cap using fewer segments for thin lines
        let segments = 6; // Fewer segments for small caps
        let angle_step = 2.0 * std::f32::consts::PI / segments as f32;

        for i in 0..segments {
            let angle1 = i as f32 * angle_step;
            let angle2 = (i + 1) as f32 * angle_step;

            let x1 = cx + radius * angle1.cos();
            let y1 = cy + radius * angle1.sin();
            let x2 = cx + radius * angle2.cos();
            let y2 = cy + radius * angle2.sin();

            // Triangle for cap segment
            vertices.extend_from_slice(&[
                Vertex { position: [cx, cy], color, uv: [0.5, 0.5], shape_type: 0.0 },
                Vertex { position: [x1, y1], color, uv: [0.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2, y2], color, uv: [1.0, 0.0], shape_type: 0.0 },
            ]);
        }
    }

    fn tessellate_stroke_polygon(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4]) {
        if points.len() < 3 {
            return;
        }

        // Use earcut-style triangulation for smooth polygon rendering
        // This is much better than fan triangulation for complex shapes

        // Simple triangulation for now - we can improve this later with proper earcut
        // For perfect-freehand outlines, fan triangulation from centroid usually works well

        // Calculate centroid
        let mut centroid_x = 0.0;
        let mut centroid_y = 0.0;
        for point in points {
            centroid_x += point.x;
            centroid_y += point.y;
        }
        centroid_x /= points.len() as f64;
        centroid_y /= points.len() as f64;

        // Create triangles from centroid to each edge
        for i in 0..points.len() {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.len()];

            vertices.extend_from_slice(&[
                Vertex {
                    position: [centroid_x as f32, centroid_y as f32],
                    color,
                    uv: [0.5, 0.5],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p1.x as f32, p1.y as f32],
                    color,
                    uv: [0.0, 0.0],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p2.x as f32, p2.y as f32],
                    color,
                    uv: [1.0, 0.0],
                    shape_type: 0.0
                },
            ]);
        }
    }

    fn tessellate_smooth_line(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4], stroke_width: f64) {
        if points.len() < 2 {
            return;
        }

        let half_width = (stroke_width / 2.0) as f32;

        // Create line segments between consecutive points with proper joins
        for i in 0..points.len() - 1 {
            let p1 = points[i];
            let p2 = points[i + 1];

            // Calculate direction vector
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let length = (dx * dx + dy * dy).sqrt();

            if length > 0.0 {
                // Normalize direction
                let dir_x = dx / length;
                let dir_y = dy / length;

                // Calculate perpendicular (normal) vector
                let nx = -dir_y as f32 * half_width;
                let ny = dir_x as f32 * half_width;

                let x1 = p1.x as f32;
                let y1 = p1.y as f32;
                let x2 = p2.x as f32;
                let y2 = p2.y as f32;

                // Create quad for this line segment
                // First triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 + nx, y1 + ny], color, uv: [0.0, 0.0], shape_type: 0.0 },
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Second triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 - nx, y2 - ny], color, uv: [1.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Add rounded caps at the ends for smoother appearance
                if i == 0 {
                    self.tessellate_line_cap(vertices, p1, nx, ny, color);
                }
                if i == points.len() - 2 {
                    self.tessellate_line_cap(vertices, p2, nx, ny, color);
                }
            }
        }
    }

    fn tessellate_line_cap(&self, vertices: &mut Vec<Vertex>, center: Point, nx: f32, ny: f32, color: [f32; 4]) {
        let cx = center.x as f32;
        let cy = center.y as f32;

        // Create a simple rounded cap using a few triangles
        let segments = 8; // Number of segments for the cap
        let angle_step = std::f32::consts::PI / segments as f32;

        for i in 0..segments {
            let angle1 = i as f32 * angle_step;
            let angle2 = (i + 1) as f32 * angle_step;

            let radius = (nx * nx + ny * ny).sqrt();
            let base_angle = ny.atan2(nx);

            let x1 = cx + radius * (base_angle + angle1).cos();
            let y1 = cy + radius * (base_angle + angle1).sin();
            let x2 = cx + radius * (base_angle + angle2).cos();
            let y2 = cy + radius * (base_angle + angle2).sin();

            // Triangle for cap segment
            vertices.extend_from_slice(&[
                Vertex { position: [cx, cy], color, uv: [0.5, 0.5], shape_type: 0.0 },
                Vertex { position: [x1, y1], color, uv: [0.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2, y2], color, uv: [1.0, 0.0], shape_type: 0.0 },
            ]);
        }
    }

    fn tessellate_draw_polygon(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4]) {
        if points.len() < 3 {
            return;
        }

        // Perfect-freehand gives us stroke outline points, we need to fill the stroke shape
        // Use fan triangulation to fill the stroke polygon properly
        let center_x = points.iter().map(|p| p.x).sum::<f64>() / points.len() as f64;
        let center_y = points.iter().map(|p| p.y).sum::<f64>() / points.len() as f64;

        for i in 0..points.len() {
            let p1 = points[i];
            let p2 = points[(i + 1) % points.len()]; // Wrap around to close the polygon

            // Create triangle from center to edge
            vertices.extend_from_slice(&[
                Vertex {
                    position: [center_x as f32, center_y as f32],
                    color,
                    uv: [0.5, 0.5],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p1.x as f32, p1.y as f32],
                    color,
                    uv: [0.0, 0.0],
                    shape_type: 0.0
                },
                Vertex {
                    position: [p2.x as f32, p2.y as f32],
                    color,
                    uv: [1.0, 0.0],
                    shape_type: 0.0
                },
            ]);
        }
    }

    fn tessellate_draw_path(&self, vertices: &mut Vec<Vertex>, points: &[Point], color: [f32; 4], stroke_width: f64) {
        if points.len() < 2 {
            return;
        }

        // Apply more aggressive smoothing to the input points
        let smoothed_points = self.smooth_path(points);

        if smoothed_points.len() < 2 {
            return;
        }

        // Ensure good stroke width for visibility
        let half_width = (stroke_width.max(5.0) / 2.0) as f32;

        // Create overlapping line segments with proper joins to eliminate gaps
        for i in 0..smoothed_points.len() - 1 {
            let p1 = smoothed_points[i];
            let p2 = smoothed_points[i + 1];

            // Calculate direction vector
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let length = (dx * dx + dy * dy).sqrt();

            if length > 0.5 { // Skip very short segments
                // Normalize direction
                let dir_x = dx / length;
                let dir_y = dy / length;

                // Calculate perpendicular (normal) vector
                let nx = -dir_y as f32 * half_width;
                let ny = dir_x as f32 * half_width;

                let x1 = p1.x as f32;
                let y1 = p1.y as f32;
                let x2 = p2.x as f32;
                let y2 = p2.y as f32;

                // Extend segments slightly to ensure overlap and eliminate gaps
                let extend = half_width * 0.1; // Small extension
                let ext_x = dir_x as f32 * extend;
                let ext_y = dir_y as f32 * extend;

                // Create quad for this line segment with slight extension
                // First triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 + nx - ext_x, y1 + ny - ext_y], color, uv: [0.0, 0.0], shape_type: 0.0 },
                    Vertex { position: [x1 - nx - ext_x, y1 - ny - ext_y], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx + ext_x, y2 + ny + ext_y], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Second triangle
                vertices.extend_from_slice(&[
                    Vertex { position: [x1 - nx - ext_x, y1 - ny - ext_y], color, uv: [0.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 - nx + ext_x, y2 - ny + ext_y], color, uv: [1.0, 1.0], shape_type: 0.0 },
                    Vertex { position: [x2 + nx + ext_x, y2 + ny + ext_y], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);

                // Add line joins at connection points to eliminate gaps
                if i > 0 {
                    self.tessellate_line_join(vertices, smoothed_points[i-1], p1, p2, half_width, color);
                }

                // Add rounded caps at the ends
                if i == 0 {
                    self.tessellate_round_cap(vertices, p1, nx, ny, color);
                }
                if i == smoothed_points.len() - 2 {
                    self.tessellate_round_cap(vertices, p2, nx, ny, color);
                }
            }
        }
    }

    fn smooth_path(&self, points: &[Point]) -> Vec<Point> {
        if points.len() <= 2 {
            return points.to_vec();
        }

        // Apply multiple passes of smoothing for better results
        let mut smoothed = points.to_vec();

        // Apply 3 passes of smoothing for much smoother lines
        for _pass in 0..3 {
            let mut new_smoothed = Vec::with_capacity(smoothed.len());
            new_smoothed.push(smoothed[0]); // Keep first point

            // Apply aggressive smoothing using weighted average
            for i in 1..smoothed.len() - 1 {
                let prev = smoothed[i - 1];
                let curr = smoothed[i];
                let next = smoothed[i + 1];

                // More aggressive smoothing weights for smoother curves
                let smoothed_x = prev.x * 0.2 + curr.x * 0.6 + next.x * 0.2;
                let smoothed_y = prev.y * 0.2 + curr.y * 0.6 + next.y * 0.2;

                new_smoothed.push(Point { x: smoothed_x, y: smoothed_y });
            }

            new_smoothed.push(smoothed[smoothed.len() - 1]); // Keep last point
            smoothed = new_smoothed;
        }

        smoothed
    }



    fn tessellate_round_cap(&self, vertices: &mut Vec<Vertex>, center: Point, nx: f32, ny: f32, color: [f32; 4]) {
        let cx = center.x as f32;
        let cy = center.y as f32;

        // Create a simple rounded cap using a few triangles
        let segments = 6; // Number of segments for the cap
        let angle_step = std::f32::consts::PI / segments as f32;

        for i in 0..segments {
            let angle1 = i as f32 * angle_step;
            let angle2 = (i + 1) as f32 * angle_step;

            let radius = (nx * nx + ny * ny).sqrt();
            let base_angle = ny.atan2(nx);

            let x1 = cx + radius * (base_angle + angle1).cos();
            let y1 = cy + radius * (base_angle + angle1).sin();
            let x2 = cx + radius * (base_angle + angle2).cos();
            let y2 = cy + radius * (base_angle + angle2).sin();

            // Triangle for cap segment
            vertices.extend_from_slice(&[
                Vertex { position: [cx, cy], color, uv: [0.5, 0.5], shape_type: 0.0 },
                Vertex { position: [x1, y1], color, uv: [0.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2, y2], color, uv: [1.0, 0.0], shape_type: 0.0 },
            ]);
        }
    }

    fn tessellate_line_join(&self, vertices: &mut Vec<Vertex>, p0: Point, p1: Point, p2: Point, half_width: f32, color: [f32; 4]) {
        // Create a smooth join between two line segments to eliminate gaps
        let dx1 = p1.x - p0.x;
        let dy1 = p1.y - p0.y;
        let len1 = (dx1 * dx1 + dy1 * dy1).sqrt();

        let dx2 = p2.x - p1.x;
        let dy2 = p2.y - p1.y;
        let len2 = (dx2 * dx2 + dy2 * dy2).sqrt();

        if len1 > 0.0 && len2 > 0.0 {
            let cx = p1.x as f32;
            let cy = p1.y as f32;

            // Create a small circular join to fill any gaps
            let segments = 4;
            for i in 0..segments {
                let angle1 = (i as f32 / segments as f32) * std::f32::consts::PI * 2.0;
                let angle2 = ((i + 1) as f32 / segments as f32) * std::f32::consts::PI * 2.0;

                let x1 = cx + half_width * 0.8 * angle1.cos();
                let y1 = cy + half_width * 0.8 * angle1.sin();
                let x2 = cx + half_width * 0.8 * angle2.cos();
                let y2 = cy + half_width * 0.8 * angle2.sin();

                vertices.extend_from_slice(&[
                    Vertex { position: [cx, cy], color, uv: [0.5, 0.5], shape_type: 0.0 },
                    Vertex { position: [x1, y1], color, uv: [0.0, 0.0], shape_type: 0.0 },
                    Vertex { position: [x2, y2], color, uv: [1.0, 0.0], shape_type: 0.0 },
                ]);
            }
        }
    }

    fn tessellate_rectangle_outline(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4], outline_width: f32) {
        let x = pos.x as f32;
        let y = pos.y as f32;
        let w = width as f32;
        let h = height as f32;
        let thickness = outline_width;

        // Top edge
        self.tessellate_outline_edge(vertices, x, y, x + w, y, thickness, color);
        // Right edge
        self.tessellate_outline_edge(vertices, x + w, y, x + w, y + h, thickness, color);
        // Bottom edge
        self.tessellate_outline_edge(vertices, x + w, y + h, x, y + h, thickness, color);
        // Left edge
        self.tessellate_outline_edge(vertices, x, y + h, x, y, thickness, color);
    }

    fn tessellate_ellipse_outline(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4], outline_width: f32) {
        let x = pos.x as f32;
        let y = pos.y as f32;
        let w = width as f32;
        let h = height as f32;
        let cx = x + w / 2.0;
        let cy = y + h / 2.0;
        let rx = w / 2.0;
        let ry = h / 2.0;
        let thickness = outline_width;

        // Create ellipse outline using line segments
        let segments = 32; // Number of segments for smooth curve
        for i in 0..segments {
            let angle1 = (i as f32) * 2.0 * std::f32::consts::PI / (segments as f32);
            let angle2 = ((i + 1) as f32) * 2.0 * std::f32::consts::PI / (segments as f32);

            let x1 = cx + rx * angle1.cos();
            let y1 = cy + ry * angle1.sin();
            let x2 = cx + rx * angle2.cos();
            let y2 = cy + ry * angle2.sin();

            self.tessellate_outline_edge(vertices, x1, y1, x2, y2, thickness, color);
        }
    }

    fn tessellate_outline_edge(&self, vertices: &mut Vec<Vertex>, x1: f32, y1: f32, x2: f32, y2: f32, thickness: f32, color: [f32; 4]) {
        let dx = x2 - x1;
        let dy = y2 - y1;
        let length = (dx * dx + dy * dy).sqrt();

        if length > 0.0 {
            let nx = -dy / length * thickness / 2.0;
            let ny = dx / length * thickness / 2.0;

            // Create a rectangle for the line segment
            vertices.extend_from_slice(&[
                // Triangle 1
                Vertex { position: [x1 + nx, y1 + ny], color, uv: [0.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
                // Triangle 2
                Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 0.0 },
                Vertex { position: [x2 - nx, y2 - ny], color, uv: [1.0, 1.0], shape_type: 0.0 },
                Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 0.0 },
            ]);
        }
    }





    fn tessellate_image_quad(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64) {
        let x = pos.x as f32;
        let y = pos.y as f32;
        let w = width as f32;
        let h = height as f32;

        let color = [1.0, 1.0, 1.0, 1.0]; // White color for images (texture will provide the color)
        let shape_type = 3.0; // Image shape type

        // Create two triangles to form a quad
        // Triangle 1: top-left, bottom-left, top-right
        vertices.push(Vertex {
            position: [x, y],
            color,
            uv: [0.0, 0.0], // Top-left UV
            shape_type,
        });
        vertices.push(Vertex {
            position: [x, y + h],
            color,
            uv: [0.0, 1.0], // Bottom-left UV
            shape_type,
        });
        vertices.push(Vertex {
            position: [x + w, y],
            color,
            uv: [1.0, 0.0], // Top-right UV
            shape_type,
        });

        // Triangle 2: top-right, bottom-left, bottom-right
        vertices.push(Vertex {
            position: [x + w, y],
            color,
            uv: [1.0, 0.0], // Top-right UV
            shape_type,
        });
        vertices.push(Vertex {
            position: [x, y + h],
            color,
            uv: [0.0, 1.0], // Bottom-left UV
            shape_type,
        });
        vertices.push(Vertex {
            position: [x + w, y + h],
            color,
            uv: [1.0, 1.0], // Bottom-right UV
            shape_type,
        });
    }

}
