// Script to copy WASM files to public directory
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const srcDir = path.join(__dirname, '../../../crates/core/pkg');
const destDir = path.join(__dirname, 'crates/core/pkg');

// Create destination directory
fs.mkdirSync(destDir, { recursive: true });

// Copy files
const files = ['core.js', 'core_bg.wasm', 'core.d.ts', 'core_bg.wasm.d.ts'];

files.forEach(file => {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
});

console.log('WASM files copied to public directory');
