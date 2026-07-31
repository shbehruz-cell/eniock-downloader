import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { ensureYtDlpBinary } from '@/lib/ytdlp-helper';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const downloadUrl = searchParams.get('url');
    const filename = searchParams.get('filename') || 'video.mp4';
    const formatId = searchParams.get('formatId');
    const videoUrl = searchParams.get('videoUrl');

    // 1. Agar adaptive stream format so'ralgan bo'lsa (masalan YouTube 1080p), yt-dlp yordamida audio+video birlashtirib stream qilamiz
    if (formatId && videoUrl) {
      const ytDlpPath = await ensureYtDlpBinary();
      
      const args = [
        '-f', `${formatId}+bestaudio/best`,
        '-o', '-',
        '--no-check-certificates',
        '--no-warnings',
        videoUrl
      ];

      const child = spawn(ytDlpPath, args);
      
      // Node.js child process stdout oqimini NextResponse-ga o'tkazamiz
      const responseStream = new ReadableStream({
        start(controller) {
          child.stdout.on('data', (chunk) => {
            controller.enqueue(chunk);
          });
          child.stdout.on('end', () => {
            controller.close();
          });
          child.on('error', (err) => {
            controller.error(err);
          });
          child.stderr.on('data', (data) => {
            console.error(`yt-dlp stderr: ${data}`);
          });
        },
        cancel() {
          child.kill();
        }
      });

      const headers = new Headers();
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      headers.set('Content-Type', 'video/mp4');

      return new NextResponse(responseStream, {
        status: 200,
        headers,
      });
    }

    // 2. Oddiy pre-merged / cdn direct URL bo'lsa, to'g'ridan-to'g'ri oqimli proxy qilamiz
    if (!downloadUrl) {
      return NextResponse.json({ error: 'Download URL is required' }, { status: 400 });
    }

    try {
      new URL(downloadUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid download URL' }, { status: 400 });
    }

    const response = await fetch(downloadUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      console.error(`Proxy request failed: ${response.status} ${response.statusText}`);
      return NextResponse.redirect(downloadUrl);
    }

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    headers.set('Content-Type', response.headers.get('Content-Type') || 'video/mp4');
    
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });

  } catch (error: any) {
    console.error('Download proxy file error:', error);
    const searchParams = request.nextUrl.searchParams;
    const downloadUrl = searchParams.get('url');
    if (downloadUrl) {
      return NextResponse.redirect(downloadUrl);
    }
    return NextResponse.json({ error: 'Faylni yuklashda xatolik yuz berdi' }, { status: 500 });
  }
}
