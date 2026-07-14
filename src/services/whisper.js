// ============================================================================
// خدمة تحويل الصوت إلى نص عبر Cloudflare Workers AI (Whisper)
// ============================================================================

/**
 * تفريغ ملف صوتي إلى نص باستخدام نموذج Whisper.
 * @param {ArrayBuffer} audioBuffer - محتوى الملف الصوتي (ogg / mp3).
 * @returns {Promise<string>} النص المُفرّغ.
 */
export async function transcribeAudio(env, audioBuffer) {
  // Workers AI يتوقع مصفوفة من البايتات (Uint8Array -> Array).
  const input = {
    audio: [...new Uint8Array(audioBuffer)],
  };

  const response = await env.AI.run('@cf/openai/whisper', input);

  // النموذج يُرجع كائناً يحتوي على الحقل text.
  const text = (response && response.text ? response.text : '').trim();
  if (!text) {
    throw new Error('Whisper returned empty transcription');
  }
  return text;
}
