import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ensureYtDlpBinary, getExtraYtDlpArgs, execFilePromise } from '@/lib/ytdlp-helper';

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

function getQualityLabel(height: number): string | null {
  if (height >= 2160) return '2160p';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720)  return '720p';
  if (height >= 480)  return '480p';
  if (height >= 360)  return '360p';
  if (height >= 240)  return '240p';
  if (height > 0)     return '144p';
  return null;
}

function parseYtdlpFormats(output: any, sanitizedUrl: string, platform: string): VideoInfo {
  const rawFormats: any[] = output.formats || [];

  // quality -> eng yaxshi format (audio bor bo'lsa ustun)
  const bestByQuality = new Map<string, VideoFormat>();

  for (const fmt of rawFormats) {
    if (!fmt.url) continue;
    // Faqat audio-only (vcodec string 'none') ni o'tkazib yuboramiz.
    // vcodec === null yoki undefined bo'lsa — bu video formatidir!
    if (fmt.vcodec === 'none') continue;

    // height aniqlaymiz (format_note dan ham olishga harakat qilamiz)
    let height = fmt.height || 0;
    if (height === 0 && fmt.format_note) {
      const m2 = fmt.format_note.match(/(\d+)p/);
      if (m2) height = parseInt(m2[1]);
    }

    const quality = getQualityLabel(height);
    if (!quality) continue;

    const hasAudio = fmt.acodec && fmt.acodec !== 'none';
    const existing = bestByQuality.get(quality);
    const size = fmt.filesize || fmt.filesize_approx || 0;

    const entry: VideoFormat = {
      quality,
      resolution: fmt.resolution || (fmt.width && fmt.height ? `${fmt.width}x${fmt.height}` : quality),
      filesize: size,
      filesizeFormatted: formatFilesize(size),
      url: fmt.url,
      ext: fmt.ext || 'mp4',
      vcodec: fmt.vcodec || 'h264',
      acodec: fmt.acodec || 'none',
      formatId: fmt.format_id || '',
    };

    if (!existing) {
      bestByQuality.set(quality, entry);
    } else if (!existing.acodec || existing.acodec === 'none') {
      if (hasAudio) {
        // Audio bor versiyaga almashtiramiz
        bestByQuality.set(quality, entry);
      }
    }
  }

  const qualityOrder: Record<string, number> = {
    '2160p': 8, '1440p': 7, '1080p': 6, '720p': 5,
    '480p': 4, '360p': 3, '240p': 2, '144p': 1,
  };

  let formats = Array.from(bestByQuality.values())
    .sort((a, b) => (qualityOrder[b.quality] ?? 0) - (qualityOrder[a.quality] ?? 0));

  // Fallback: hech narsa topilmasa
  if (formats.length === 0 && output.url) {
    const h = output.height || 0;
    const q = getQualityLabel(h) || '360p';
    formats.push({
      quality: q,
      resolution: output.resolution || `${output.width || '?'}x${h || '?'}`,
      filesize: 0,
      filesizeFormatted: 'Avto',
      url: output.url,
      ext: output.ext || 'mp4',
      vcodec: output.vcodec || 'h264',
      acodec: output.acodec || 'aac',
      formatId: output.format_id || '',
    });
  }

  return {
    title: output.title || output.fulltitle || 'Untitled Video',
    duration: output.duration || 0,
    durationFormatted: formatDuration(output.duration || 0),
    thumbnail: output.thumbnail || output.thumbnails?.[output.thumbnails.length - 1]?.url || '',
    url: sanitizedUrl,
    platform: platform.toUpperCase(),
    formats,
  };
}

