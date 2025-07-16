use bytemuck::{Pod, Zeroable};
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;
use std::collections::HashMap;

// ---------------- Vertex / Uniform types -----------------------------

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug, serde::Serialize, serde::Deserialize)]
pub struct Vertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
    pub uv: [f32; 2],
    pub shape_type: f32,
}

impl Vertex {
    pub const fn desc<'a>() -> wgpu::VertexBufferLayout<'a> {
        use std::mem;
        wgpu::VertexBufferLayout {
            array_stride: mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                // position
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                // color
                wgpu::VertexAttribute {
                    offset: mem::size_of::<[f32; 2]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x4,
                },
                // uv
                wgpu::VertexAttribute {
                    offset: (mem::size_of::<[f32; 2]>() + mem::size_of::<[f32; 4]>())
                        as wgpu::BufferAddress,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x2,
                },
                // shape_type
                wgpu::VertexAttribute {
                    offset: (mem::size_of::<[f32; 2]>()
                        + mem::size_of::<[f32; 4]>()
                        + mem::size_of::<[f32; 2]>())
                        as wgpu::BufferAddress,
                    shader_location: 3,
                    format: wgpu::VertexFormat::Float32,
                },
            ],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
struct Uniforms {
    view_proj: [[f32; 4]; 4],
    viewport: [f32; 4], // width, height, pixel_ratio, time
    camera: [f32; 4],   // tx, ty, scale, 0
}

#[derive(Debug)]
pub struct TextureCache {
    textures: HashMap<String, wgpu::Texture>,
    texture_views: HashMap<String, wgpu::TextureView>,
    bind_groups: HashMap<String, wgpu::BindGroup>,
}

impl TextureCache {
    pub fn new() -> Self {
        Self {
            textures: HashMap::new(),
            texture_views: HashMap::new(),
            bind_groups: HashMap::new(),
        }
    }

    pub fn get_bind_group(&self, data_url: &str) -> Option<&wgpu::BindGroup> {
        self.bind_groups.get(data_url)
    }

    pub fn insert_texture(&mut self, data_url: String, texture: wgpu::Texture, texture_view: wgpu::TextureView, bind_group: wgpu::BindGroup) {
        self.textures.insert(data_url.clone(), texture);
        self.texture_views.insert(data_url.clone(), texture_view);
        self.bind_groups.insert(data_url, bind_group);
    }


}

#[derive(Debug)]
pub struct GpuState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    #[allow(dead_code)]
    size: (u32, u32),
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    bind_group_layout: wgpu::BindGroupLayout,
    _uniform_buffer: wgpu::Buffer,
    uniforms: Uniforms,
    texture_cache: TextureCache,
    sampler: wgpu::Sampler,
    #[allow(dead_code)]
    default_texture: wgpu::Texture,
    #[allow(dead_code)]
    default_texture_view: wgpu::TextureView,
    // MSAA support
    sample_count: u32,
    msaa_texture: wgpu::Texture,
    msaa_texture_view: wgpu::TextureView,
}

impl GpuState {
    pub async fn new(canvas: &web_sys::OffscreenCanvas) -> Result<Self, JsValue> {
        // SAFETY: the OffscreenCanvas must outlive the surface – JS owns it for page lifetime.
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        // Create the surface targeting the provided OffscreenCanvas.
        let surface = instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas.clone()))
            .map_err(|e| JsValue::from_str(&format!("Failed to create surface: {e}")))?;

        // Request adapter.
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::default(),
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to find suitable adapter: {e}")))?;

