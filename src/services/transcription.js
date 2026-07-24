// ============================================================================
// خدمة تحويل الصوت إلى نص (قابلة للتبديل بين مزوّدات)
// ============================================================================
//
// اختيار المزوّد تلقائياً حسب المفاتيح المتوفّرة (أو أجبره عبر ASR_PROVIDER):
//   1) elevenlabs — الأدق للعربية.   يتطلب: ELEVENLABS_API_KEY
//   2) openai     — دقة عالية جداً.  يتطلب: OPENAI_API_KEY
//   3) cloudflare — الافتراضي (بلا مفتاح إضافي)، دقته للعربية محدودة.
//
// عند فشل مزوّد مدفوع، نعود تلقائياً إلى Cloudflare حتى لا تتعطّل العملية.
// ============================================================================

/** توجيه قصير جداً — التوجيه الطويل يسبب هلوسة في Whisper. */
const SHORT_PROMPT = 'معاملة محاسبية بالريال السعودي.';

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fileName(mimeType) {
  const ext = (mimeType || '').includes('mpeg')
    ? 'mp3'
    : (mimeType || '').includes('wav')
      ? 'wav'
      : (mimeType || '').includes('mp4') || (mimeType || '').includes('m4a')
        ? 'm4a'
        : 'ogg';
  return `voice.${ext}`;
}

/** أي مزوّد نستخدم؟ */
export function pickProvider(env) {
  const forced = (env.ASR_PROVIDER || '').toLowerCase().trim();
  if (forced) return forced;
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'cloudflare';
}

// ---------------------------------------------------------------------------
// المزوّدات
// ---------------------------------------------------------------------------

/** ElevenLabs Scribe — الأدق للعربية. */
async function viaElevenLabs(env, buffer, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), fileName(mimeType));
  form.append('model_id', env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  form.append('language_code', 'ara'); // العربية (ISO-639-3)

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs STT failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.text || '').trim();
}

/** OpenAI gpt-4o-transcribe — دقة عالية جداً. */
async function viaOpenAI(env, buffer, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/ogg' }), fileName(mimeType));
  form.append('model', env.OPENAI_STT_MODEL || 'gpt-4o-transcribe');
  form.append('language', 'ar');
  form.append('prompt', SHORT_PROMPT);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI STT failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.text || '').trim();
}

/**
 * Cloudflare Workers AI — الافتراضي.
 * ملاحظات مهمة للدقة:
 *  - لا نفعّل vad_filter: قد يقتطع الكلام في المقاطع القصيرة/الهادئة فيخرج فارغاً.
 *  - التوجيه الأولي قصير جداً: التوجيه الطويل يسبب هلوسة ومخرجات غير مرتبطة.
 */
async function viaCloudflare(env, buffer) {
  const model = env.WHISPER_MODEL || '@cf/openai/whisper-large-v3-turbo';
  const response = await env.AI.run(model, {
    audio: bufferToBase64(buffer),
    task: 'transcribe',
    language: 'ar',
    initial_prompt: env.WHISPER_PROMPT || SHORT_PROMPT,
  });
  return (response && response.text ? response.text : '').trim();
}

// ---------------------------------------------------------------------------
// الواجهة العامة
// ---------------------------------------------------------------------------

/**
 * تفريغ مقطع صوتي إلى نص عربي.
 * @param {ArrayBuffer} buffer   محتوى الملف الصوتي.
 * @param {string} [mimeType]    نوع المحتوى كما ورد من تليجرام (ogg غالباً).
 * @returns {Promise<string>}
 */
export async function transcribeAudio(env, buffer, mimeType) {
  const provider = pickProvider(env);

  try {
    let text = '';
    if (provider === 'elevenlabs' && env.ELEVENLABS_API_KEY) {
      text = await viaElevenLabs(env, buffer, mimeType);
    } else if (provider === 'openai' && env.OPENAI_API_KEY) {
      text = await viaOpenAI(env, buffer, mimeType);
    } else {
      text = await viaCloudflare(env, buffer);
    }
    if (text) return text;
    // نص فارغ من مزوّد مدفوع → جرّب Cloudflare قبل الاستسلام.
    if (provider !== 'cloudflare') {
      const fallback = await viaCloudflare(env, buffer);
      if (fallback) return fallback;
    }
  } catch (err) {
    // فشل المزوّد المدفوع → رجوع آمن إلى Cloudflare.
    if (provider !== 'cloudflare') {
      const fallback = await viaCloudflare(env, buffer);
      if (fallback) return fallback;
    } else {
      throw err;
    }
  }

  throw new Error(
    'لم يتم استخراج نص من المقطع الصوتي. حاول التسجيل في مكان هادئ، أو أرسل العملية نصاً.'
  );
}
