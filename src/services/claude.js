// ============================================================================
// خدمة الذكاء الاصطناعي (Claude API - Anthropic)
// تحليل النصوص واستخراج قيود اليومية + قدرات الرؤية للفواتير.
// ============================================================================

/**
 * بناء توجيه النظام (System Prompt) مع حقن شجرة الحسابات.
 */
function buildSystemPrompt(accounts) {
  const accountsList = accounts
    .map((a) => `- ${a.account_code} | ${a.account_name} (${a.account_type})`)
    .join('\n');

  return `أنت محاسب قانوني خبير في شركة ناف لو. حلل المدخلات التالية وقم بتوجيهها كقيد مزدوج (مدين/دائن) بناءً حصرياً على شجرة الحسابات هذه:

${accountsList}

أرجع استجابتك بصيغة مصفوفة JSON صحيحة تماماً تتطابق مع متطلبات Wafeq API لإنشاء قيود اليومية (Journal Entries). لا تضف أي نصوص أخرى أو تنسيقات Markdown.

يجب أن يكون لكل عنصر في المصفوفة الحقول التالية:
- "account_code": رمز الحساب من شجرة الحسابات أعلاه (نص).
- "account_name": اسم الحساب المطابق (نص).
- "debit": المبلغ المدين (رقم، أو 0).
- "credit": المبلغ الدائن (رقم، أو 0).
- "description": وصف موجز للسطر بالعربية (نص).

قواعد صارمة:
1. استخدم رموز الحسابات الموجودة في القائمة أعلاه فقط. لا تخترع حسابات جديدة.
2. يجب أن يتساوى مجموع المدين مع مجموع الدائن (قيد متوازن).
3. أعد المصفوفة فقط دون أي مفتاح خارجي أو شرح.`;
}

/**
 * استخراج أول مصفوفة/كائن JSON من نص قد يحتوي على زوائد.
 */
function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // محاولة استخراج من داخل النص
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Failed to parse JSON from Claude response: ' + trimmed.slice(0, 200));
  }
}

/**
 * استدعاء Claude لتحليل نص العملية وإنتاج أسطر القيد.
 * @param {Array} accounts - شجرة الحسابات النشطة.
 * @param {string} inputText - نص العملية.
 * @param {object|null} image - اختياري: { mediaType, base64 } لتحليل فاتورة بالرؤية.
 */
export async function analyzeWithClaude(env, accounts, inputText, image = null) {
  const system = buildSystemPrompt(accounts);

  const userContent = [];

  if (image) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.base64,
      },
    });
    userContent.push({
      type: 'text',
      text:
        (inputText ? `ملاحظة مرفقة: ${inputText}\n\n` : '') +
        'هذه صورة فاتورة. استخرج بياناتها (المورّد، البنود، المبالغ، الضريبة إن وُجدت) وحوّلها إلى قيد يومية بناءً على شجرة الحسابات.',
    });
  } else {
    userContent.push({ type: 'text', text: inputText });
  }

  const res = await fetch(`${env.CLAUDE_API_BASE || 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || 'claude-opus-4-8',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const textPart = (data.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  const entries = extractJson(textPart);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Claude did not return a valid non-empty journal array');
  }
  return entries;
}
