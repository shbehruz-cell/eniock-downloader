import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection } from 'firebase/firestore';
import { ensureYtDlpBinary, getExtraYtDlpFlags } from '@/lib/ytdlp-helper';

// Bu route build vaqtida static prerender qilinmasligi kerak
export const dynamic = 'force-dynamic';

const execPromise = promisify(exec);

// Plan limits configuration
const PLAN_LIMITS = {
  free: { dailyUrls: 3, maxQuality: '480p', maxDuration: 3600 },
  pro: { dailyUrls: 10, maxQuality: '720p', maxDuration: Infinity },
  max: { dailyUrls: Infinity, maxQuality: '2160p', maxDuration: Infinity },
};

const QUALITY_HIERARCHY: Record<string, number> = {
  '144p': 1, '240p': 2, '360p': 3, '480p': 4, '720p': 5, '1080p': 6, '1440p': 7, '2160p': 8, 'Standart': 3, 'default': 3
};

// Helper to get dynamic bot token from Firestore
async function getBotToken(): Promise<string> {
  try {
    const settingsRef = doc(db, 'settings', 'site_config');
    const settingsSnap = await getDoc(settingsRef);
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      if (data.telegramBotToken) {
        return data.telegramBotToken.trim();
      }
    }
  } catch (err) {
    console.error('Error fetching bot token from Firestore:', err);
  }
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

// Detect platform from URL
function detectPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/pinterest\.com|pin\.it/i.test(url)) return 'pinterest';
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return 'rednote';
  return 'general';
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

function getQualityLabel(height: number): string | null {
  if (height >= 2160) return '2160p';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  if (height >= 240) return '240p';
  if (height > 0) return '144p';
  return null;
}

// ── RapidAPI YouTube fetch helper for Telegram Bot ──────────────────────────
async function fetchYouTubeViaRapidAPI(videoUrl: string): Promise<any> {
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) {
    throw new Error('Serverda RAPIDAPI_KEY sozlamasi kiritilmagan! Iltimos, Railway Variables bo\'limiga kirib RAPIDAPI_KEY ni qo\'shing.');
  }

  const match = videoUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) {
    throw new Error('Noto\'g\'ri YouTube havola formati.');
  }
  const videoId = match[1];

  try {
    const res = await fetch(`https://yt-api.p.rapidapi.com/dl?id=${videoId}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'yt-api.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!res.ok) {
      throw new Error(`RapidAPI javobi noto'g'ri bo'ldi: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data) {
      throw new Error('RapidAPI ma\'lumot qaytarmadi');
    }
    if (data.status === 'ERROR') {
      throw new Error(`RapidAPI xatolik qaytardi: ${data.message || 'Noma\'lum xatolik'}`);
    }

    const formats: any[] = [];
    const seenQ = new Set<string>();

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

      formats.push({
        quality,
        ext: 'mp4',
        formatId: fmt.itag?.toString() || '',
        url: fmt.url
      });
    }

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

      formats.push({
        quality,
        ext: 'mp4',
        formatId: fmt.itag?.toString() || '',
        url: fmt.url
      });
    }

    const qualityOrder: Record<string, number> = {
      '2160p': 8, '1440p': 7, '1080p': 6, '720p': 5,
      '480p': 4, '360p': 3, '240p': 2, '144p': 1,
    };
    formats.sort((a, b) => (qualityOrder[b.quality] ?? 0) - (qualityOrder[a.quality] ?? 0));

    const durationSec = Math.round(parseInt(data.lengthSeconds || '0'));
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const s = Math.floor(durationSec % 60);
    const durationFormatted = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;

    return {
      title: data.title || 'YouTube Video',
      duration: durationSec,
      durationFormatted,
      thumbnail: data.thumbnail?.thumbnails?.at(-1)?.url || data.thumbnail?.[0]?.url || '',
      formats
    };
  } catch (err: any) {
    console.error('Bot RapidAPI helper error:', err);
    throw err; // Keyingi catch bloki ushlashi va Telegramga yuborishi uchun
  }
}

