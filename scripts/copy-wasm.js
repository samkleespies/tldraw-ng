#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'crates', 'core', 'pkg');
const targetDir = path.join(__dirname, '..', 'packages', 'web-ui', 'src', 'wasm');

console.log('📦 Copying WASM files...');
console.log(`   From: ${sourceDir}`);
console.log(`   To:   ${targetDir}`);

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('✅ Created target directory');
}

// Copy all files from source to target
try {
  const files = fs.readdirSync(sourceDir);
  let copiedCount = 0;
  
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);
    
    // Skip directories
    if (fs.statSync(sourcePath).isDirectory()) {
      continue;
    }
    
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`   ✓ ${file}`);
    copiedCount++;
  }
  
  console.log(`✅ Successfully copied ${copiedCount} WASM files`);
} catch (error) {
  console.error('❌ Error copying WASM files:', error.message);
  process.exit(1);
}
