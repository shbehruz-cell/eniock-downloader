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

    // MUHIM: -f flagini BERMANG — --dump-json bilan -f bersa faqat 1 ta format keladi.
    // -f siz barcha mavjud formatlar ro'yxati (360p, 480p, 720p, 1080p...) keladi.
    const cmd = `"${ytDlpPath}" ${primaryFlags} --dump-json "${sanitizedUrl}"`;
    
    let stdoutData = '';
    try {
      const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
      stdoutData = stdout;
    } catch (execError: any) {
      console.warn('Primary client failed, trying ios,android fallback:', execError.message);
      const fallbackFlags = await getExtraYtDlpFlags('ios,android,tv_embedded');
      const retryCmd = `"${ytDlpPath}" ${fallbackFlags} --dump-json "${sanitizedUrl}"`;
      try {
        const { stdout } = await execPromise(retryCmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
        stdoutData = stdout;
      } catch (retryErr: any) {
        console.warn('Secondary client failed, trying web fallback:', retryErr.message);
        const basicFlags = await getExtraYtDlpFlags('web,mweb');
        const finalCmd = `"${ytDlpPath}" ${basicFlags} --dump-json "${sanitizedUrl}"`;
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

    const rawFormats: any[] = output.formats || [];

    // 1. Har bir format uchun quality label aniqlash
    function getQualityLabel(fmt: any): string | null {
      const height = fmt.height || 0;
      if (height >= 2160) return '2160p';
      if (height >= 1440) return '1440p';
      if (height >= 1080) return '1080p';
      if (height >= 720)  return '720p';
      if (height >= 480)  return '480p';
      if (height >= 360)  return '360p';
      if (height >= 240)  return '240p';
      if (height > 0)     return '144p';
      return null; // Height yo'q — o'tkazib yuboramiz
    }

    // 2. Video formatlarini ajratib olish
    //    - vcodec === 'none' => audio-only => o'tkazib yuboramiz
    //    - acodec === 'none' => video-only (adaptive) => saqlаymiz, download vaqtida audio biriktiriladi
    for (const fmt of rawFormats) {
      if (!fmt.url) continue;
      if (fmt.vcodec === 'none') continue; // Audio-only => skip

      const quality = getQualityLabel(fmt);
      if (!quality) continue; // Height aniqlanmagan => skip

      // Har bir sifat darajasi uchun bitta eng yaxshi formatni saqlaymiz
      // Ustunlik: audio bor formatlar > audio yo'q (adaptive) formatlar
      const hasAudio = fmt.acodec && fmt.acodec !== 'none';
      const key = `${quality}_${fmt.ext || 'mp4'}`;

      if (seenQualities.has(key)) {
        // Agar oldin audio-yoq format saqlangan bo'lsa va hozir audio bor bo'lsa — almashtir
        const existingIdx = formats.findIndex(f => f.quality === quality && f.ext === (fmt.ext || 'mp4'));
        if (existingIdx >= 0 && hasAudio && formats[existingIdx].acodec === 'none') {
          const size = fmt.filesize || fmt.filesize_approx || 0;
          formats[existingIdx] = {
            quality,
            resolution: fmt.resolution || (fmt.width && fmt.height ? `${fmt.width}x${fmt.height}` : quality),
            filesize: size,
            filesizeFormatted: formatFilesize(size),
            url: fmt.url,
            ext: fmt.ext || 'mp4',
            vcodec: fmt.vcodec || 'h264',
            acodec: fmt.acodec || 'aac',
            formatId: fmt.format_id || '',
          };
        }
        continue;
      }

      seenQualities.add(key);
      const size = fmt.filesize || fmt.filesize_approx || 0;
      formats.push({
        quality,
        resolution: fmt.resolution || (fmt.width && fmt.height ? `${fmt.width}x${fmt.height}` : quality),
        filesize: size,
        filesizeFormatted: formatFilesize(size),
        url: fmt.url,
        ext: fmt.ext || 'mp4',
        vcodec: fmt.vcodec || 'h264',
        acodec: fmt.acodec || 'aac',
        formatId: fmt.format_id || '',
      });
    }

    // 3. Fallback: Agar hech narsa topilmasa, top-level output.url ni olamiz
    if (formats.length === 0 && output.url) {
      const height = output.height || 0;
      const quality = height >= 720 ? `${height}p` : '360p';
      formats.push({
        quality,
        resolution: output.resolution || `${output.width || '?'}x${height || '?'}`,
        filesize: 0,
        filesizeFormatted: 'Avto',
        url: output.url,
        ext: output.ext || 'mp4',
        vcodec: output.vcodec || 'h264',
        acodec: output.acodec || 'aac',
        formatId: output.format_id || '',
      });
    }

    // Sifatlarni yuqoridan pastga saralash
    const qualityOrder: Record<string, number> = {
      '2160p': 8, '1440p': 7, '1080p': 6, '720p': 5,
      '480p': 4, '360p': 3, '240p': 2, '144p': 1
    };
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