export async function POST(request: NextRequest) {
  const botToken = await getBotToken();
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not configured' }, { status: 500 });
  }

  const telegramApi = `https://api.telegram.org/bot${botToken}`;

  try {
    const update = await request.json();

    // 1. Handle Callback Query
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const data = callbackQuery.data;
      const tgUser = callbackQuery.from;

      await answerCallbackQuery(telegramApi, callbackQuery.id);

      const userRef = doc(db, 'users', `tg_${tgUser.id}`);
      let userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          displayName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'User',
          username: tgUser.username || '',
          plan: 'free',
          platform: 'telegram',
          dailyDownloads: 0,
          lastDownloadDate: '',
          createdAt: new Date().toISOString()
        });
        userSnap = await getDoc(userRef);
      }
      const userDoc = userSnap.data()!;

      // Sifat tanlanganda yuklab olish
      if (data.startsWith('dl_')) {
        const idx = parseInt(data.split('_')[1]);
        const tempVideo = userDoc.tempVideo;

        if (!tempVideo || !tempVideo.formats || !tempVideo.formats[idx]) {
          await sendTelegramMessage(telegramApi, chatId, "❌ Video ma'lumotlari muddati tugagan. Iltimos, havolani qaytadan yuboring.");
          return NextResponse.json({ ok: true });
        }

        const format = tempVideo.formats[idx];
        const userPlan = userDoc.plan || 'free';
        const limits = PLAN_LIMITS[userPlan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;

        // Plan cheklovlarini tekshirish
        const maxAllowedRank = QUALITY_HIERARCHY[limits.maxQuality] || 3;
        const requestedRank = QUALITY_HIERARCHY[format.quality] || 3;

        if (requestedRank > maxAllowedRank) {
          await sendTelegramMessage(telegramApi, chatId,
            `⚠️ **Tarif cheklovi!**\n\n` +
            `Siz tanlagan sifat: **${format.quality}**.\n` +
            `Sizning hozirgi tarifingiz: **${userPlan.toUpperCase()}** (Maksimal ruxsat etilgan sifat: **${limits.maxQuality}**).\n\n` +
            `Yuqori sifatlarda yuklash uchun tarifingizni yangilang: /upgrade`
          );
          return NextResponse.json({ ok: true });
        }

        // Kundalik limitni tekshirish
        const today = new Date().toISOString().split('T')[0];
        const isNewDay = userDoc.lastDownloadDate !== today;
        const currentDownloads = isNewDay ? 0 : (userDoc.dailyDownloads || 0);

        if (currentDownloads >= limits.dailyUrls) {
          await sendTelegramMessage(telegramApi, chatId,
            `⚠️ **Kunlik limit tugadi!**\n\n` +
            `Siz bugun limitda belgilangan barcha videolarni yuklab bo'ldingiz.\n` +
            `Kunlik limitingiz: **${limits.dailyUrls} ta**.\n\n` +
            `Cheklovlarni oshirish uchun /upgrade buyrug'ini bosing.`
          );
          return NextResponse.json({ ok: true });
        }

        await sendTelegramMessage(telegramApi, chatId, "Yuklash tayyorlanmoqda, iltimos biroz kuting... ⏳");

        // Foydalanuvchi yuklash hisobini yangilash
        await updateDoc(userRef, {
          dailyDownloads: currentDownloads + 1,
          lastDownloadDate: today,
          downloadHistory: arrayUnion({
            id: Date.now().toString(),
            title: tempVideo.title || 'Video',
            quality: format.quality,
            url: tempVideo.url,
            downloadedAt: new Date().toISOString()
          })
        });

        // Vercel/Railway server URL ni aniqlash
        const host = request.headers.get('host') || 'eniock-downloader.up.railway.app';
        const protocol = request.headers.get('x-forwarded-proto') || 'https';
        const webUrl = `${protocol}://${host}`;

        // To'g'ridan-to'g'ri download endpoint havolasi orqali telegramga video yuboramiz
        const cleanTitle = (tempVideo.title || 'video').replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${cleanTitle}_${format.quality}.${format.ext}`;

        const videoDownloadProxyUrl = `${webUrl}/api/download/file?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(filename)}&formatId=${format.formatId || ''}&videoUrl=${encodeURIComponent(tempVideo.url)}`;

        // Telegram orqali videoni yuborish
        const sendVideoRes = await fetch(`${telegramApi}/sendVideo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            video: videoDownloadProxyUrl,
            caption: `✅ **Tayyor!**\n\n🎥 **Video:** ${tempVideo.title}\n💾 **Sifat:** ${format.quality}\n\n📥 Yuklab olganingiz uchun rahmat!`,
            supports_streaming: true
          })
        });

        const videoResult = await sendVideoRes.json();
        if (!videoResult.ok) {
          console.error('Failed to send video directly via sendVideo:', videoResult);
          // Agar direct sendVideo xato bersa, download linkini yuboramiz
          await sendTelegramMessage(telegramApi, chatId,
            `❌ Telegram orqali videoni yuborib bo'lmadi.\n\n` +
            `Siz uni brauzer orqali to'g'ridan-to'g'ri yuklab olishingiz mumkin:\n` +
            `👉 [Videoni yuklab olish](${videoDownloadProxyUrl})`
          );
        }

        return NextResponse.json({ ok: true });
      }

      // Handle Upgrade Plan Choice (upgrade_pro yoki upgrade_max bosilganda)
      if (data.startsWith('upgrade_')) {
        const plan = data.split('_')[1] as 'pro' | 'max';
        // Tanlangan tarifni foydalanuvchi state-da vaqtinchalik saqlaymiz (to'lov cheki bilan solishtirish uchun)
        await updateDoc(userRef, { tempSelectedPlan: plan });
        await sendUpgradeInfo(telegramApi, chatId, plan);
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('pay_card_')) {
        const plan = data.split('_')[2];
        const siteConfigSnap = await getDoc(doc(db, 'settings', 'site_config'));
        const config = siteConfigSnap.exists() ? siteConfigSnap.data() : {};
        const price = plan === 'max' ? (config.maxPrice || '70') : (config.proPrice || '20');

        await sendTelegramMessage(telegramApi, chatId,
          `💳 **Admin Karta Raqami:**\n` +
          `💰 Miqdor: **$${price}**\n` +
          `🔢 Karta: \`${config.cardNumber || '9860 0000 0000 0000'}\`\n` +
          `👤 Egasining ismi: **${config.cardHolder || 'ADMIN NAME'}**\n\n` +
          `Yo'riqnoma: ${config.paymentInstructions || 'Ushbu kartaga to\'lov qilib, to\'lov cheki (rasmini) yuboring.'}\n\n` +
          `**Iltimos, endi to'lov cheki rasmini (skrinshot) botga yuboring.**`
        );
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('pay_stars_')) {
        const plan = data.split('_')[2];
        const siteConfigSnap = await getDoc(doc(db, 'settings', 'site_config'));
        const config = siteConfigSnap.exists() ? siteConfigSnap.data() : {};
        
        // Stars narxini Firestore sozlamasidan olamiz.
        // Agar kiritilmagan bo'lsa, USD narxini 10 ga ko'paytirib hisoblaymiz (default: $20 = 200 Stars, $70 = 700 Stars).
        let starsAmount = 0;
        if (plan === 'max') {
          starsAmount = parseInt(config.maxStarsPrice || (parseInt(config.maxPrice || '70') * 10).toString());
        } else {
          starsAmount = parseInt(config.proStarsPrice || (parseInt(config.proPrice || '20') * 10).toString());
        }

        // Telegram Stars to'lovi uchun invoice yuboramiz
        const invoiceTitle = plan === 'max' ? "MAX Tarifi (Stars)" : "PRO Tarifi (Stars)";
        const invoiceDesc = plan === 'max' 
          ? "Maksimal tezlikda yuklash, 4K sifat, cheksiz kunlik yuklashlar" 
          : "Maksimal 720p sifat, kuniga 10 tagacha yuklash";

        try {
          const invoiceRes = await fetch(`${telegramApi}/sendInvoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              title: invoiceTitle,
              description: invoiceDesc,
              payload: `stars_payment_${plan}`,
              provider_token: "", // Telegram Stars uchun bo'sh qoldiriladi
              currency: "XTR", // Telegram Stars valyuta kodi
              prices: [
                { label: invoiceTitle, amount: starsAmount } // Stars miqdori
              ]
            })
          });
          const invoiceData = await invoiceRes.json();
          if (!invoiceData.ok) {
            throw new Error(invoiceData.description || "Invoice yuborib bo'lmadi");
          }
        } catch (err: any) {
          await sendTelegramMessage(telegramApi, chatId, `❌ Stars to'lov oynasini yaratib bo'lmadi: ${err.message}. Iltimos keyinroq urinib ko'ring.`);
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'delete_receipt') {
        await updateDoc(userRef, { tempReceipt: null });
        await sendTelegramMessage(telegramApi, chatId, "🗑 Yuklangan chek o'chirib tashlandi. Kerakli rasm chekini qaytadan yuboring.");
        return NextResponse.json({ ok: true });
      }

      if (data === 'submit_payment') {
        if (!userDoc.tempReceipt || !userDoc.tempSelectedPlan) {
          await sendTelegramMessage(telegramApi, chatId, "❌ Xatolik: Yuklangan chek rasmi topilmadi. Avval rasmni yuboring.");
          return NextResponse.json({ ok: true });
        }

        const siteConfigSnap = await getDoc(doc(db, 'settings', 'site_config'));
        const config = siteConfigSnap.exists() ? siteConfigSnap.data() : {};
        const plan = userDoc.tempSelectedPlan;
        const price = plan === 'max' ? (config.maxPrice || '70') : (config.proPrice || '20');

        const payRef = doc(collection(db, 'payments'));
        await setDoc(payRef, {
          userId: `tg_${tgUser.id}`,
          userDisplayName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'User',
          username: tgUser.username || 'username',
          plan: plan,
          amount: price,
          receipt: userDoc.tempReceipt,
          status: 'pending',
          platform: 'telegram',
          chatId: chatId,
          createdAt: serverTimestamp()
        });

        await updateDoc(userRef, {
          tempReceipt: null,
          tempSelectedPlan: null
        });

        await sendTelegramMessage(telegramApi, chatId, "⏳ **To'lov cheki adminga yuborildi!**\n\nAdmin to'lovni tasdiqlaganidan so'ng, sizga bot orqali avtomatik tasdiqlash xabari keladi. Rahmat!");
        return NextResponse.json({ ok: true });
      }
    }

    // 1.5 Handle PreCheckout Query (Stars to'lovi uchun Telegram so'rovi)
    if (update.pre_checkout_query) {
      const pqId = update.pre_checkout_query.id;
      // To'lovni tasdiqlaymiz
      await fetch(`${telegramApi}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: pqId,
          ok: true
        })
      });
      return NextResponse.json({ ok: true });
    }

    // 2. Handle incoming Message
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const tgUser = message.from;

      const userRef = doc(db, 'users', `tg_${tgUser.id}`);
      let userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          displayName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'User',
          username: tgUser.username || '',
          plan: 'free',
          platform: 'telegram',
          dailyDownloads: 0,
          lastDownloadDate: '',
          createdAt: new Date().toISOString()
        });
        userSnap = await getDoc(userRef);
      }
      const userDoc = userSnap.data()!;

      // A. Handle Successful Payment (Telegram Stars to'lovi muvaffaqiyatli o'tganda)
      if (message.successful_payment) {
        const payload: string = message.successful_payment.invoice_payload || '';
        const plan = payload.replace('stars_payment_', '') as 'pro' | 'max';

        // Foydalanuvchi tarifini avtomatik faollashtiramiz
        await updateDoc(userRef, {
          plan: plan,
          starsPayments: arrayUnion({
            id: message.successful_payment.telegram_payment_charge_id,
            amount: message.successful_payment.total_amount,
            plan: plan,
            date: new Date().toISOString()
          })
        });

        // Muvaffaqiyatli to'lov xabari
        await sendTelegramMessage(telegramApi, chatId,
          `🎉 **Tabriklaymiz! To'lov muvaffaqiyatli amalga oshirildi!**\n\n` +
          `Sizning **${plan.toUpperCase()}** tarifingiz avtomatik ravishda faollashtirildi. Endi siz barcha cheklovlardan ozodsiz! 🚀`
        );
        return NextResponse.json({ ok: true });
      }

      // A2. /start buyrug'i
      if (message.text === '/start') {
        await sendTelegramMessage(telegramApi, chatId,
          `👋 **Salom, ${tgUser.first_name || 'Foydalanuvchi'}!**\n\n` +
          `Men **Eniock Downloader** telegram botiman. Menga istalgan ijtimoiy tarmoq (YouTube, Instagram, TikTok va b.) video havolasini yuboring va men uni sizga yuklab beraman! 🚀\n\n` +
          `Tarifingizni yangilash uchun /upgrade buyrug'ini bosing.`
        );
        return NextResponse.json({ ok: true });
      }

      // B. /upgrade buyrug'i
      if (message.text === '/upgrade') {
        await sendUpgradeOptions(telegramApi, chatId);
        return NextResponse.json({ ok: true });
      }

      // C. Rasm yuklanganda (to'lov chek)
      if (message.photo && message.photo.length > 0) {
        if (!userDoc.tempSelectedPlan) {
          await sendTelegramMessage(telegramApi, chatId, "⚠️ Iltimos, avval tarifni tanlang (/upgrade), keyin to'lov chekini yuboring.");
          return NextResponse.json({ ok: true });
        }

        const waitMsgId = await sendTelegramMessage(telegramApi, chatId, "To'lov chek fayli yuklanmoqda... ⏳");

        try {
          const fileId = message.photo[message.photo.length - 1].file_id;
          const fileRes = await fetch(`${telegramApi}/getFile?file_id=${fileId}`);
          const fileData = await fileRes.json();

          if (!fileData.ok) throw new Error('File path not found');

          const filePath = fileData.result.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

          const fileBytesRes = await fetch(fileUrl);
          const arrayBuf = await fileBytesRes.arrayBuffer();
          const base64String = Buffer.from(arrayBuf).toString('base64');
          const dataUri = `data:image/jpeg;base64,${base64String}`;

          await updateDoc(userRef, { tempReceipt: dataUri });
          await deleteTelegramMessage(telegramApi, chatId, waitMsgId);

          await sendTelegramMessageWithKeyboard(telegramApi, chatId,
            `📸 **Chek rasmi qabul qilindi!**\n\n` +
            `To'lovni adminga yuborish uchun **\"To'lov qildim\"** tugmasini bosing:`,
            [
              [
                { text: "❌ O'chirish", callback_data: "delete_receipt" },
                { text: "✅ To'lov qildim", callback_data: "submit_payment" }
              ]
            ]
          );
        } catch (e: any) {
          console.error(e);
          await deleteTelegramMessage(telegramApi, chatId, waitMsgId);
          await sendTelegramMessage(telegramApi, chatId, "❌ Rasm faylini yuklab olishda xatolik yuz berdi. Iltimos qaytadan yuboring.");
        }

        return NextResponse.json({ ok: true });
      }

      // D. URL kelganda
      const text = (message.text || '').trim();
      let isUrl = false;
      try {
        if (text.startsWith('http://') || text.startsWith('https://')) {
          new URL(text);
          isUrl = true;
        }
      } catch (e) { }

      if (isUrl) {
        const waitMessageId = await sendTelegramMessage(telegramApi, chatId, "Video tahlil qilinmoqda, iltimos kuting... ⏳");

        try {
          const platform = detectPlatform(text);
          let title = 'Video';
          let durationFormatted = '00:00';
          let thumbnail = '';
          let formats: any[] = [];

          // ── RapidAPI Fallback or YtDlp for Bot ────────────────────────────
          let success = false;

          // 1. YouTube bo'lsa, avval to'g'ridan-to'g'ri RapidAPI ni sinaymiz (blokdan qochish uchun)
          if (platform === 'youtube') {
            try {
              const rapidData = await fetchYouTubeViaRapidAPI(text);
              if (rapidData) {
                title = rapidData.title;
                durationFormatted = rapidData.durationFormatted;
                thumbnail = rapidData.thumbnail;
                formats = rapidData.formats;
                success = true;
              }
            } catch (rapidErr) {
              console.warn('RapidAPI failed (maybe HTTP 403), falling back to local yt-dlp:', rapidErr);
            }
          }

          // 2. YouTube bo'lmasa yoki RapidAPI ishlamasa, yt-dlp urinadi
          if (!success) {
            const ytDlpPath = await ensureYtDlpBinary();
            const primaryFlags = await getExtraYtDlpFlags('android,tv_embedded,ios');
            const cmd = `"${ytDlpPath}" ${primaryFlags} --dump-json "${text}"`;

            let stdoutData = '';
            try {
              const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });
              stdoutData = stdout;
            } catch (e1: any) {
              const f2 = await getExtraYtDlpFlags('tv_embedded,web_creator,ios');
              const { stdout } = await execPromise(
                `"${ytDlpPath}" ${f2} --dump-json "${text}"`,
                { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
              );
              stdoutData = stdout;
            }

            const output = JSON.parse(stdoutData);
            if (output) {
              title = output.title || output.fulltitle || 'Video';
              thumbnail = output.thumbnail || '';
              const duration = output.duration || 0;
              const h = Math.floor(duration / 3600);
              const m = Math.floor((duration % 3600) / 60);
              const s = Math.floor(duration % 60);
              durationFormatted = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;

              const rawFormats = output.formats || [];
              const seenQualities = new Set<string>();
              for (const fmt of rawFormats) {
                if (!fmt.url || fmt.vcodec === 'none') continue;
                const height = fmt.height || 0;
                const quality = getQualityLabel(height) || '720p';

                const key = `${quality}_${fmt.ext || 'mp4'}`;
                if (seenQualities.has(key)) continue;
                seenQualities.add(key);

                formats.push({
                  quality,
                  ext: fmt.ext || 'mp4',
                  formatId: fmt.format_id || '',
                  url: fmt.url
                });
              }

              if (formats.length === 0 && output.url) {
                formats.push({ quality: 'Standart', ext: 'mp4', formatId: '', url: output.url });
              }
              success = true;
            }
          }

          if (!success || formats.length === 0) {
            throw new Error('Haqiqiy formatlarni olib bo\'lmadi');
          }

          // User state yangilash
          await updateDoc(userRef, {
            tempVideo: {
              title,
              url: text,
              formats
            }
          });

          await deleteTelegramMessage(telegramApi, chatId, waitMessageId);

          // Inline sifat tugmalari
          const inlineKeyboard = formats.slice(0, 6).map((f, idx) => {
            return [
              {
                text: `📥 Sifat: ${f.quality} (${f.ext.toUpperCase()})`,
                callback_data: `dl_${idx}`
              }
            ];
          });

          if (thumbnail) {
            const photoRes = await fetch(`${telegramApi}/sendPhoto`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                photo: thumbnail,
                caption: `🎬 **Sarlavha:** ${title}\n` +
                  `⏱ **Davomiyligi:** ${durationFormatted}\n` +
                  `📱 **Platforma:** ${platform.toUpperCase()}\n\n` +
                  `Yuklab olish uchun pastdagi sifat tugmalaridan birini tanlang:`,
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: inlineKeyboard
                }
              })
            });
            const photoData = await photoRes.json();
            if (photoData.ok) return NextResponse.json({ ok: true });
          }

          await sendTelegramMessageWithKeyboard(telegramApi, chatId,
            `🎬 **Sarlavha:** ${title}\n` +
            `⏱ **Davomiyligi:** ${durationFormatted}\n` +
            `📱 **Platforma:** ${platform.toUpperCase()}\n\n` +
            `Yuklab olish uchun pastdagi sifat tugmalaridan birini tanlang:`,
            inlineKeyboard
          );

        } catch (err: any) {
          console.error('Bot url analysis failed:', err);
          await deleteTelegramMessage(telegramApi, chatId, waitMessageId);
          await sendTelegramMessage(telegramApi, chatId, `❌ Video tahlil qilishda xatolik yuz berdi: ${err.message || 'Noma\'lum xato'}. Iltimos, keyinroq urinib ko'ring.`);
        }
        return NextResponse.json({ ok: true });
      }

      // Default javob
      await sendTelegramMessage(telegramApi, chatId, "⚠️ Iltimos, video havolasini yuboring. Tarifni yangilash uchun esa /upgrade buyrug'ini yuboring.");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });

  } catch (error: any) {
    console.error('Telegram bot webhook general error:', error);
    return NextResponse.json({ error: error.message || 'Internal Error' }, { status: 500 });
  }
}

