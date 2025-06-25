#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const wasmPkgDir = path.join(__dirname, '..', 'crates', 'core', 'pkg');

console.log('👀 Watching for WASM changes...');
console.log(`   Watching: ${wasmPkgDir}`);
console.log('   Press Ctrl+C to stop');

// Initial copy
try {
  execSync('node scripts/copy-wasm.js', { stdio: 'inherit' });
} catch (error) {
  console.error('❌ Initial copy failed:', error.message);
}

// Watch for changes
if (fs.existsSync(wasmPkgDir)) {
  fs.watch(wasmPkgDir, { recursive: false }, (eventType, filename) => {
    if (filename && (filename.endsWith('.js') || filename.endsWith('.wasm') || filename.endsWith('.d.ts'))) {
      console.log(`\n🔄 WASM file changed: ${filename}`);
      try {
        execSync('node scripts/copy-wasm.js', { stdio: 'inherit' });
        console.log('✅ Auto-copied WASM files');
      } catch (error) {
        console.error('❌ Auto-copy failed:', error.message);
      }
    }
  });
} else {
  console.log('⚠️  WASM pkg directory not found. Run `pnpm run build:wasm` first.');
}
