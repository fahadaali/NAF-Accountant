// ============================================================================
// خدمة تحويل الصوت إلى نص عبر Cloudflare Workers AI
// النموذج: whisper-large-v3-turbo (أدق بكثير للعربية من النسخة الأساسية)
// ============================================================================

// توجيه أولي بمصطلحات محاسبية عربية يحسّن دقة التعرّف على الكلمات المهمة.
const DEFAULT_PROMPT =
  'معاملة محاسبية لشركة ناف القانونية بالريال السعودي. مصطلحات متوقعة: ' +
  'قيد، مدين، دائن، فاتورة مشتريات، فاتورة بيع، ضريبة القيمة المضافة، ' +
  'سداد، مشتريات، إيجار، رواتب، الصندوق، الخزينة، المصروفات النثرية، ' +
  'البنك، تحويل، مصروف، إيراد، اشتراك، عميل، مورّد.';

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
 * تفريغ ملف صوتي إلى نص عربي باستخدام whisper-large-v3-turbo.
 * @param {ArrayBuffer} audioBuffer - محتوى الملف الصوتي (ogg / mp3 / m4a).
 * @returns {Promise<string>} النص المُفرّغ.
 */
export async function transcribeAudio(env, audioBuffer) {
  const model = env.WHISPER_MODEL || '@cf/openai/whisper-large-v3-turbo';

  const response = await env.AI.run(model, {
    audio: arrayBufferToBase64(audioBuffer), // النموذج يتوقع base64 نصاً
    task: 'transcribe',
    language: 'ar',
    initial_prompt: env.WHISPER_PROMPT || DEFAULT_PROMPT,
    vad_filter: true, // إزالة الصمت/الضوضاء لتحسين الدقة
    beam_size: Number(env.WHISPER_BEAM_SIZE || 8), // بحث أوسع = دقة أعلى
  });

  const text = (response && response.text ? response.text : '').trim();
  if (!text) {
    throw new Error('لم يتم استخراج نص من المقطع الصوتي (قد يكون صامتاً أو غير واضح).');
  }
  return text;
}