// ── RapidAPI YouTube fallback ──────────────────────────────────────────────
async function fetchYouTubeViaRapidAPI(videoUrl: string, platform: string): Promise<VideoInfo | null> {
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) return null;

  // YouTube video ID ni ajratib olamiz
  const match = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) return null;
  const videoId = match[1];

  try {
    // yt-api.p.rapidapi.com — video info va download URL larini qaytaradi
    const res = await fetch(`https://yt-api.p.rapidapi.com/dl?id=${videoId}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'yt-api.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!res.ok) {
      console.warn('RapidAPI yt-api response not ok:', res.status);
      return null;
    }

    const data = await res.json();
    if (!data || data.status === 'ERROR') {
      console.warn('RapidAPI yt-api returned error:', data?.message);
      return null;
    }

    const formats: VideoFormat[] = [];
    const seenQ = new Set<string>();

    // adaptiveFormats — yuqori sifatli video-only formatlar
    const adaptive: any[] = data.adaptiveFormats || [];
    for (const fmt of adaptive) {
      if (!fmt.url) continue;
      const mimeType: string = fmt.mimeType || '';
      if (!mimeType.startsWith('video/')) continue;

      const height = fmt.height || parseInt(fmt.qualityLabel) || 0;
      const quality = getQualityLabel(height);
      if (!quality) continue;

      const key = `${quality}_mp4`;
      if (seenQ.has(key)) continue;
      seenQ.add(key);

      const size = parseInt(fmt.contentLength || '0') || 0;
      formats.push({
        quality,
        resolution: fmt.qualityLabel || quality,
        filesize: size,
        filesizeFormatted: formatFilesize(size),
        url: fmt.url,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'none', // adaptive = video-only, audio alohida
        formatId: fmt.itag?.toString() || '',
      });
    }

    // formats — video+audio combined formatlar
    const combined: any[] = data.formats || [];
    for (const fmt of combined) {
      if (!fmt.url) continue;
      const mimeType: string = fmt.mimeType || '';
      if (!mimeType.startsWith('video/')) continue;

      const height = fmt.height || 0;
      const quality = getQualityLabel(height);
      if (!quality) continue;

      const key = `${quality}_mp4_combined`;
      if (seenQ.has(key)) continue;
      seenQ.add(key);

      const size = parseInt(fmt.contentLength || '0') || 0;
      formats.push({
        quality,
        resolution: fmt.qualityLabel || quality,
        filesize: size,
        filesizeFormatted: formatFilesize(size),
        url: fmt.url,
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        formatId: fmt.itag?.toString() || '',
      });
    }

    if (formats.length === 0) return null;

    const qualityOrder: Record<string, number> = {
      '2160p': 8, '1440p': 7, '1080p': 6, '720p': 5,
      '480p': 4, '360p': 3, '240p': 2, '144p': 1,
    };
    formats.sort((a, b) => (qualityOrder[b.quality] ?? 0) - (qualityOrder[a.quality] ?? 0));

    // Davomiylik — soniyalarda
    const durationSec = Math.round(parseInt(data.lengthSeconds || '0'));

    return {
      title: data.title || 'YouTube Video',
      duration: durationSec,
      durationFormatted: formatDuration(durationSec),
      thumbnail: data.thumbnail?.thumbnails?.at(-1)?.url || data.thumbnail?.[0]?.url || '',
      url: videoUrl,
      platform: 'YOUTUBE',
      formats,
    };
  } catch (err) {
    console.warn('RapidAPI yt-api fetch error:', err);
    return null;
  }
}
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL kiritilishi shart' }, { status: 400 });
    }

    const sanitizedUrl = url.trim();
    const platform = detectPlatform(sanitizedUrl);

    // ── 1. yt-dlp urinishi ───────────────────────────────────────────────
    let videoInfo: VideoInfo | null = null;
    let ytdlpError = '';

    try {
      const ytDlpPath = await ensureYtDlpBinary();
      const baseArgs = [
        '--no-check-certificates',
        '--no-warnings',
        '--geo-bypass',
        '--age-limit', '99',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ];

      // mweb+tv_embedded: eng to'liq format ro'yxati (1080p, 1440p, 4K ham kiritiladi)
      let stdoutData = '';
      try {
        const { stdout } = await execFilePromise(ytDlpPath, [
          ...baseArgs,
          '--extractor-args', 'youtube:player_client=mweb,tv_embedded',
          '--dump-json', sanitizedUrl
        ], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
        stdoutData = stdout;
      } catch (e1: any) {
        console.warn('mweb client failed, trying android fallback:', e1.message);
        try {
          const { stdout } = await execFilePromise(ytDlpPath, [
            ...baseArgs,
            '--extractor-args', 'youtube:player_client=android,tv_embedded,ios',
            '--dump-json', sanitizedUrl
          ], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
          stdoutData = stdout;
        } catch (e2: any) {
          console.warn('android fallback also failed:', e2.message);
          throw e2;
        }
      }

      const output = JSON.parse(stdoutData);
      videoInfo = parseYtdlpFormats(output, sanitizedUrl, platform);
    } catch (err: any) {
      ytdlpError = err.message || 'yt-dlp failed';
      console.warn('yt-dlp completely failed, will try RapidAPI fallback. Error:', ytdlpError);
    }

    // ── 2. RapidAPI fallback (faqat YouTube uchun) ───────────────────────
    if (!videoInfo && platform === 'youtube') {
      console.log('Trying RapidAPI fallback for YouTube...');
      videoInfo = await fetchYouTubeViaRapidAPI(sanitizedUrl, platform);
    }

    if (!videoInfo) {
      return NextResponse.json(
        { error: `Video tahlil qilib bo'lmadi. Iltimos keyinroq urinib ko'ring yoki boshqa URL ishlating.` },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: videoInfo });

  } catch (error: any) {
    console.error('info route error:', error);
    return NextResponse.json(
      { error: `Video tahlil qilib bo'lmadi: ${error.message || 'Noma\'lum xato'}` },
      { status: 500 }
    );
  }
}
