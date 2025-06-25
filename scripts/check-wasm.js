#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sourceDir = path.join(__dirname, '..', 'crates', 'core', 'pkg');
const targetDir = path.join(__dirname, '..', 'packages', 'web-ui', 'src', 'wasm');

console.log('🔍 Checking WASM file sync...');

function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function checkFilesInSync() {
  if (!fs.existsSync(sourceDir)) {
    console.log('⚠️  Source WASM directory not found. Run `pnpm run build:wasm` first.');
    return false;
  }

  if (!fs.existsSync(targetDir)) {
    console.log('⚠️  Target WASM directory not found.');
    return false;
  }

  const sourceFiles = fs.readdirSync(sourceDir).filter(f => 
    f.endsWith('.js') || f.endsWith('.wasm') || f.endsWith('.d.ts')
  );

  let allInSync = true;
  let outOfSyncFiles = [];

  for (const file of sourceFiles) {
    const sourcePath = path.join(sourceDir, file);
    const targetPath = path.join(targetDir, file);

    const sourceHash = getFileHash(sourcePath);
    const targetHash = getFileHash(targetPath);

    if (sourceHash !== targetHash) {
      allInSync = false;
      outOfSyncFiles.push(file);
    }
  }

  if (allInSync) {
    console.log('✅ All WASM files are in sync');
    return true;
  } else {
    console.log('❌ WASM files are out of sync:');
    outOfSyncFiles.forEach(file => console.log(`   - ${file}`));
    console.log('\n💡 Run `pnpm run copy:wasm` to sync files');
    return false;
  }
}

const isInSync = checkFilesInSync();
process.exit(isInSync ? 0 : 1);
