# tldraw-ng

A next-generation, high-performance tldraw clone built with Rust + WebGPU.

**Target Performance:** Steady 144 Hz on modern GPUs, seamless fallback on <60 Hz devices.

## Architecture

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Core Renderer** | Rust + wgpu → WebAssembly | GPU-accelerated rendering via WebGPU |
| **Text Engine** | cosmic-text | Complex text layout with GPU glyph caching |
| **Worker Thread** | OffscreenCanvas + WebWorker | Off-main-thread rendering |
| **UI Shell** | SolidJS + Vite | Fine-grained reactive UI |

## Quick Start

### Prerequisites

- Rust nightly (1.80+)
- Node.js 20+ LTS
- pnpm 9+
- wasm-bindgen-cli
- trunk

### Setup

```bash
# First-time setup (builds WASM package)
node setup.js

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Build for production
pnpm build
```

## Project Structure

```
tldraw-ng/
├── crates/
│   └── core/          # Rust → WASM (wgpu renderer)
├── packages/
│   ├── worker/        # TypeScript glue for core.wasm
│   └── web-ui/        # SolidJS UI components
└── tests/
    └── e2e/           # End-to-end tests
```

## Development

- **Hot Reload:** `pnpm dev` starts all dev servers in parallel
- **Testing:** `pnpm test` runs all test suites
- **Linting:** `pnpm lint` and `pnpm format`

## Performance Budget

- **Main Thread:** < 2ms per frame
- **Worker Thread:** < 5ms per frame  
- **Memory:** < 128MB RAM
- **Target:** 144 Hz (6.9ms frame time)

---

> **May your frames be ever under 7ms.**
