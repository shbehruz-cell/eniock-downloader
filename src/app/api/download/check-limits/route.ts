import { NextRequest, NextResponse } from 'next/server';

// Plan limits configuration
const PLAN_LIMITS = {
  free: { dailyUrls: 3, maxQuality: '480p', maxDuration: 3600, maxFileSize: Infinity },
  pro: { dailyUrls: 10, maxQuality: '720p', maxDuration: Infinity, maxFileSize: 1.5 * 1024 * 1024 * 1024 },
  max: { dailyUrls: Infinity, maxQuality: '2160p', maxDuration: Infinity, maxFileSize: Infinity },
};

const QUALITY_HIERARCHY: Record<string, number> = {
  '360p': 1, '480p': 2, '720p': 3, '1080p': 4, '1440p': 5, '2160p': 6,
};

export async function POST(request: NextRequest) {
  try {
    const { plan = 'free', dailyDownloads = 0, lastDownloadDate, quality, duration, filesize } = await request.json();

    const userPlan = plan as keyof typeof PLAN_LIMITS;
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;

    // Check if it's a new day (reset counter)
    const today = new Date().toISOString().split('T')[0];
    const currentDailyDownloads = lastDownloadDate === today ? dailyDownloads : 0;

    // Check daily URL limit
    if (currentDailyDownloads >= limits.dailyUrls) {
      return NextResponse.json({
        allowed: false,
        reason: `You've reached your daily limit of ${limits.dailyUrls} downloads. Upgrade your plan for more.`,
        upgradeRequired: true,
      });
    }

    // Check quality limit
    if (quality && QUALITY_HIERARCHY[quality] > QUALITY_HIERARCHY[limits.maxQuality]) {
      return NextResponse.json({
        allowed: false,
        reason: `Your plan supports up to ${limits.maxQuality}. Upgrade to download in ${quality}.`,
        upgradeRequired: true,
        maxAllowedQuality: limits.maxQuality,
      });
    }

    // Check duration limit (for free plan)
    if (duration && duration > limits.maxDuration) {
      const maxMinutes = Math.floor(limits.maxDuration / 60);
      return NextResponse.json({
        allowed: false,
        reason: `Your plan supports videos up to ${maxMinutes} minutes. Upgrade for longer videos.`,
        upgradeRequired: true,
      });
    }

    // Check file size limit (for pro plan)
    if (filesize && filesize > limits.maxFileSize) {
      return NextResponse.json({
        allowed: false,
        reason: `File size exceeds your plan's limit of 1.5GB. Upgrade to Max for unlimited.`,
        upgradeRequired: true,
      });
    }

    return NextResponse.json({
      allowed: true,
      remainingToday: limits.dailyUrls === Infinity ? 'Unlimited' : limits.dailyUrls - currentDailyDownloads - 1,
      maxQuality: limits.maxQuality,
    });
  } catch (error) {
    console.error('Check limits error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
