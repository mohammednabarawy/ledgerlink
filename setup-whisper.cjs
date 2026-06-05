const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CPU_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip';
const GPU_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.6/whisper-cublas-12.4.0-bin-x64.zip';

const toolsDir = path.join(__dirname, 'tools', 'whisper.cpp');
const cpuDir = path.join(toolsDir, 'cpu');
const gpuDir = path.join(toolsDir, 'gpu');

function fetchUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchUrl(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function setup() {
  if (!fs.existsSync(cpuDir)) fs.mkdirSync(cpuDir, { recursive: true });
  if (!fs.existsSync(gpuDir)) fs.mkdirSync(gpuDir, { recursive: true });

  console.log('Downloading CPU binary...');
  await fetchUrl(CPU_URL, path.join(toolsDir, 'cpu_new.zip'));
  
  console.log('Downloading GPU binary...');
  await fetchUrl(GPU_URL, path.join(toolsDir, 'gpu_new.zip'));

  console.log('Extracting CPU binary...');
  execSync(`tar -xf cpu_new.zip -C cpu`, { cwd: toolsDir });
  
  console.log('Extracting GPU binary...');
  execSync(`tar -xf gpu_new.zip -C gpu`, { cwd: toolsDir });

  console.log('Organizing files...');
  // Move files up one directory and delete the whisper-bin-x64 folders
  const cpuInner = path.join(cpuDir, 'whisper-bin-x64');
  if (fs.existsSync(cpuInner)) {
    fs.readdirSync(cpuInner).forEach(file => {
      fs.renameSync(path.join(cpuInner, file), path.join(cpuDir, file));
    });
    fs.rmSync(cpuInner, { recursive: true, force: true });
  }

  const gpuInner = path.join(gpuDir, 'whisper-cublas-12.4.0-bin-x64');
  if (fs.existsSync(gpuInner)) {
    fs.readdirSync(gpuInner).forEach(file => {
      fs.renameSync(path.join(gpuInner, file), path.join(gpuDir, file));
    });
    fs.rmSync(gpuInner, { recursive: true, force: true });
  }

  console.log('Cleaning up zip files...');
  fs.unlinkSync(path.join(toolsDir, 'cpu_new.zip'));
  fs.unlinkSync(path.join(toolsDir, 'gpu_new.zip'));

  console.log('Setup complete! The app will now automatically use the GPU binary if an NVIDIA GPU is detected.');
}

setup().catch(console.error);
