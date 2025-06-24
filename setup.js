#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up tldraw-ng...');

// Check if Rust is installed
try {
  execSync('rustc --version', { stdio: 'ignore' });
  console.log('✅ Rust is installed');
} catch (error) {
  console.error('❌ Rust is not installed. Please install Rust from https://rustup.rs/');
  process.exit(1);
}

// Check if wasm-pack is installed
try {
  execSync('wasm-pack --version', { stdio: 'ignore' });
  console.log('✅ wasm-pack is installed');
} catch (error) {
  console.log('📦 Installing wasm-pack...');
  try {
    execSync('cargo install wasm-pack', { stdio: 'inherit' });
    console.log('✅ wasm-pack installed');
  } catch (installError) {
    console.error('❌ Failed to install wasm-pack');
    process.exit(1);
  }
}

// Add wasm32 target
console.log('🎯 Adding wasm32 target...');
try {
  execSync('rustup target add wasm32-unknown-unknown', { stdio: 'inherit' });
  console.log('✅ wasm32 target added');
} catch (error) {
  console.warn('⚠️ Failed to add wasm32 target (might already be installed)');
}

// Build WASM package
console.log('🔨 Building WASM package...');
try {
  execSync('cd crates/core && wasm-pack build --target web --out-dir pkg', { stdio: 'inherit' });
  console.log('✅ WASM package built');
} catch (error) {
  console.error('❌ Failed to build WASM package');
  process.exit(1);
}

// Check if pkg directory was created
const pkgPath = path.join(__dirname, 'crates', 'core', 'pkg');
if (!fs.existsSync(pkgPath)) {
  console.error('❌ WASM package directory not found');
  process.exit(1);
}

console.log('✅ Setup complete! You can now run:');
console.log('   pnpm install');
console.log('   pnpm dev');
