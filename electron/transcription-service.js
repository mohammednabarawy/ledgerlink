import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

const MODELS = {
  'tiny': 'ggml-tiny.bin',
  'base': 'ggml-base.bin',
  'small': 'ggml-small.bin',
  'medium': 'ggml-medium.bin',
  'large': 'ggml-large-v3.bin'
};

const BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

function runProcess(command, args = [], options = {}) {
  const { timeoutMs = 30000, cwd } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function findCommand(candidates, probeArgs = ['--help']) {
  for (const candidate of candidates) {
    const result = await runProcess(candidate.command, [...(candidate.prefix || []), ...probeArgs], { timeoutMs: 8000 });
    if (result.ok || result.stdout || result.stderr) return candidate;
  }
  return null;
}

let cachedHardware = null;

export async function detectHardware() {
  if (cachedHardware) return cachedHardware;

  const hardware = {
    cpu: true,
    platform: process.platform,
    arch: process.arch,
    cores: os.cpus()?.length || null,
    gpuNames: [],
    hasNvidia: false,
  };

  const nvidia = await runProcess('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { timeoutMs: 6000 });
  if (nvidia.ok && nvidia.stdout.trim()) {
    hardware.gpuNames = nvidia.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    hardware.hasNvidia = hardware.gpuNames.length > 0;
  }

  if (process.platform === 'win32' && !hardware.gpuNames.length) {
    const gpuResult = await runProcess(
      'powershell',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'],
      { timeoutMs: 10000 },
    );
    if (gpuResult.ok) {
      hardware.gpuNames = gpuResult.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      hardware.hasNvidia = hardware.gpuNames.some(name => /nvidia/i.test(name));
    }
  }

  cachedHardware = hardware;
  return hardware;
}

function getModelsDir(userDataPath) {
  const modelsDir = path.join(userDataPath, 'whisper_models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

export function getDownloadedModels(userDataPath) {
  const modelsDir = getModelsDir(userDataPath);
  const downloaded = {};
  for (const [size, filename] of Object.entries(MODELS)) {
    const filePath = path.join(modelsDir, filename);
    downloaded[size] = fs.existsSync(filePath);
  }
  return downloaded;
}

export function downloadWhisperModel(modelSize, userDataPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (!MODELS[modelSize]) return reject(new Error('Invalid model size'));
    const filename = MODELS[modelSize];
    const url = BASE_URL + filename;
    const modelsDir = getModelsDir(userDataPath);
    const destination = path.join(modelsDir, filename);
    const tempDestination = destination + '.download';

    const file = fs.createWriteStream(tempDestination);
    
    // Simple redirect follower for HuggingFace
    function fetchUrl(fetchUrlStr) {
      https.get(fetchUrlStr, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return fetchUrl(response.headers.location);
        }
        
        if (response.statusCode !== 200) {
          fs.unlink(tempDestination, () => {});
          return reject(new Error(`Failed to download: ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'], 10);
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress && totalBytes) {
            onProgress({
              modelSize,
              progress: downloadedBytes / totalBytes,
              downloadedBytes,
              totalBytes
            });
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tempDestination, destination);
            resolve(destination);
          });
        });
      }).on('error', (err) => {
        fs.unlink(tempDestination, () => {});
        reject(err);
      });
    }
    
    fetchUrl(url);
  });
}

export async function detectWhisperCpp(userDataPath, profileModelSize) {
  const hardware = await detectHardware();
  const configured = process.env.LEDGERLINK_WHISPER_CPP;
  let candidates = [
    configured ? { command: configured, prefix: [] } : null,
  ];

  if (process.platform === 'win32') {
    if (hardware.hasNvidia) {
      candidates.push({ command: path.join(process.cwd(), 'tools', 'whisper.cpp', 'gpu', 'whisper-cli.exe'), prefix: [] });
    }
    candidates.push({ command: path.join(process.cwd(), 'tools', 'whisper.cpp', 'cpu', 'whisper-cli.exe'), prefix: [] });
  }

  candidates.push(
    { command: 'whisper-cli', prefix: [] },
    { command: 'whisper.cpp', prefix: [] },
    { command: path.join(process.cwd(), 'tools', 'whisper.cpp', 'whisper-cli.exe'), prefix: [] },
    { command: path.join(process.cwd(), 'tools', 'whisper.cpp', 'main.exe'), prefix: [] }
  );
  candidates = candidates.filter(Boolean);
  
  const binary = await findCommand(candidates, ['--help']);
  
  const size = profileModelSize || 'tiny';
  const modelsDir = getModelsDir(userDataPath);
  const modelPath = path.join(modelsDir, MODELS[size]);
  const hasModel = fs.existsSync(modelPath);

  return {
    available: !!binary && hasModel,
    binary: binary?.command || null,
    model: hasModel ? modelPath : null,
    reason: !binary
      ? 'whisper.cpp CLI was not found'
      : !hasModel
        ? `Whisper model '${size}' is not downloaded yet`
        : null,
  };
}

export async function detectTranscriptionStack(userDataPath, profileModelSize) {
  const [hardware, whisperCpp] = await Promise.all([
    detectHardware(),
    detectWhisperCpp(userDataPath, profileModelSize)
  ]);

  const engines = [
    {
      id: 'whisper.cpp',
      label: 'whisper.cpp',
      available: whisperCpp.available,
      local: true,
      supportsArabic: true,
      supportsEnglish: true,
      hardware: 'CPU, CUDA, Vulkan, ROCm depending on build',
      reason: whisperCpp.reason,
      binary: whisperCpp.binary,
      model: whisperCpp.model,
    }
  ];

  return {
    hardware,
    engines,
    recommended: engines.find(engine => engine.available)?.id || 'whisper.cpp',
  };
}

export async function extractAudio(inputPath, tempRoot) {
  const ffmpegCandidates = [
    { command: 'ffmpeg', prefix: ['-y'] }
  ];
  const ffmpeg = await findCommand(ffmpegCandidates, ['-version']);
  if (!ffmpeg) throw new Error('ffmpeg is required to process audio/video for transcription.');

  const outputPath = path.join(tempRoot, 'audio.wav');
  // whisper.cpp requires 16kHz, 16-bit, mono WAV
  const result = await runProcess(ffmpeg.command, [
    ...ffmpeg.prefix,
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outputPath
  ], { timeoutMs: 300000 });

  if (!result.ok) throw new Error(result.stderr || 'ffmpeg failed to extract audio');
  return outputPath;
}

export async function runTranscription(filePath, language = 'auto', options = {}) {
  const { onProgress, userDataPath, modelSize = 'tiny' } = options;
  
  const whisper = await detectWhisperCpp(userDataPath, modelSize);
  if (!whisper.available) {
    throw new Error(whisper.reason || 'Whisper.cpp is not available');
  }

  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp') || os.tmpdir(), 'ledgerlink-transcription-'));
  
  try {
    onProgress?.({ status: 'extracting audio', progress: 0.1 });
    const wavPath = await extractAudio(filePath, tempRoot);
    
    onProgress?.({ status: 'transcribing', progress: 0.3 });
    const args = [
      '-m', whisper.model,
      '-f', wavPath,
      '-l', language === 'eng+ara' ? 'auto' : language, // 'auto', 'en', 'ar' etc
      '--output-txt'
    ];

    const result = await runProcess(whisper.binary, args, { timeoutMs: 600000 }); // 10 minutes timeout
    if (!result.ok) throw new Error(result.stderr || 'Transcription failed');

    // whisper.cpp with --output-txt creates a file with .txt appended
    const txtPath = wavPath + '.txt';
    if (!fs.existsSync(txtPath)) {
      // sometimes stdout contains the text if file not written
      if (result.stdout.trim().length > 0) {
        return { text: result.stdout.trim(), confidence: 100 };
      }
      throw new Error('Transcription output not found');
    }
    
    const text = fs.readFileSync(txtPath, 'utf8').trim();
    onProgress?.({ status: 'complete', progress: 1.0 });

    return {
      text,
      confidence: 100, // whisper.cpp doesn't output overall confidence easily without parsing logs
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
