// ============================================================================
// خط المعالجة الرئيسي (Processing Pipeline)
// يُستدعى بشكل غير متزامن عبر ctx.waitUntil() لتجنب مهلة تليجرام.
// ============================================================================

import {
  writeLog,
  createTransaction,
  updateTransaction,
  getActiveAccounts,
} from './db.js';
import {
  sendTelegramMessage,
  downloadTelegramFile,
} from '../services/telegram.js';
import { transcribeAudio } from '../services/whisper.js';
import { analyzeWithClaude } from '../services/claude.js';
import { postJournalEntryDraft } from '../services/wafeq.js';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * صياغة رسالة تأكيد عربية تلخّص القيد.
 */
function buildConfirmation(entries, wafeqDraftId) {
  const lines = entries
    .map((e) => {
      const side = Number(e.debit) > 0 ? `مدين ${e.debit}` : `دائن ${e.credit}`;
      return `• ${e.account_name} — ${side}`;
    })
    .join('\n');

  const total = entries.reduce((s, e) => s + Number(e.debit || 0), 0);

  return (
    `✅ <b>تم إنشاء قيد مسودة في وافق</b>\n\n` +
    `${lines}\n\n` +
    `💰 <b>الإجمالي:</b> ${total}\n` +
    `🧾 <b>رقم المسودة:</b> ${wafeqDraftId || 'غير متوفر'}\n\n` +
    `⚠️ القيد بحالة <b>مسودة</b> ويتطلب مراجعتك واعتمادك يدوياً في وافق.`
  );
}

/**
 * معالجة تحديث تليجرام كاملاً (نص / صوت / صورة).
 */
export async function processTelegramUpdate(env, update) {
  const message = update.message || update.edited_message;
  if (!message) return;

  const chatId = message.chat.id;
  const messageId = message.message_id;

  let sourceType = 'text';
  if (message.voice || message.audio) sourceType = 'voice';
  else if (message.photo || (message.document && /image/.test(message.document.mime_type || '')))
    sourceType = 'image';

  const txId = await createTransaction(env.DB, {
    telegramMessageId: String(messageId),
    telegramChatId: String(chatId),
    sourceType,
    rawText: message.text || message.caption || null,
    status: 'received',
  });

  try {
    let finalText = message.text || message.caption || '';
    let image = null;

    // ---- معالجة الصوت ----
    if (sourceType === 'voice') {
      const audio = message.voice || message.audio;
      const buffer = await downloadTelegramFile(env, audio.file_id);

      const r2Key = `voice/${chatId}/${messageId}.ogg`;
      await env.MEDIA.put(r2Key, buffer, {
        httpMetadata: { contentType: audio.mime_type || 'audio/ogg' },
      });
      await updateTransaction(env.DB, txId, { mediaR2Key: r2Key, status: 'transcribed' });

      finalText = await transcribeAudio(env, buffer);
      await updateTransaction(env.DB, txId, { rawText: finalText });
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'whisper_transcribe',
        status: 'success',
      });
    }

    // ---- معالجة الصورة (فاتورة) ----
    if (sourceType === 'image') {
      let fileId, mediaType;
      if (message.photo) {
        // أعلى دقة = آخر عنصر
        fileId = message.photo[message.photo.length - 1].file_id;
        mediaType = 'image/jpeg';
      } else {
        fileId = message.document.file_id;
        mediaType = message.document.mime_type || 'image/jpeg';
      }

      const buffer = await downloadTelegramFile(env, fileId);
      const ext = mediaType.split('/')[1] || 'jpg';
      const r2Key = `invoice/${chatId}/${messageId}.${ext}`;
      await env.MEDIA.put(r2Key, buffer, { httpMetadata: { contentType: mediaType } });
      await updateTransaction(env.DB, txId, { mediaR2Key: r2Key });

      image = { mediaType, base64: arrayBufferToBase64(buffer) };
      await writeLog(env.DB, {
        transactionId: txId,
        action: 'image_saved_r2',
        status: 'success',
      });
    }

    if (!finalText && !image) {
      throw new Error('لا يوجد محتوى قابل للمعالجة في الرسالة');
    }

    // ---- التحليل الذكي عبر Claude ----
    const accounts = await getActiveAccounts(env.DB);
    if (accounts.length === 0) {
      throw new Error('شجرة الحسابات فارغة — الرجاء تعبئتها أولاً');
    }

    const entries = await analyzeWithClaude(env, accounts, finalText, image);
    await updateTransaction(env.DB, txId, {
      processedJson: JSON.stringify(entries),
      status: 'analyzed',
    });
    await writeLog(env.DB, { transactionId: txId, action: 'claude_analyze', status: 'success' });

    // ---- الترحيل إلى وافق كمسودة ----
    const desc = `قيد آلي من تليجرام — رسالة #${messageId}`;
    const { id: wafeqDraftId } = await postJournalEntryDraft(env, accounts, entries, desc);

    await updateTransaction(env.DB, txId, {
      wafeqDraftId,
      status: 'posted',
    });
    await writeLog(env.DB, { transactionId: txId, action: 'wafeq_post', status: 'success' });

    // ---- تأكيد للمستخدم ----
    await sendTelegramMessage(env, chatId, buildConfirmation(entries, wafeqDraftId));
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await updateTransaction(env.DB, txId, { status: 'failed', errorMessage: msg });
    await writeLog(env.DB, {
      transactionId: txId,
      action: 'process_error',
      status: 'error',
      errorDetails: msg,
    });
    try {
      await sendTelegramMessage(
        env,
        chatId,
        `❌ <b>تعذّرت معالجة العملية</b>\n\nالسبب: ${msg}\n\nيرجى المحاولة مرة أخرى أو التواصل مع الدعم.`
      );
    } catch (_) {
      /* تجاهل فشل إرسال رسالة الخطأ */
    }
  }
}
