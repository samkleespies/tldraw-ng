//! Clean whiteboard core compiled to WebAssembly.
//!
//! This crate provides a basic shape management system for a drawing whiteboard.

// Remove unused lyon imports for now
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

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
        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Rectangle { width, height },
            color: [0.2, 0.8, 0.2, 1.0], // Green
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a new ellipse shape
    #[wasm_bindgen]
    pub fn create_ellipse(&mut self, x: f64, y: f64, width: f64, height: f64) -> u32 {
        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x, y },
            shape_type: ShapeType::Ellipse { width, height },
            color: [1.0, 0.2, 0.2, 1.0], // Red
        };

        self.shapes.insert(id, shape);
        id.0
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
        let deleted_count = self.selected_shapes.len();
        for &shape_id in &self.selected_shapes {
            self.shapes.remove(&shape_id);
        }
        self.selected_shapes.clear();
        deleted_count
    }

    /// Clear all shapes
    #[wasm_bindgen]
    pub fn clear_all(&mut self) {
        self.shapes.clear();
        self.selected_shapes.clear();
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

    /// Get current camera scale for coordinate conversion
    #[wasm_bindgen]
    pub fn get_camera_scale(&self) -> f32 {
        self.camera_scale
    }

    /// Get current camera translation for coordinate conversion
    #[wasm_bindgen]
    pub fn get_camera_translation(&self) -> Vec<f32> {
        vec![self.camera_translation[0], self.camera_translation[1]]
    }

    /// Start creating a shape with click and drag
    #[wasm_bindgen]
    pub fn start_shape_creation(&mut self, x: f64, y: f64, shape_type: &str) {
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
                color: [0.2, 0.8, 0.2, 1.0], // Green
            },
            "ellipse" => Shape {
                id,
                position: Point { x: world_x, y: world_y },
                shape_type: ShapeType::Ellipse { width: 1.0, height: 1.0 },
                color: [1.0, 0.2, 0.2, 1.0], // Red
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

        // Reset creation state
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

    /// Get resize handles for selected shapes
    fn get_resize_handles(&self) -> Vec<ResizeHandleInfo> {
        let mut handles = Vec::new();

        // Only show resize handles if exactly one shape is selected
        if self.selected_shapes.len() == 1 {
            let shape_id = self.selected_shapes[0];
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
                if let Some(&shape_id) = self.selected_shapes.first() {
                    return Some((handle.handle_type, shape_id));
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
        match &shape.shape_type {
            ShapeType::Rectangle { .. } | ShapeType::Ellipse { .. } => {
                match handle_type {
                    ResizeHandle::TopLeft => {
                        let new_width = start_bounds.max_x - mouse_x;
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_width > 10.0 && new_height > 10.0 {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: mouse_x, y: mouse_y });
                        }
                    }
                    ResizeHandle::TopRight => {
                        let new_width = mouse_x - start_bounds.min_x;
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_width > 10.0 && new_height > 10.0 {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: shape.position.x, y: mouse_y });
                        }
                    }
                    ResizeHandle::BottomLeft => {
                        let new_width = start_bounds.max_x - mouse_x;
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_width > 10.0 && new_height > 10.0 {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: mouse_x, y: shape.position.y });
                        }
                    }
                    ResizeHandle::BottomRight => {
                        let new_width = mouse_x - start_bounds.min_x;
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_width > 10.0 && new_height > 10.0 {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_height = Some(new_height);
                        }
                    }
                    ResizeHandle::Top => {
                        let new_height = start_bounds.max_y - mouse_y;
                        if new_height > 10.0 {
                            resize_data.new_height = Some(new_height);
                            resize_data.new_position = Some(Point { x: shape.position.x, y: mouse_y });
                        }
                    }
                    ResizeHandle::Bottom => {
                        let new_height = mouse_y - start_bounds.min_y;
                        if new_height > 10.0 {
                            resize_data.new_height = Some(new_height);
                        }
                    }
                    ResizeHandle::Left => {
                        let new_width = start_bounds.max_x - mouse_x;
                        if new_width > 10.0 {
                            resize_data.new_width = Some(new_width);
                            resize_data.new_position = Some(Point { x: mouse_x, y: shape.position.y });
                        }
                    }
                    ResizeHandle::Right => {
                        let new_width = mouse_x - start_bounds.min_x;
                        if new_width > 10.0 {
                            resize_data.new_width = Some(new_width);
                        }
                    }
                }
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

        // Find shape under cursor
        let mut hit_shape = None;
        for (id, shape) in &self.shapes {
            if shape.bounding_box().contains_point(world_x, world_y) {
                hit_shape = Some(*id);
                break;
            }
        }

        if let Some(shape_id) = hit_shape {
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
                // Single-select mode: select only this shape (unless it's already the only selected one)
                if self.selected_shapes.len() != 1 || !self.selected_shapes.contains(&shape_id) {
                    self.selected_shapes.clear();
                    self.selected_shapes.push(shape_id);
                }
            }

            // Start dragging only if we have selected shapes
            if !self.selected_shapes.is_empty() {
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
                self.selected_shapes = shapes_in_rect;
            }
        } else if self.is_dragging {
            // Handle dragging
            // Update positions of all selected shapes
            for &selected_id in &self.selected_shapes {
                if let (Some(shape), Some(offset)) = (self.shapes.get_mut(&selected_id), self.drag_offset.get(&selected_id)) {
                    shape.position.x = world_x + offset.x;
                    shape.position.y = world_y + offset.y;
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
        // Split the borrow to avoid borrow checker issues
        let vertices = self.tessellate_shapes();
        if let Some(gpu) = &mut self.gpu {
            gpu.render_shapes(&vertices, true);
        }
    }

    /// Tessellate all shapes into vertices for GPU rendering
    fn tessellate_shapes(&self) -> Vec<Vertex> {
        let mut vertices = Vec::new();

        // Render shapes first (always in their original colors)
        for shape in self.shapes.values() {
            match &shape.shape_type {
                ShapeType::Rectangle { width, height } => {
                    self.tessellate_rectangle(&mut vertices, shape.position, *width, *height, shape.color);
                }
                ShapeType::Ellipse { width, height } => {
                    self.tessellate_ellipse(&mut vertices, shape.position, *width, *height, shape.color);
                }
            }
        }

        // Render selection outlines for selected shapes
        for shape in self.shapes.values() {
            if self.selected_shapes.contains(&shape.id) {
                self.tessellate_selection_outline(&mut vertices, shape);
            }
        }

        // Render selection rectangle if dragging
        if self.is_selection_dragging {
            if let (Some(start), Some(current)) = (self.selection_start, self.selection_current) {
                self.tessellate_selection_rectangle(&mut vertices, start, current);
            }
        }

        // No need for preview rendering - we modify the actual shape in real-time

        // Render resize handles on top
        if !self.is_dragging && !self.is_resizing && !self.is_selection_dragging && !self.is_creating_shape {
            let handles = self.get_resize_handles();
            for handle in handles {
                self.tessellate_resize_handle(&mut vertices, handle);
            }
        }

        vertices
    }

    fn tessellate_rectangle(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4]) {
        let x = pos.x as f32;
        let y = pos.y as f32;
        let w = width as f32;
        let h = height as f32;

        // Two triangles for a rectangle
        vertices.extend_from_slice(&[
            // Triangle 1
            Vertex { position: [x, y], color, uv: [0.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 0.0 },
            // Triangle 2
            Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + w, y + h], color, uv: [1.0, 1.0], shape_type: 0.0 },
            Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 0.0 },
        ]);
    }

    fn tessellate_ellipse(&self, vertices: &mut Vec<Vertex>, pos: Point, width: f64, height: f64, color: [f32; 4]) {
        let x = pos.x as f32;
        let y = pos.y as f32;
        let w = width as f32;
        let h = height as f32;

        // Create a simple quad and let the fragment shader handle the circular shape
        // This avoids the "sun" effect from triangle tessellation
        vertices.extend_from_slice(&[
            // Triangle 1
            Vertex { position: [x, y], color, uv: [0.0, 0.0], shape_type: 1.0 },
            Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 1.0 },
            Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 1.0 },
            // Triangle 2
            Vertex { position: [x + w, y], color, uv: [1.0, 0.0], shape_type: 1.0 },
            Vertex { position: [x + w, y + h], color, uv: [1.0, 1.0], shape_type: 1.0 },
            Vertex { position: [x, y + h], color, uv: [0.0, 1.0], shape_type: 1.0 },
        ]);
    }



    fn tessellate_resize_handle(&self, vertices: &mut Vec<Vertex>, handle: ResizeHandleInfo) {
        let x = handle.position.x as f32;
        let y = handle.position.y as f32;
        let half_size = (handle.size / 2.0) as f32;
        let border_width = 1.0;

        // First render black border (slightly larger)
        let border_color = [0.0, 0.0, 0.0, 1.0]; // Black border
        let border_half_size = half_size + border_width;

        vertices.extend_from_slice(&[
            // Border - Triangle 1
            Vertex { position: [x - border_half_size, y - border_half_size], color: border_color, uv: [0.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + border_half_size, y - border_half_size], color: border_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x - border_half_size, y + border_half_size], color: border_color, uv: [0.0, 1.0], shape_type: 0.0 },
            // Border - Triangle 2
            Vertex { position: [x + border_half_size, y - border_half_size], color: border_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + border_half_size, y + border_half_size], color: border_color, uv: [1.0, 1.0], shape_type: 0.0 },
            Vertex { position: [x - border_half_size, y + border_half_size], color: border_color, uv: [0.0, 1.0], shape_type: 0.0 },
        ]);

        // Then render white handle on top
        let handle_color = [1.0, 1.0, 1.0, 1.0]; // White

        vertices.extend_from_slice(&[
            // Handle - Triangle 1
            Vertex { position: [x - half_size, y - half_size], color: handle_color, uv: [0.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + half_size, y - half_size], color: handle_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x - half_size, y + half_size], color: handle_color, uv: [0.0, 1.0], shape_type: 0.0 },
            // Handle - Triangle 2
            Vertex { position: [x + half_size, y - half_size], color: handle_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [x + half_size, y + half_size], color: handle_color, uv: [1.0, 1.0], shape_type: 0.0 },
            Vertex { position: [x - half_size, y + half_size], color: handle_color, uv: [0.0, 1.0], shape_type: 0.0 },
        ]);
    }

    fn tessellate_selection_outline(&self, vertices: &mut Vec<Vertex>, shape: &Shape) {
        let outline_color = [0.3, 0.6, 1.0, 1.0]; // Blue outline
        let outline_width = 2.0; // Outline thickness

        match &shape.shape_type {
            ShapeType::Rectangle { width, height } => {
                self.tessellate_rectangle_outline(&mut *vertices, shape.position, *width, *height, outline_color, outline_width);
            }
            ShapeType::Ellipse { width, height } => {
                self.tessellate_ellipse_outline(&mut *vertices, shape.position, *width, *height, outline_color, outline_width);
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





    fn tessellate_selection_rectangle(&self, vertices: &mut Vec<Vertex>, start: Point, end: Point) {
        let min_x = start.x.min(end.x) as f32;
        let max_x = start.x.max(end.x) as f32;
        let min_y = start.y.min(end.y) as f32;
        let max_y = start.y.max(end.y) as f32;

        // Windows 11 style selection rectangle: semi-transparent blue fill with blue border
        let fill_color = [0.3, 0.6, 1.0, 0.2]; // Semi-transparent blue
        let border_color = [0.3, 0.6, 1.0, 0.8]; // Solid blue border
        let border_width = 1.0;

        // Render fill first (background)
        vertices.extend_from_slice(&[
            // Triangle 1
            Vertex { position: [min_x, min_y], color: fill_color, uv: [0.0, 0.0], shape_type: 0.0 },
            Vertex { position: [max_x, min_y], color: fill_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [min_x, max_y], color: fill_color, uv: [0.0, 1.0], shape_type: 0.0 },
            // Triangle 2
            Vertex { position: [max_x, min_y], color: fill_color, uv: [1.0, 0.0], shape_type: 0.0 },
            Vertex { position: [max_x, max_y], color: fill_color, uv: [1.0, 1.0], shape_type: 0.0 },
            Vertex { position: [min_x, max_y], color: fill_color, uv: [0.0, 1.0], shape_type: 0.0 },
        ]);

        // Render border on top
        // Top edge
        self.tessellate_outline_edge(vertices, min_x, min_y, max_x, min_y, border_width, border_color);
        // Right edge
        self.tessellate_outline_edge(vertices, max_x, min_y, max_x, max_y, border_width, border_color);
        // Bottom edge
        self.tessellate_outline_edge(vertices, max_x, max_y, min_x, max_y, border_width, border_color);
        // Left edge
        self.tessellate_outline_edge(vertices, min_x, max_y, min_x, min_y, border_width, border_color);
    }
}
