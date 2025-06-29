#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting tldraw-ng with external access...\n');

// Check if ngrok is installed
function checkNgrok() {
  return new Promise((resolve) => {
    exec('ngrok version', (error) => {
      resolve(!error);
    });
  });
}

// Install ngrok if not present
function installNgrok() {
  return new Promise((resolve, reject) => {
    console.log('📦 Installing ngrok...');
    const install = spawn('npm', ['install', '-g', 'ngrok'], { 
      stdio: 'inherit',
      shell: true 
    });
    
    install.on('close', (code) => {
      if (code === 0) {
        console.log('✅ ngrok installed successfully\n');
        resolve();
      } else {
        reject(new Error('Failed to install ngrok'));
      }
    });
  });
}

// Start the dev server
function startDevServer() {
  return new Promise((resolve, reject) => {
    console.log('🔧 Starting dev server...');
    
    const devServer = spawn('pnpm', ['run', 'dev', '--host', '0.0.0.0'], {
      stdio: 'pipe',
      shell: true,
      cwd: path.resolve(__dirname, '..')
    });

    let serverReady = false;
    
    devServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      
      // Look for the server ready message
      if (output.includes('Local:') && output.includes('3000') && !serverReady) {
        serverReady = true;
        console.log('✅ Dev server is ready!\n');
        resolve({ process: devServer, port: 3000 });
      } else if (output.includes('Local:') && output.includes('3001') && !serverReady) {
        serverReady = true;
        console.log('✅ Dev server is ready!\n');
        resolve({ process: devServer, port: 3001 });
      }
    });

    devServer.stderr.on('data', (data) => {
      console.error(data.toString());
    });

    devServer.on('close', (code) => {
      if (code !== 0 && !serverReady) {
        reject(new Error(`Dev server failed with code ${code}`));
      }
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      if (!serverReady) {
        reject(new Error('Dev server took too long to start'));
      }
    }, 60000);
  });
}

// Start ngrok tunnel
function startNgrok(port) {
  return new Promise((resolve, reject) => {
    console.log(`🌐 Starting ngrok tunnel on port ${port}...`);
    
    const ngrok = spawn('ngrok', ['http', port.toString()], {
      stdio: 'pipe',
      shell: true
    });

    let tunnelReady = false;
    
    // Give ngrok a moment to start, then get the URL
    setTimeout(() => {
      exec('curl -s http://localhost:4040/api/tunnels', (error, stdout) => {
        if (error) {
          reject(new Error('Failed to get ngrok tunnel info'));
          return;
        }
        
        try {
          const data = JSON.parse(stdout);
          const tunnel = data.tunnels.find(t => t.proto === 'https');
          
          if (tunnel) {
            const url = tunnel.public_url;
            console.log('🎉 SUCCESS! External access ready:\n');
            console.log(`🔗 HTTPS URL: ${url}`);
            console.log(`🔗 Local URL: http://localhost:${port}\n`);
            console.log('📱 Share the HTTPS URL with others for full functionality!');
            console.log('🍎 Mac users will have clipboard access via HTTPS\n');
            console.log('Press Ctrl+C to stop both servers\n');
            tunnelReady = true;
            resolve({ process: ngrok, url });
          } else {
            reject(new Error('No HTTPS tunnel found'));
          }
        } catch (e) {
          reject(new Error('Failed to parse ngrok response'));
        }
      });
    }, 3000);

    ngrok.on('close', (code) => {
      if (code !== 0 && !tunnelReady) {
        reject(new Error(`ngrok failed with code ${code}`));
      }
    });
  });
}

// Main function
async function main() {
  try {
    // Check and install ngrok if needed
    const hasNgrok = await checkNgrok();
    if (!hasNgrok) {
      await installNgrok();
    }

    // Start dev server
    const { process: devProcess, port } = await startDevServer();
    
    // Start ngrok tunnel
    const { process: ngrokProcess, url } = await startNgrok(port);

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down...');
      devProcess.kill();
      ngrokProcess.kill();
      process.exit(0);
    });

    // Keep the script running
    process.stdin.resume();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
