import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(electronDir, '..');

export function isPackagedApp() {
  return app?.isPackaged === true;
}

export function getProjectRoot() {
  return projectRoot;
}

export function getElectronDir() {
  return electronDir;
}

export function getWhisperCppDir() {
  if (isPackagedApp()) {
    return path.join(process.resourcesPath, 'whisper-cpp');
  }
  return path.join(projectRoot, 'tools', 'whisper.cpp');
}

export function listWhisperCliCandidates(preferGpu = false) {
  const root = getWhisperCppDir();
  const subdirs = [];

  if (preferGpu && process.platform === 'win32') {
    subdirs.push('gpu/Release', 'gpu');
  }
  if (process.platform === 'win32') {
    subdirs.push('cpu/Release', 'cpu');
  } else {
    subdirs.push('cpu', 'gpu');
  }

  const names = process.platform === 'win32'
    ? ['whisper-cli.exe', 'main.exe']
    : ['whisper-cli', 'main'];

  const candidates = [];
  for (const sub of subdirs) {
    for (const name of names) {
      candidates.push(path.join(root, sub, name));
    }
  }
  return candidates;
}

export function findExistingWhisperCli(preferGpu = false) {
  for (const candidate of listWhisperCliCandidates(preferGpu)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
