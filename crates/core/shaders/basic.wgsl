// WebGPU 2D Shape Rendering Shader
// Optimized for whiteboard 144Hz performance

// Uniform buffer for view and projection data
struct Uniforms {
    view_proj: mat4x4<f32>,
    viewport: vec4<f32>, // width, height, pixel_ratio, time
    camera: vec4<f32>,   // tx, ty, scale, 0
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// Vertex input structure
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) shape_type: f32, // 0=rect, 1=ellipse, 2=line
}

// Vertex output structure
struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) shape_type: f32,
    @location(3) world_pos: vec2<f32>,
}

// Vertex shader
@vertex
fn vs_main(vertex: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // Apply camera translation and zoom before converting to clip space
    let world_pos = (vertex.position - uniforms.camera.xy) * uniforms.camera.z;
    let normalized_pos = (world_pos / uniforms.viewport.xy) * 2.0 - 1.0;
    let clip_pos = vec4<f32>(normalized_pos.x, -normalized_pos.y, 0.0, 1.0);
    
    out.clip_position = uniforms.view_proj * clip_pos;
    out.color = vertex.color;
    out.uv = vertex.uv;
    out.shape_type = vertex.shape_type;
    out.world_pos = vertex.position;
    
    return out;
}

// Fragment shader with shape-specific rendering
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var final_color = in.color;
    
    // Shape-specific rendering
    if (in.shape_type < 0.5) {
        // Rectangle (shape_type = 0.0)
        final_color = in.color;
    } else if (in.shape_type < 1.5) {
        // Ellipse (shape_type = 1.0)
        let center = vec2<f32>(0.5, 0.5);
        let dist = distance(in.uv, center);
        if (dist > 0.5) {
            discard;
        }
        final_color = in.color;
    } else {
        // Line (shape_type = 2.0)
        final_color = in.color;
    }
    
    return final_color;
}