// Answer callback query
async function answerCallbackQuery(api: string, queryId: string) {
  await fetch(`${api}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: queryId })
  });
}

// Send simple message
async function sendTelegramMessage(api: string, chatId: number, text: string): Promise<number> {
  const res = await fetch(`${api}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  const data = await res.json();
  return data?.result?.message_id || 0;
}

// Delete message
async function deleteTelegramMessage(api: string, chatId: number, messageId: number) {
  if (!messageId) return;
  await fetch(`${api}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId
    })
  });
}

// Send keyboard message
async function sendTelegramMessageWithKeyboard(api: string, chatId: number, text: string, keyboard: any[]) {
  await fetch(`${api}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    })
  });
}

// Send Upgrade Options menu
async function sendUpgradeOptions(api: string, chatId: number) {
  await sendTelegramMessageWithKeyboard(api, chatId,
    `🌟 **Tarifni yangilash sahifasi**\n\n` +
    `Botning barcha imkoniyatlaridan to'liq va cheklovlarsiz foydalanish uchun quyidagi tariflardan birini tanlang:`,
    [
      [
        { text: "⭐ Pro planini tanlash", callback_data: "upgrade_pro" },
      ],
      [
        { text: "💎 Max planini tanlash", callback_data: "upgrade_max" }
      ]
    ]
  );
}

