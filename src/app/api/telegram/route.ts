import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection } from 'firebase/firestore';
import { ensureYtDlpBinary } from '@/lib/ytdlp-helper';

const execPromise = promisify(exec);

// Plan limits configuration
const PLAN_LIMITS = {
  free: { dailyUrls: 3, maxQuality: '480p', maxDuration: 3600 },
  pro: { dailyUrls: 10, maxQuality: '720p', maxDuration: Infinity },
  max: { dailyUrls: Infinity, maxQuality: '2160p', maxDuration: Infinity },
};

const QUALITY_HIERARCHY: Record<string, number> = {
  '360p': 1, '480p': 2, '720p': 3, '1080p': 4, '1440p': 5, '2160p': 6, 'Standart': 2, 'default': 2
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



export async function POST(request: NextRequest) {
  const botToken = await getBotToken();
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not configured' }, { status: 500 });
  }

  const telegramApi = `https://api.telegram.org/bot${botToken}`;

  try {
    const update = await request.json();

    // 1. Handle Callback Query (Inline Button clicks)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const data = callbackQuery.data;
      const tgUser = callbackQuery.from;

      await answerCallbackQuery(telegramApi, callbackQuery.id);

      // Get or Create user document
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

      // Handle download format click: dl_{index}
      if (data.startsWith('dl_')) {
        const idx = parseInt(data.split('_')[1]);
        const tempVideo = userDoc.tempVideo;

        if (!tempVideo || !tempVideo.formats || !tempVideo.formats[idx]) {
          await sendTelegramMessage(telegramApi, chatId, "❌ Video ma'lumotlari muddati tugagan. Iltimos, havolani qaytadan yuboring.");
          return NextResponse.json({ ok: true });
        }

        const format = tempVideo.formats[idx];
        const originalUrl = tempVideo.url;
        const title = tempVideo.title;

        // Check plan limits
        const userPlan = userDoc.plan || 'free';
        const limits = PLAN_LIMITS[userPlan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;

        const reqQuality = format.quality;
        const currentRank = QUALITY_HIERARCHY[reqQuality] || 2;
        const allowedRank = QUALITY_HIERARCHY[limits.maxQuality] || 2;

        if (currentRank > allowedRank) {
          // Locked quality. Show locked message and trigger upgrade
          await sendTelegramMessage(telegramApi, chatId, `⚠️ Siz tanlagan sifat (${reqQuality}) sizning hozirgi tarifingizda faollashtirilmagan. Tarifni yangilang.`);
          await sendUpgradeOptions(telegramApi, chatId);
          return NextResponse.json({ ok: true });
        }

        // Limit daily downloads check
        const today = new Date().toISOString().split('T')[0];
        const dailyDownloads = userDoc.lastDownloadDate === today ? (userDoc.dailyDownloads || 0) : 0;

        if (dailyDownloads >= limits.dailyUrls) {
          await sendTelegramMessage(telegramApi, chatId, `⚠️ Sizning kunlik yuklab olish limitingiz (${limits.dailyUrls} ta) tugadi. Iltimos, tarifingizni yangilang.`);
          await sendUpgradeOptions(telegramApi, chatId);
          return NextResponse.json({ ok: true });
        }

        // Send the "Video tayyorlanmoqda..." message first so it shows up instantly
        const waitMsgId = await sendTelegramMessage(telegramApi, chatId, "Video tayyorlanmoqda va yuborilmoqda, iltimos kuting... 🚀");

        const hostname = request.headers.get('host') || 'eniock.com';
        const protocol = request.headers.get('x-forwarded-proto') || 'https';
        const webUrl = `${protocol}://${hostname}`;
        const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
        const proxyDownloadUrl = `${webUrl}/api/download/file?url=${encodeURIComponent(format.url)}&filename=${encodeURIComponent(cleanTitle)}_${format.quality}.${format.ext}&formatId=${format.formatId}&videoUrl=${encodeURIComponent(originalUrl)}`;

        // Respond to Telegram immediately to free up the Next.js dev thread and prevent deadlock!
        // The file download and upload will run in the background.
        (async () => {
          try {
            const isYoutube = detectPlatform(originalUrl) === 'youtube';
            const videoUrlToSend = isYoutube ? proxyDownloadUrl : format.url;

            // Attempt to send video file directly to Telegram
            const sendRes = await fetch(`${telegramApi}/sendVideo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                video: videoUrlToSend,
                caption: `🎬 **${title}**\n\nYuklab olindi: @EniockDownloaderBot`,
                parse_mode: 'Markdown'
              })
            });
            const sendData = await sendRes.json();

            if (!sendData.ok) {
              throw new Error(sendData.description || 'Failed sending video');
            }

            // Update download stats
            await updateDoc(userRef, {
              dailyDownloads: dailyDownloads + 1,
              lastDownloadDate: today
            });

            await deleteTelegramMessage(telegramApi, chatId, waitMsgId);

          } catch (err: any) {
            console.log('Video sending process failed, falling back to link:', err.message);
            // Fallback to text link if sending directly fails (ex. over 50MB file size limit or ngrok block)
            await deleteTelegramMessage(telegramApi, chatId, waitMsgId);
            await sendTelegramMessage(telegramApi, chatId, 
              `📥 **Videoni yuklab olish havolasi tayyor!**\n\n` +
              `Videoni quyidagi havola orqali yuklab oling:\n` +
              `🔗 [Videoni yuklab olish](${proxyDownloadUrl})`
            );
          }
        })();

        return NextResponse.json({ ok: true });
      }

      // Handle Upgrade Plan Choice
      if (data === 'upgrade_pro') {
        await updateDoc(userRef, { tempSelectedPlan: 'pro' });
        await sendUpgradeInfo(telegramApi, chatId, 'pro');
        return NextResponse.json({ ok: true });
      }

      if (data === 'upgrade_max') {
        await updateDoc(userRef, { tempSelectedPlan: 'max' });
        await sendUpgradeInfo(telegramApi, chatId, 'max');
        return NextResponse.json({ ok: true });
      }

      // Handle Payment Method Choice
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
        await sendTelegramMessage(telegramApi, chatId, 
          `🌟 **Telegram Stars orqali to'lov qilish:**\n\n` +
          `Tez kunda Stars orqali to'lovlar botda faollashtiriladi. Hozircha karta orqali to'lov usulidan foydalanib turing.`
        );
        return NextResponse.json({ ok: true });
      }

      // Delete receipt action
      if (data === 'delete_receipt') {
        await updateDoc(userRef, { tempReceipt: null });
        await sendTelegramMessage(telegramApi, chatId, "🗑 Yuklangan chek o'chirib tashlandi. Kerakli rasm chekini qaytadan yuboring.");
        return NextResponse.json({ ok: true });
      }

      // Submit payment verification to admin panel
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

        // Clear user state
        await updateDoc(userRef, {
          tempReceipt: null,
          tempSelectedPlan: null
        });

        await sendTelegramMessage(telegramApi, chatId, "⏳ **To'lov cheki adminga yuborildi!**\n\nAdmin to'lovni tasdiqlaganidan so'ng, sizga bot orqali avtomatik tasdiqlash xabari keladi. Rahmat!");
        return NextResponse.json({ ok: true });
      }
    }

    // 2. Handle incoming Message
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const tgUser = message.from;

      // Make sure user exists in database
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

      // A. Handle /start command
      if (message.text === '/start') {
        await sendTelegramMessage(telegramApi, chatId, 
          `👋 **Salom, ${tgUser.first_name || 'Foydalanuvchi'}!**\n\n` +
          `Men **Eniock Downloader** telegram botiman. Menga istalgan ijtimoiy tarmoq (YouTube, Instagram, TikTok va b.) video havolasini yuboring va men uni sizga yuklab beraman! 🚀\n\n` +
          `Tarifingizni yangilash uchun /upgrade buyrug'ini bosing.`
        );
        return NextResponse.json({ ok: true });
      }

      // B. Handle /upgrade command
      if (message.text === '/upgrade') {
        await sendUpgradeOptions(telegramApi, chatId);
        return NextResponse.json({ ok: true });
      }

      // C. Handle Receipt photo upload (if photo is received and plan is selected)
      if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
        if (!userDoc.tempSelectedPlan) {
          await sendTelegramMessage(telegramApi, chatId, "⚠️ Avval qaysi tarifga obuna bo'lmoqchiligingizni tanlang. /upgrade buyrug'ini ishlating.");
          return NextResponse.json({ ok: true });
        }

        // Get largest photo file ID
        const photo = message.photo[message.photo.length - 1];
        const fileId = photo.file_id;

        const waitMsgId = await sendTelegramMessage(telegramApi, chatId, "Chek rasmi tahlil qilinmoqda, iltimos kuting... ⏳");

        try {
          // Get File Info from telegram API
          const fileRes = await fetch(`${telegramApi}/getFile?file_id=${fileId}`);
          const fileData = await fileRes.json();
          if (!fileData.ok) throw new Error('File details could not be retrieved');

          const filePath = fileData.result.file_path;
          const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

          // Download image and convert to Base64 data string
          const imgRes = await fetch(downloadUrl);
          const arrayBuf = await imgRes.arrayBuffer();
          const base64Img = `data:image/jpeg;base64,${Buffer.from(arrayBuf).toString('base64')}`;

          // Save base64 image in user tempReceipt field
          await updateDoc(userRef, { tempReceipt: base64Img });

          await deleteTelegramMessage(telegramApi, chatId, waitMsgId);

          // Prompt submit confirm keyboard
          await sendTelegramMessageWithKeyboard(telegramApi, chatId, 
            `📸 **Chek rasmi muvaffaqiyatli yuklandi!**\n\n` +
            `To'lovni tasdiqlash uchun quyidagi tugmalardan foydalaning. Agar xato rasm tashlagan bo'lsangiz o'chiring.`,
            [
              [
                { text: "❌ Rasmni o'chirish", callback_data: "delete_receipt" },
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

      // D. Process video URL
      const text = (message.text || '').trim();
      
      let isUrl = false;
      try {
        if (text.startsWith('http://') || text.startsWith('https://')) {
          new URL(text);
          isUrl = true;
        }
      } catch (e) {}

      if (isUrl) {
        const waitMessageId = await sendTelegramMessage(telegramApi, chatId, "Video tahlil qilinmoqda, iltimos kuting... ⏳");
        
        try {
          const platform = detectPlatform(text);
          const ytDlpPath = await ensureYtDlpBinary();

          // Run yt-dlp to extract info
          const cmd = `"${ytDlpPath}" --dump-json --no-check-certificates --no-warnings -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${text}"`;
          
          let stdoutData = '';
          try {
            const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
            stdoutData = stdout;
          } catch (execError: any) {
            const retryCmd = `"${ytDlpPath}" --dump-json --no-check-certificates --no-warnings -f "best" "${text}"`;
            const { stdout } = await execPromise(retryCmd, { maxBuffer: 10 * 1024 * 1024 });
            stdoutData = stdout;
          }

          const output = JSON.parse(stdoutData);
          if (!output) throw new Error('Info extraction failed');

          const title = output.title || output.fulltitle || 'Video';
          const duration = output.duration || 0;
          const thumbnail = output.thumbnail || '';
          
          // Format duration to MM:SS or HH:MM:SS
          const h = Math.floor(duration / 3600);
          const m = Math.floor((duration % 3600) / 60);
          const s = Math.floor(duration % 60);
          const durationFormatted = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;

          // Extract formats list
          const rawFormats = output.formats || [];
          const formats: any[] = [];
          const seenQualities = new Set<string>();

          for (const fmt of rawFormats) {
            if (!fmt.url || fmt.vcodec === 'none') continue;
            const height = fmt.height || 0;
            let quality = '720p';
            if (height >= 1080) quality = '1080p';
            else if (height >= 720) quality = '720p';
            else if (height >= 480) quality = '480p';
            else if (height >= 360) quality = '360p';
            else if (height > 0) quality = '360p';

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

          // Save results to user tempVideo state to avoid URL length callback query issues
          await updateDoc(userRef, {
            tempVideo: {
              title,
              url: text,
              formats
            }
          });

          // Delete analysis message
          await deleteTelegramMessage(telegramApi, chatId, waitMessageId);

          // Build inline keyboard for formats
          const inlineKeyboard = formats.slice(0, 5).map((f, idx) => {
            return [
              {
                text: `📥 Sifat: ${f.quality} (${f.ext.toUpperCase()})`,
                callback_data: `dl_${idx}`
              }
            ];
          });

          // Send result details with photo thumbnail
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
            if (photoData.ok) {
              return NextResponse.json({ ok: true });
            }
          }

          // Fallback to text if thumbnail failed to send
          await sendTelegramMessageWithKeyboard(telegramApi, chatId, 
            `🎬 **Sarlavha:** ${title}\n` +
            `⏱ **Davomiyligi:** ${durationFormatted}\n` +
            `📱 **Platforma:** ${platform.toUpperCase()}\n\n` +
            `Yuklab olish uchun pastdagi sifat tugmalaridan birini tanlang:`,
            inlineKeyboard
          );

        } catch (err: any) {
          console.error(err);
          await deleteTelegramMessage(telegramApi, chatId, waitMessageId);
          await sendTelegramMessage(telegramApi, chatId, "❌ Kechirasiz, ushbu video havolasini tahlil qilib bo'lmadi. Havola noto'g'ri yoki videoni yuklash taqiqlangan.");
        }
        return NextResponse.json({ ok: true });
      }

      // Default response
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
