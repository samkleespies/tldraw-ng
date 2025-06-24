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
    Line { end: Point },
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
            ShapeType::Line { end } => {
                let min_x = x.min(end.x);
                let max_x = x.max(end.x);
                let min_y = y.min(end.y);
                let max_y = y.max(end.y);
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
            color: [0.2, 0.6, 1.0, 1.0], // Blue
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
            color: [1.0, 0.6, 0.2, 1.0], // Orange
        };

        self.shapes.insert(id, shape);
        id.0
    }

    /// Create a new line shape
    #[wasm_bindgen]
    pub fn create_line(&mut self, x1: f64, y1: f64, x2: f64, y2: f64) -> u32 {
        let id = ShapeId(self.next_id);
        self.next_id += 1;

        let shape = Shape {
            id,
            position: Point { x: x1, y: y1 },
            shape_type: ShapeType::Line { end: Point { x: x2, y: y2 } },
            color: [0.8, 0.2, 0.8, 1.0], // Purple
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

    /// Handle pointer down event
    #[wasm_bindgen]
    pub fn handle_pointer_down(&mut self, x: f64, y: f64) {
        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        // Find shape under cursor
        let mut hit_shape = None;
        for (id, shape) in &self.shapes {
            if shape.bounding_box().contains_point(world_x, world_y) {
                hit_shape = Some(*id);
                break;
            }
        }

        if let Some(shape_id) = hit_shape {
            // Select the shape if not already selected
            if !self.selected_shapes.contains(&shape_id) {
                self.selected_shapes.clear();
                self.selected_shapes.push(shape_id);
            }

            // Start dragging
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
        } else {
            // Clear selection if clicking on empty space
            self.selected_shapes.clear();
        }
    }

    /// Handle pointer move event
    #[wasm_bindgen]
    pub fn handle_pointer_move(&mut self, x: f64, y: f64) {
        if !self.is_dragging {
            return;
        }

        // Convert screen coordinates to world coordinates
        let world_x = (x / self.camera_scale as f64) + self.camera_translation[0] as f64;
        let world_y = (y / self.camera_scale as f64) + self.camera_translation[1] as f64;

        // Update positions of all selected shapes
        for &selected_id in &self.selected_shapes {
            if let (Some(shape), Some(offset)) = (self.shapes.get_mut(&selected_id), self.drag_offset.get(&selected_id)) {
                shape.position.x = world_x + offset.x;
                shape.position.y = world_y + offset.y;
            }
        }
    }

    /// Handle pointer up event
    #[wasm_bindgen]
    pub fn handle_pointer_up(&mut self, _x: f64, _y: f64) {
        self.is_dragging = false;
        self.drag_start = None;
        self.drag_offset.clear();
    }

    /// Handle wheel event for zooming
    #[wasm_bindgen]
    pub fn handle_wheel(&mut self, _dx: f64, dy: f64) {
        // Simple zoom implementation
        let zoom_factor = if dy > 0.0 { 0.9 } else { 1.1 };
        self.camera_scale = (self.camera_scale * zoom_factor).clamp(0.1, 10.0);

        if let Some(gpu) = &mut self.gpu {
            gpu.update_camera(self.camera_translation, self.camera_scale);
        }
    }

    /// Pan the camera
    #[wasm_bindgen]
    pub fn pan_camera(&mut self, dx: f64, dy: f64) {
        self.camera_translation[0] += dx as f32;
        self.camera_translation[1] += dy as f32;

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

        for shape in self.shapes.values() {
            let is_selected = self.selected_shapes.contains(&shape.id);
            let color = if is_selected {
                [1.0, 1.0, 0.0, 1.0] // Yellow for selected
            } else {
                shape.color
            };

            match &shape.shape_type {
                ShapeType::Rectangle { width, height } => {
                    self.tessellate_rectangle(&mut vertices, shape.position, *width, *height, color);
                }
                ShapeType::Ellipse { width, height } => {
                    self.tessellate_ellipse(&mut vertices, shape.position, *width, *height, color);
                }
                ShapeType::Line { end } => {
                    self.tessellate_line(&mut vertices, shape.position, *end, color);
                }
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

    fn tessellate_line(&self, vertices: &mut Vec<Vertex>, start: Point, end: Point, color: [f32; 4]) {
        let x1 = start.x as f32;
        let y1 = start.y as f32;
        let x2 = end.x as f32;
        let y2 = end.y as f32;

        let thickness = 2.0;
        let dx = x2 - x1;
        let dy = y2 - y1;
        let length = (dx * dx + dy * dy).sqrt();

        if length > 0.0 {
            let nx = -dy / length * thickness / 2.0;
            let ny = dx / length * thickness / 2.0;

            // Line as a rectangle
            vertices.extend_from_slice(&[
                // Triangle 1
                Vertex { position: [x1 + nx, y1 + ny], color, uv: [0.0, 0.0], shape_type: 2.0 },
                Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 2.0 },
                Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 2.0 },
                // Triangle 2
                Vertex { position: [x2 + nx, y2 + ny], color, uv: [1.0, 0.0], shape_type: 2.0 },
                Vertex { position: [x2 - nx, y2 - ny], color, uv: [1.0, 1.0], shape_type: 2.0 },
                Vertex { position: [x1 - nx, y1 - ny], color, uv: [0.0, 1.0], shape_type: 2.0 },
            ]);
        }
    }
}
