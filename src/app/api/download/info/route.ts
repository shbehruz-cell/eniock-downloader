import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ensureYtDlpBinary, getExtraYtDlpFlags } from '@/lib/ytdlp-helper';

const execPromise = promisify(exec);

interface VideoFormat {
  quality: string;
  resolution: string;
  filesize: number;
  filesizeFormatted: string;
  url: string;
  ext: string;
  vcodec: string;
  acodec: string;
  formatId?: string;
}

interface VideoInfo {
  title: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string;
  url: string;
  platform: string;
  formats: VideoFormat[];
}

function formatDuration(seconds: number): string {
  if (!seconds) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatFilesize(bytes: number): string {
  if (!bytes || bytes === 0) return 'Avto';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function detectPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com|instagr\.am/i.test(url)) return 'instagram';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/pinterest\.com|pin\.it/i.test(url)) return 'pinterest';
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return 'rednote';
  return 'general';
}



export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL kiritilishi shart' }, { status: 400 });
    }

    const sanitizedUrl = url.trim();
    const platform = detectPlatform(sanitizedUrl);

    const ytDlpPath = await ensureYtDlpBinary();
    const primaryFlags = await getExtraYtDlpFlags('tv_embedded,web_creator,ios');

    const cmd = `"${ytDlpPath}" ${primaryFlags} --dump-json -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${sanitizedUrl}"`;
    
    let stdoutData = '';
    try {
      const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
      stdoutData = stdout;
    } catch (execError: any) {
      console.warn('Primary client failed, trying ios,android fallback:', execError.message);
      const fallbackFlags = await getExtraYtDlpFlags('ios,android,tv_embedded');
      const retryCmd = `"${ytDlpPath}" ${fallbackFlags} --dump-json -f "best" "${sanitizedUrl}"`;
      try {
        const { stdout } = await execPromise(retryCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
        stdoutData = stdout;
      } catch (retryErr: any) {
        console.warn('Secondary client failed, trying web fallback:', retryErr.message);
        const basicFlags = await getExtraYtDlpFlags('web,mweb');
        const finalCmd = `"${ytDlpPath}" ${basicFlags} --dump-json -f "best" "${sanitizedUrl}"`;
        const { stdout } = await execPromise(finalCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
        stdoutData = stdout;
      }
    }

    const output = JSON.parse(stdoutData);
    if (!output) {
      throw new Error('Video tahlilidan JSON ma\'lumot olinmadi');
    }

    const formats: VideoFormat[] = [];
    const seenQualities = new Set<string>();

    // 1. Video formatlarini ajratib olish (tarkibida audio bor yoki yo'q)
    const rawFormats = output.formats || [];
    for (const fmt of rawFormats) {
      if (!fmt.url) continue;
      // Audio-only bo'lgan formatlarni o'tkazib yuboramiz, faqat video bo'lganlarini olamiz
      if (fmt.vcodec === 'none') continue;
      
      const height = fmt.height || 0;
      let quality = '720p'; // Default quality if height is missing
      if (height >= 2160) quality = '2160p';
      else if (height >= 1440) quality = '1440p';
      else if (height >= 1080) quality = '1080p';
      else if (height >= 720) quality = '720p';
      else if (height >= 480) quality = '480p';
      else if (height >= 360) quality = '360p';
      else if (height > 0) quality = '360p';

      const key = `${quality}_${fmt.ext || 'mp4'}`;
      if (seenQualities.has(key)) continue;
      seenQualities.add(key);

      const size = fmt.filesize || fmt.filesize_approx || 0;

      formats.push({
        quality,
        resolution: fmt.resolution || (fmt.width ? `${fmt.width}x${height}` : 'Avto'),
        filesize: size,
        filesizeFormatted: formatFilesize(size),
        url: fmt.url,
        ext: fmt.ext || 'mp4',
        vcodec: fmt.vcodec || 'h264',
        acodec: fmt.acodec || 'aac',
        formatId: fmt.format_id || '',
      });
    }

    // 2. Fallback: Sifat o'lchamlari/koderlari aniqlanmagan, lekin video havolasi bor barcha formatlarni tekshirish
    if (formats.length === 0) {
      for (const fmt of rawFormats) {
        if (!fmt.url || fmt.vcodec === 'none') continue;
        
        const quality = '720p';
        const key = `${quality}_${fmt.ext || 'mp4'}`;
        if (seenQualities.has(key)) continue;
        seenQualities.add(key);

        const size = fmt.filesize || fmt.filesize_approx || 0;
        formats.push({
          quality,
          resolution: fmt.resolution || 'Avto',
          filesize: size,
          filesizeFormatted: formatFilesize(size),
          url: fmt.url,
          ext: fmt.ext || 'mp4',
          vcodec: fmt.vcodec || 'h264',
          acodec: fmt.acodec || 'aac',
          formatId: fmt.format_id || '',
        });
      }
    }

    // 3. Fallback: Agar umuman formatlar ro'yxati shakllanmasa, top-level output.url ni olamiz
    if (formats.length === 0 && output.url) {
      formats.push({
        quality: '720p',
        resolution: 'Standart',
        filesize: 0,
        filesizeFormatted: 'Avto',
        url: output.url,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        formatId: '',
      });
    }

    // Sifatlarni saralash
    const qualityOrder: Record<string, number> = { '2160p': 6, '1440p': 5, '1080p': 4, '720p': 3, '480p': 2, '360p': 1 };
    formats.sort((a, b) => (qualityOrder[b.quality] ?? 0) - (qualityOrder[a.quality] ?? 0));

    const videoInfo: VideoInfo = {
      title: output.title || output.fulltitle || 'Untitled Video',
      duration: output.duration || 0,
      durationFormatted: formatDuration(output.duration || 0),
      thumbnail: output.thumbnail || output.thumbnails?.[0]?.url || '',
      url: sanitizedUrl,
      platform: platform.toUpperCase(),
      formats,
    };

    return NextResponse.json({ data: videoInfo });

  } catch (error: any) {
    console.error('Audio-Video merger extraction error:', error);
    return NextResponse.json(
      { error: `Video tahlil qilib bo'lmadi: ${error.message || 'Dvijok ishga tushmadi'}` },
      { status: 500 }
    );
  }
}