        // Request device + queue.
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("whiteboard-device"),
                required_features: wgpu::Features::empty(),
                required_limits: if cfg!(target_arch = "wasm32") {
                    wgpu::Limits::downlevel_webgl2_defaults()
                } else {
                    wgpu::Limits::default()
                },
                memory_hints: wgpu::MemoryHints::Performance,
                trace: Default::default(),
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("Request device failed: {e}")))?;

        let width = canvas.width();
        let height = canvas.height();

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: caps.present_modes[0],
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&device, &config);

        // ---- Create sampler for texture sampling ----
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("image-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // ---- Create default 1x1 white texture for non-image shapes ----
        let default_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("default-texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Upload white pixel data to default texture
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &default_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[255, 255, 255, 255], // White pixel
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        let default_texture_view = default_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // ---- Uniform buffer / bind group ----
        let uniforms = Uniforms {
            view_proj: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            viewport: [width as f32, height as f32, 1.0, 0.0],
            camera: [0.0, 0.0, 1.0, 0.0],
        };

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("uniform-buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bind-group-layout"),
            entries: &[
                // Uniform buffer (binding 0)
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Texture (binding 1)
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        multisampled: false,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                // Sampler (binding 2)
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("default-bind-group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&default_texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });

        // ---- Shader & pipeline ----
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("basic-shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/basic.wgsl").into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pipeline-layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        // Enable 4x MSAA for smooth anti-aliased rendering
        let sample_count = 4;

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("shape-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[Vertex::desc()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: sample_count,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        // Create multisampled texture for MSAA
        let msaa_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("msaa-texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });

        let msaa_texture_view = msaa_texture.create_view(&wgpu::TextureViewDescriptor::default());

        Ok(Self {
            surface,
            device,
            queue,
            config,
            size: (width, height),
            pipeline,
            bind_group,
            bind_group_layout,
            _uniform_buffer: uniform_buffer,
            uniforms,
            texture_cache: TextureCache::new(),
            sampler,
            default_texture,
            default_texture_view,
            sample_count,
            msaa_texture,
            msaa_texture_view,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32, _dpr: f64) {
        if width == 0 || height == 0 || (width == self.size.0 && height == self.size.1) {
            return;
        }
        self.size = (width, height);
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);

        self.uniforms.viewport[0] = width as f32;
        self.uniforms.viewport[1] = height as f32;
        self.queue
            .write_buffer(&self._uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));

        // Recreate MSAA texture with new size
        self.msaa_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("msaa-texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: self.sample_count,
            dimension: wgpu::TextureDimension::D2,
            format: self.config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });

        self.msaa_texture_view = self.msaa_texture.create_view(&wgpu::TextureViewDescriptor::default());
    }



    pub fn render_shapes_with_textures(&mut self, vertices: &[Vertex], texture_data_urls: &[Option<String>], clear: bool) {
        // Handle empty vertex arrays gracefully
        if vertices.is_empty() && !clear {
            // Nothing to render and no clearing needed
            return;
        }

        let Ok(frame) = self.surface.get_current_texture() else {
            return;
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("shape-encoder"),
            });

        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shape-render-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.msaa_texture_view,
                    resolve_target: Some(&view),
                    ops: wgpu::Operations {
                        load: if clear {
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.10,
                                g: 0.10,
                                b: 0.10,
                                a: 1.0,
                            })
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            if !vertices.is_empty() {
                rpass.set_pipeline(&self.pipeline);

                // Separate vertices by texture requirements
                let mut non_image_vertices = Vec::new();
                let mut image_batches: HashMap<String, Vec<Vertex>> = HashMap::new();

                for (i, vertex) in vertices.iter().enumerate() {
                    if vertex.shape_type >= 2.5 {
                        // This is an image vertex
                        if let Some(Some(data_url)) = texture_data_urls.get(i / 6) { // 6 vertices per image quad
                            image_batches.entry(data_url.clone()).or_insert_with(Vec::new).push(*vertex);
                        } else {
                            // Fallback to non-image rendering if no texture URL
                            non_image_vertices.push(*vertex);
                        }
                    } else {
                        // Non-image vertex
                        non_image_vertices.push(*vertex);
                    }
                }

                // Render non-image vertices with default bind group
                if !non_image_vertices.is_empty() {
                    let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("non-image-vertex-buffer"),
                        contents: bytemuck::cast_slice(&non_image_vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    });

                    rpass.set_vertex_buffer(0, vertex_buffer.slice(..));
                    rpass.set_bind_group(0, &self.bind_group, &[]);
                    rpass.draw(0..non_image_vertices.len() as u32, 0..1);
                }

                // Render each image batch with its specific texture
                for (data_url, batch_vertices) in image_batches {
                    if let Some(bind_group) = self.texture_cache.get_bind_group(&data_url) {
                        let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some("image-vertex-buffer"),
                            contents: bytemuck::cast_slice(&batch_vertices),
                            usage: wgpu::BufferUsages::VERTEX,
                        });

                        rpass.set_vertex_buffer(0, vertex_buffer.slice(..));
                        rpass.set_bind_group(0, bind_group, &[]);
                        rpass.draw(0..batch_vertices.len() as u32, 0..1);
                    }
                }
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();
    }

    pub fn update_camera(&mut self, translation: [f32; 2], scale: f32) {
        self.uniforms.camera = [translation[0], translation[1], scale, 0.0];
        // Write only the changed part (or entire struct for simplicity)
        self.queue
            .write_buffer(&self._uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
    }

    /// Create a texture from image data and cache it
    pub fn create_texture_from_data(&mut self, data_url: &str, image_data: &[u8], width: u32, height: u32) -> Result<(), String> {
        // Check if texture already exists in cache
        if self.texture_cache.get_bind_group(data_url).is_some() {
            return Ok(());
        }

        // Create texture
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("image-texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Upload image data
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            image_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        // Create texture view
        let texture_view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Create bind group for this texture
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("image-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self._uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        // Cache the texture and bind group
        self.texture_cache.insert_texture(data_url.to_string(), texture, texture_view, bind_group);

        Ok(())
    }


}
