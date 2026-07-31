import path from 'path';
import fs from 'fs';

export async function ensureYtDlpBinary(): Promise<string> {
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  
  // On Vercel, the root directory is read-only. We must write to /tmp
  // Otherwise, we write to process.cwd()/bin for local dev
  const isVercel = !!process.env.VERCEL;
  const binDir = isVercel ? path.join('/tmp', 'bin') : path.join(process.cwd(), 'bin');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const binaryPath = path.join(binDir, binaryName);
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  console.log(`Downloading ${binaryName} binary to ${binDir}...`);
  const downloadUrl = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`yt-dlp binar faylini GitHub releases-dan yuklab olib bo'lmadi: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(binaryPath, buffer);

  // Set executable permission on Unix/Linux
  if (!isWindows) {
    try {
      fs.chmodSync(binaryPath, '755');
    } catch (chmodErr) {
      console.error('Failed to set execute permission (chmod 755) on yt-dlp:', chmodErr);
    }
  }
  
  return binaryPath;
}
