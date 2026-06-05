/**
 * Ensures whisper.cpp CPU binaries exist before packaging (GPU binaries are optional and large).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CPU_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip';
const toolsDir = path.join(__dirname, '..', 'tools', 'whisper.cpp');
const cpuReleaseDir = path.join(toolsDir, 'cpu', 'Release');
const cpuCli = path.join(cpuReleaseDir, 'whisper-cli.exe');

function fetchUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        return fetchUrl(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`Download failed (${response.statusCode})`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function main() {
  if (fs.existsSync(cpuCli)) {
    console.log('whisper.cpp CPU binary already present:', cpuCli);
    return;
  }

  fs.mkdirSync(cpuReleaseDir, { recursive: true });
  const zipPath = path.join(toolsDir, 'cpu-release.zip');

  console.log('Downloading whisper.cpp CPU binaries...');
  await fetchUrl(CPU_URL, zipPath);

  console.log('Extracting CPU binaries...');
  execSync(`tar -xf "${zipPath}" -C "${path.join(toolsDir, 'cpu')}"`, { stdio: 'inherit' });

  const inner = path.join(toolsDir, 'cpu', 'whisper-bin-x64');
  if (fs.existsSync(inner)) {
    for (const file of fs.readdirSync(inner)) {
      const from = path.join(inner, file);
      const to = path.join(cpuReleaseDir, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
    }
    fs.rmSync(inner, { recursive: true, force: true });
  }

  fs.unlinkSync(zipPath);

  if (!fs.existsSync(cpuCli)) {
    throw new Error('whisper-cli.exe was not found after extraction');
  }

  console.log('whisper.cpp CPU binaries ready at', cpuReleaseDir);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