// Send Upgrade Details
async function sendUpgradeInfo(api: string, chatId: number, plan: 'pro' | 'max') {
  const siteConfigSnap = await getDoc(doc(db, 'settings', 'site_config'));
  const config = siteConfigSnap.exists() ? siteConfigSnap.data() : {};

  const name = plan === 'max' ? 'MAX' : 'PRO';
  const price = plan === 'max' ? (config.maxPrice || '70') : (config.proPrice || '20');
  const desc = plan === 'max'
    ? (config.maxDescription || 'All qualities up to 4K • Unlimited downloads')
    : (config.proDescription || 'Max quality: 720p • 10 URLs per day');

  await sendTelegramMessageWithKeyboard(api, chatId,
    `📋 **Tarif:** ${name}\n` +
    `💰 **Narxi:** $${price}/oyiga\n` +
    `✨ **Imkoniyatlari:** ${desc}\n\n` +
    `To'lov usulini tanlang:`,
    [
      [
        { text: "💳 Karta orqali to'lov (Admin)", callback_data: `pay_card_${plan}` },
        { text: "🌟 Telegram Stars", callback_data: `pay_stars_${plan}` }
      ]
    ]
  );
}

// Helper to push items to array in Firestore
function arrayUnion(item: any) {
  // Array union custom implementation for simplicity
  return item;
}
