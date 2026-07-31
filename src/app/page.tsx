'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SocialLogos from '@/components/SocialLogos';
import { useAuth } from '@/context/AuthContext';
import { doc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface VideoFormat {
  quality: string;
  resolution: string;
  filesize: number;
  filesizeFormatted: string;
  url: string;
  ext: string;
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

const QUALITY_HIERARCHY: Record<string, number> = {
  '360p': 1, '480p': 2, '720p': 3, '1080p': 4, '1440p': 5, '2160p': 6,
};

const MAX_QUALITY_BY_PLAN: Record<string, string> = {
  free: '480p',
  pro: '720p',
  max: '2160p',
};

export default function HomePage() {
  const router = useRouter();
  const { user, userData } = useAuth();
  const plan = userData?.plan || 'free';

  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState('');

  const handleDownloadClick = async () => {
    if (!url.trim()) return;
    
    if (!user) {
      router.push('/auth');
      return;
    }

    setError('');
    setLoading(true);
    setVideoInfo(null);

    try {
      if (userData) {
        const limitRes = await fetch('/api/download/check-limits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: userData.plan,
            dailyDownloads: userData.dailyDownloads,
            lastDownloadDate: userData.lastDownloadDate,
          }),
        });
        const limitData = await limitRes.json();
        if (!limitData.allowed) {
          setError(limitData.reason);
          setLoading(false);
          return;
        }
      }

      const res = await fetch('/api/download/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to fetch video info');
      }

      setVideoInfo(result.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const isQualityLocked = (quality: string): boolean => {
    const maxQuality = MAX_QUALITY_BY_PLAN[plan] || '480p';
    return (QUALITY_HIERARCHY[quality] || 0) > (QUALITY_HIERARCHY[maxQuality] || 2);
  };

  const handleDownloadFile = async (format: VideoFormat) => {
    if (!user) {
      router.push('/auth');
      return;
    }

    if (isQualityLocked(format.quality)) {
      router.push('/pricing');
      return;
    }

    try {
      // Yuklanish tarixini bazaga yozish
      const today = new Date().toISOString().split('T')[0];
      const userRef = doc(db, 'users', user.uid);
      const isNewDay = userData?.lastDownloadDate !== today;

      await updateDoc(userRef, {
        dailyDownloads: isNewDay ? 1 : increment(1),
        lastDownloadDate: today,
        downloadHistory: arrayUnion({
          id: Date.now().toString(),
          title: videoInfo?.title || 'Video',
          thumbnail: videoInfo?.thumbnail || '',
          duration: videoInfo?.durationFormatted || '',
          quality: format.quality,
          size: format.filesizeFormatted,
          url: videoInfo?.url || '',
          downloadedAt: new Date().toISOString(),
        }),
      });

      // To'g'ridan-to'g'ri proxy API havolasi orqali brauzer orqali yuklab olish (Blob ishlatilmaydi)
      const filename = `${(videoInfo?.title || 'video').replace(/[^a-zA-Z0-9]/g, '_')}_${format.quality}.${format.ext || 'mp4'}`;
      const downloadUrl = `/api/download/file?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(filename)}&formatId=${format.formatId || ''}&videoUrl=${encodeURIComponent(videoInfo?.url || '')}`;

      // Brauzer yuklash oynasini to'g'ridan-to'g'ri ochadi
      window.location.href = downloadUrl;

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Download failed';
      setError(message);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center px-4 sm:px-6 min-h-[calc(100vh-80px)]">
      <div
        className="w-full max-w-3xl bg-white/70 backdrop-blur-xl rounded-[40px] p-6 sm:p-10 shadow-sm border border-white/20"
        style={{ animation: 'slideUp 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <SocialLogos />

        <form 
          onSubmit={(e) => { e.preventDefault(); handleDownloadClick(); }}
          className="mt-8 flex flex-col sm:flex-row gap-4"
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste video URL here..."
            className="flex-1 bg-white rounded-2xl px-6 py-4 text-base sm:text-lg border-[1.5px] border-black/6 outline-none focus:border-[#ff3b30] focus:ring-4 focus:ring-[#ff3b30]/10 transition-all duration-300"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="bg-[#ff3b30] text-white rounded-full px-8 py-4 font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#e6352b] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 shadow-sm"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              'Download'
            )}
          </button>
        </form>

        {error && (
          <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-2xl text-center text-sm border border-red-100" style={{ animation: 'slideUp 0.3s ease both' }}>
            {error}
          </div>
        )}

        {loading && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-[3px] border-gray-200 border-t-[#ff3b30] rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Fetching video details...</p>
          </div>
        )}

        {videoInfo && !loading && (
          <div className="mt-10 flex flex-col md:flex-row gap-8 items-start" style={{ animation: 'slideUp 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}>
            <div className="w-full md:w-[45%] rounded-2xl overflow-hidden bg-gray-100 relative shadow-sm shrink-0">
              {videoInfo.thumbnail ? (
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="w-full aspect-video object-cover"
                />
              ) : (
                <div className="w-full aspect-video bg-gray-200 flex items-center justify-center">
                  <svg className="w-12 h-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              )}
              {videoInfo.durationFormatted && (
                <div className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded-md font-medium backdrop-blur-sm">
                  {videoInfo.durationFormatted}
                </div>
              )}
              <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm text-xs px-2 py-1 rounded-md font-medium capitalize text-gray-700">
                {videoInfo.platform}
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-4 w-full">
              <h2 className="font-semibold text-lg text-gray-900 leading-tight line-clamp-2">
                {videoInfo.title}
              </h2>

              <p className="text-sm text-gray-400">
                Select quality to download
              </p>

              <div className="flex flex-col gap-2.5">
                {videoInfo.formats.map((format, idx) => {
                  const locked = isQualityLocked(format.quality);
                  const uniqueKey = `${format.quality}_${format.ext}_${idx}`;
                  return (
                    <button
                      key={uniqueKey}
                      onClick={() => !locked && handleDownloadFile(format)}
                      className={`group flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 ${
                        locked
                          ? 'bg-gray-50 border-gray-100 text-gray-400 cursor-pointer hover:border-gray-200'
                          : 'bg-white border-gray-100 hover:border-[#ff3b30] hover:shadow-sm text-gray-900'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold text-sm px-2.5 py-1 rounded-lg ${
                          locked ? 'bg-gray-100' : 'bg-[#ff3b30]/8 text-[#ff3b30]'
                        }`}>
                          {format.quality}
                        </span>
                        {format.resolution && format.resolution !== format.quality && (
                          <span className="text-xs text-gray-400">{format.resolution} ({format.ext})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">
                          {format.filesizeFormatted !== '0 B' ? format.filesizeFormatted : '—'}
                        </span>
                        {locked ? (
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-300 group-hover:text-[#ff3b30] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {videoInfo.formats.some(f => isQualityLocked(f.quality)) && (
                <button
                  onClick={() => router.push('/pricing')}
                  className="text-sm text-[#ff3b30] hover:underline font-medium mt-1 text-left"
                >
                  Upgrade to unlock higher qualities →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
