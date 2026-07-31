import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

async function canExecute(binaryPath: string): Promise<boolean> {
  try {
    const { stdout } = await execPromise(`"${binaryPath}" --version`, { timeout: 10000 });
    return !!stdout && stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getFfmpegPath(): Promise<string | null> {
  const isWindows = process.platform === 'win32';

  // 1. Direct system check
  try {
    const checkCmd = isWindows ? 'where ffmpeg' : 'command -v ffmpeg || which ffmpeg';
    const { stdout } = await execPromise(checkCmd, { timeout: 5000 });
    const firstPath = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (firstPath && fs.existsSync(firstPath)) {
      return firstPath;
    }
  } catch {}

  // 2. Common Linux/Nix paths
  const commonPaths = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/run/current-system/sw/bin/ffmpeg',
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/home/railway/.nix-profile/bin/ffmpeg',
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 3. Local temp/bin directory
  const binDir = (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || !isWindows)
    ? path.join('/tmp', 'bin')
    : path.join(/*turbopackIgnore: true*/ process.cwd(), 'bin');
  const localBinary = path.join(binDir, isWindows ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(localBinary)) {
    return localBinary;
  }

  return null;
}

export async function getFfmpegLocationArg(): Promise<string> {
  const ffmpegPath = await getFfmpegPath();
  if (ffmpegPath) {
    return `--ffmpeg-location "${ffmpegPath}"`;
  }
  return '';
}

export async function ensureYtDlpBinary(): Promise<string> {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  // 1. Direct system PATH check
  try {
    const { stdout } = await execPromise('yt-dlp --version', { timeout: 5000 });
    if (stdout && stdout.trim().length > 0) {
      console.log('Using system yt-dlp from PATH');
      return 'yt-dlp';
    }
  } catch {}

  try {
    const checkCmd = isWindows ? 'where yt-dlp' : 'command -v yt-dlp || which yt-dlp';
    const { stdout } = await execPromise(checkCmd, { timeout: 5000 });
    const systemPath = stdout.trim().split(/\r?\n/)[0]?.trim();
    if (systemPath && fs.existsSync(systemPath) && await canExecute(systemPath)) {
      console.log(`Using system yt-dlp at: ${systemPath}`);
      return systemPath;
    }
  } catch {}

  // 2. Common Linux & Nix system paths search
  if (!isWindows) {
    const commonPaths = [
      '/usr/bin/yt-dlp',
      '/usr/local/bin/yt-dlp',
      '/run/current-system/sw/bin/yt-dlp',
      '/root/.nix-profile/bin/yt-dlp',
      '/nix/var/nix/profiles/default/bin/yt-dlp',
      '/home/railway/.nix-profile/bin/yt-dlp',
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p) && await canExecute(p)) {
        console.log(`Found working yt-dlp at: ${p}`);
        return p;
      }
    }
  }

  // 3. Fallback: Standalone binary download
  // CRITICAL: On Linux, use yt-dlp_linux (standalone PyInstaller executable with bundled Python)
  const binaryName = isWindows ? 'yt-dlp.exe' : (isMac ? 'yt-dlp_macos' : 'yt-dlp_linux');

  const isReadOnlyFs = !!process.env.VERCEL || !!process.env.RAILWAY_ENVIRONMENT || !isWindows;
  const binDir = isReadOnlyFs
    ? path.join('/tmp', 'bin')
    : path.join(/*turbopackIgnore: true*/ process.cwd(), 'bin');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const binaryPath = path.join(binDir, binaryName);

  // Validate existing cached target binary
  if (fs.existsSync(binaryPath)) {
    if (await canExecute(binaryPath)) {
      console.log(`Using cached working yt-dlp at: ${binaryPath}`);
      return binaryPath;
    } else {
      console.log(`Cached yt-dlp at ${binaryPath} failed execution check. Removing broken file...`);
      try { fs.unlinkSync(binaryPath); } catch {}
    }
  }

  // Clean up old broken zipapp script at /tmp/bin/yt-dlp if it exists
  const legacyBinaryPath = path.join(binDir, 'yt-dlp');
  if (legacyBinaryPath !== binaryPath && fs.existsSync(legacyBinaryPath)) {
    if (await canExecute(legacyBinaryPath)) {
      console.log(`Using legacy cached yt-dlp at: ${legacyBinaryPath}`);
      return legacyBinaryPath;
    } else {
      console.log(`Removing broken legacy binary at: ${legacyBinaryPath}`);
      try { fs.unlinkSync(legacyBinaryPath); } catch {}
    }
  }

  // 4. Download latest standalone release from GitHub
  console.log(`Downloading standalone ${binaryName} binary to ${binDir}...`);
  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  if (isWindows) {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (isMac) {
    downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`yt-dlp binar faylini GitHub releases-dan yuklab olib bo'lmadi: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(binaryPath, buffer);

  if (!isWindows) {
    try {
      fs.chmodSync(binaryPath, '755');
    } catch (chmodErr) {
      console.error('chmod 755 error:', chmodErr);
    }
  }

  if (!await canExecute(binaryPath)) {
    throw new Error(`Downloaded yt-dlp binary at ${binaryPath} could not be executed.`);
  }

  console.log(`yt-dlp downloaded and verified successfully at: ${binaryPath}`);
  return binaryPath;
}

