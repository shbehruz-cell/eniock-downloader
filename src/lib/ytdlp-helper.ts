import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function ensureYtDlpBinary(): Promise<string> {
  const isWindows = process.platform === 'win32';

  // 1. Avval tizimda o'rnatilgan yt-dlp bor-yo'qligini tekshiramiz
  // (Railway nixpacks orqali o'rnatadi, yoki Linux serverlarda mavjud bo'lishi mumkin)
  if (!isWindows) {
    try {
      const { stdout } = await execPromise('which yt-dlp');
      const systemPath = stdout.trim();
      if (systemPath && fs.existsSync(systemPath)) {
        console.log(`Using system yt-dlp at: ${systemPath}`);
        return systemPath;
      }
    } catch {
      // Tizimda yo'q, davom etamiz
    }

    // /usr/bin yoki /usr/local/bin da bor-yo'qligini tekshiramiz
    const commonPaths = ['/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/run/current-system/sw/bin/yt-dlp'];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        console.log(`Found yt-dlp at: ${p}`);
        return p;
      }
    }
  }

  // 2. Windows uchun yoki tizimda topilmasa — /tmp/bin yoki bin/ papkasiga yuklaymiz
  const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';

  // Vercel va Railway uchun /tmp/bin, local uchun bin/
  const isReadOnlyFs = !!process.env.VERCEL || !!process.env.RAILWAY_ENVIRONMENT || process.platform !== 'win32';
  const binDir = isReadOnlyFs
    ? path.join('/tmp', 'bin')
    : path.join(process.cwd(), 'bin');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const binaryPath = path.join(binDir, binaryName);
  if (fs.existsSync(binaryPath)) {
    console.log(`Using cached yt-dlp at: ${binaryPath}`);
    return binaryPath;
  }

  // 3. GitHub Releases dan yuklab olamiz
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

  // Unix/Linux uchun executable permission berish
  if (!isWindows) {
    try {
      fs.chmodSync(binaryPath, '755');
    } catch (chmodErr) {
      console.error('chmod 755 berishda xato:', chmodErr);
    }
  }

  console.log(`yt-dlp downloaded successfully to: ${binaryPath}`);
  return binaryPath;
}
