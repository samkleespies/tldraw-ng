# 🛠️ Build & Development Commands Reference

This document contains all the essential commands for building, running, and maintaining the tldraw-ng project.

## 🚀 **Development Commands**

```bash
# Start development server (builds WASM + starts dev servers)
pnpm dev

# Start development with WASM auto-watching (recommended for Rust development)
pnpm run dev:watch

# Start dev server on specific port if needed
pnpm dev --port 3000
```

## 🔧 **Build Commands**

```bash
# Build everything (WASM + all packages)
pnpm build

# Build only WASM core (Rust → WebAssembly)
pnpm run build:wasm

# Manually copy WASM files to web-ui (if needed)
pnpm run copy:wasm

# Check if WASM files are in sync
pnpm run check:wasm

# Watch WASM files and auto-copy on changes
pnpm run watch:wasm

# Build specific package
pnpm -r build                    # All packages
cd packages/web-ui && pnpm build # Just web-ui
cd packages/worker && pnpm build # Just worker
```

## 🧹 **Clean/Cache Commands**

```bash
# Clean all node_modules and reinstall
rm -rf node_modules packages/*/node_modules
pnpm install

# Clean WASM build artifacts
rm -rf crates/core/pkg
rm -rf packages/web-ui/src/wasm/*

# Clean browser cache (when WASM isn't updating)
# In browser: Ctrl+Shift+R (hard refresh)
# Or open DevTools → Network tab → check "Disable cache"

# Clean Rust build cache (if Rust compilation issues)
cd crates/core && cargo clean

# Nuclear option - clean everything
rm -rf node_modules packages/*/node_modules crates/core/pkg crates/core/target
pnpm install
```

## 🔄 **WASM Update Workflow**

When you modify Rust code:
```bash
# Option 1: Automatic (recommended)
pnpm run build:wasm    # Builds + copies automatically

# Option 2: Manual steps
cd crates/core
wasm-pack build --target web --out-dir pkg
cd ../..
pnpm run copy:wasm
```

## 🧪 **Testing Commands**

```bash
# Run all tests
pnpm test

# Rust tests
pnpm run test:rust

# E2E tests
pnpm run test:e2e
pnpm run test:e2e:ui      # With UI
pnpm run test:e2e:debug   # Debug mode
```

## 📦 **Package Management**

```bash
# Install dependencies
pnpm install

# Add dependency to specific package
cd packages/web-ui && pnpm add some-package
cd packages/worker && pnpm add some-package

# Add dev dependency to root
pnpm add -D some-dev-tool
```

## 🚨 **Troubleshooting Commands**

```bash
# If WASM functions not available:
pnpm run build:wasm     # Rebuild + copy WASM
# Then hard refresh browser (Ctrl+Shift+R)

# If dev server won't start:
pkill -f "vite"         # Kill any stuck processes
pnpm dev                # Restart

# If TypeScript errors:
pnpm run lint           # Check linting
pnpm run format         # Auto-format code
```

## 📁 **Key File Locations**

- **WASM Source**: `crates/core/src/lib.rs`
- **WASM Build Output**: `crates/core/pkg/`
- **WASM Runtime Location**: `packages/web-ui/src/wasm/`
- **Main UI**: `packages/web-ui/src/App.tsx`
- **Build Scripts**: `package.json` (root)

## 💡 **Pro Tips**

1. **Always use `pnpm run build:wasm`** instead of manual wasm-pack - it auto-copies files
2. **Hard refresh (Ctrl+Shift+R)** when WASM changes don't appear
3. **Check browser console** for WASM loading errors
4. **Use `pnpm dev`** for development - it rebuilds WASM automatically
5. **If widgets break**, it's usually a WASM update issue - rebuild and hard refresh

## 🎯 **Common Workflows**

### Starting Development
```bash
pnpm install    # First time only
pnpm dev        # Start development
```

### After Rust Changes
```bash
pnpm run build:wasm    # Rebuild WASM
# Hard refresh browser (Ctrl+Shift+R)
```

### Full Clean Build
```bash
rm -rf node_modules packages/*/node_modules crates/core/pkg
pnpm install
pnpm run build:wasm
pnpm dev
```

### Deployment Build
```bash
pnpm build      # Builds everything for production
```

---

**Note**: This project uses a Rust + WebGPU core with SolidJS frontend. The WASM build step is critical for any Rust changes to take effect in the browser.
