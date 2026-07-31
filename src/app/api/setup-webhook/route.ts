import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    if (!BOT_TOKEN) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN env variable topilmadi' }, { status: 500 });
    }

    // Serverning o'z URL manzilini aniqlash
    const host = request.headers.get('host') || '';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const webhookUrl = `${protocol}://${host}/api/telegram`;

    // Telegram API ga webhook o'rnatish so'rovi
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'callback_query'],
          drop_pending_updates: true,
        }),
      }
    );

    const result = await response.json();

    if (result.ok) {
      return NextResponse.json({
        success: true,
        message: '✅ Webhook muvaffaqiyatli ulandi!',
        webhook_url: webhookUrl,
        telegram_response: result,
      });
    } else {
      return NextResponse.json({
        success: false,
        message: '❌ Webhook ulanmadi',
        webhook_url: webhookUrl,
        telegram_response: result,
      }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: `Xato yuz berdi: ${error.message}` },
      { status: 500 }
    );
  }
}

// Webhook holatini tekshirish
export async function DELETE(request: NextRequest) {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!BOT_TOKEN) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN topilmadi' }, { status: 500 });
    }

    // Webhook info olish
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const info = await infoRes.json();

    return NextResponse.json({ webhook_info: info });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
