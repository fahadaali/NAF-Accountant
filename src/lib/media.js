// ============================================================================
// وحدة الوسائط — كشف الصيغة وتحضيرها لتحليل Claude
// ============================================================================
//
// مصدر الفواتير في هذه المنصة هو تليجرام، والمرسِل غالباً هاتف. لذلك تصل
// الملفات بصيغ متعددة لا يقبلها Claude كلّها:
//
//   • يقبل Claude صوراً بصيغ: JPEG و PNG و GIF و WebP فقط.
//   • يقبل مستندات PDF مباشرة (نصّاً ورؤيةً لكل صفحة).
//   • لا يقبل HEIC/HEIF (الصيغة الافتراضية لكاميرا الآيفون) ولا AVIF
//     ولا TIFF/DNG ولا BMP.
//
// دور هذه الوحدة: كشف الصيغة الحقيقية من البايتات الأولى (لا من إعلان
// تليجرام ولا من امتداد الاسم — كلاهما يكذب)، ثم تحويل ما لا يقبله Claude
// إلى JPEG عبر ربط Cloudflare Images، وتصغير ما تجاوز حدّ الحجم.
// ============================================================================

/* عزل اتجاهي للقيم داخل الجمل العربية — U+2068 و U+2069.
   نفس تعريف `isolate` في naf-format بالسجلّ؛ يُكرَّر هنا لأن الخادم
   لا يستورد من frontend/src/naf. أي تغيير يحدث في السجلّ أولاً. */
const iso = (v) => `⁨${v}⁩`;

/** صيغ الصور التي يقبلها Claude كما هي، بلا تحويل. */
export const CLAUDE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** حدّ Claude لحجم الصورة (~5MB). نبقى دونه بهامش أمان. */
export const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;

/**
 * حدّ حجم ملف PDF قبل الترميز.
 * حدّ Claude للطلب كاملاً 32 ميغابايت، وترميز base64 يزيد الحجم الثلث،
 * كما أن ذاكرة الـ Worker محدودة بـ128 ميغابايت والترميز يحتفظ بنسختين
 * مؤقتاً. عشرة ميغابايت تغطّي فواتير المسح الضوئي متعددة الصفحات وتبقى
 * بعيدة عن الحدّين.
 */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** أقصى بُعد للصورة بعد التحويل — يكفي لقراءة أرقام الفاتورة ويقلّل الحجم. */
const CONVERT_LADDER = [
  { width: 2200, quality: 88 },
  { width: 1600, quality: 80 },
  { width: 1200, quality: 70 },
];

/** الامتداد المناسب لكل نوع MIME عند الحفظ في R2. */
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
};

/** اسم الصيغة كما يعرفه المستخدم (لرسائل الخطأ). */
const LABEL_BY_TYPE = {
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/avif': 'AVIF',
  'image/tiff': 'TIFF',
  'image/bmp': 'BMP',
};

/** علامات ISO-BMFF التي تدلّ على صورة HEIF/HEIC (كاميرا الآيفون). */
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', // HEIC — صورة مفردة
  'hevc', 'hevx', 'hevm', 'hevs', // HEVC — تسلسل صور
  'mif1', 'msf1', 'miaf',         // HEIF عام (يشمل صور «التقاط مباشر»)
]);

/** علامات ISO-BMFF التي تدلّ على صورة AVIF. */
const AVIF_BRANDS = new Set(['avif', 'avis', 'av01']);

/** قراءة أربعة محارف ASCII من موضع محدّد. */
function fourCC(bytes, offset) {
  if (bytes.length < offset + 4) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * كشف نوع الملف الحقيقي من البايتات الأولى (magic bytes).
 * لا نثق بما يعلنه تليجرام ولا بامتداد اسم الملف: الأول يستنتجه من الامتداد،
 * والثاني يكتبه المرسِل.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string|null} نوع MIME، أو null إن كانت الصيغة غير معروفة.
 */
export function sniffMediaType(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length < 12) return null;

  // PDF: "%PDF-"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf';
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // WEBP: "RIFF"...."WEBP"
  if (fourCC(b, 0) === 'RIFF' && fourCC(b, 8) === 'WEBP') return 'image/webp';
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  // TIFF (ويشمل DNG من وضع ProRAW في الآيفون): II*\0 أو MM\0*
  if (
    (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
    (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)
  ) {
    return 'image/tiff';
  }
  // ISO-BMFF: [حجم 4 بايت]"ftyp"[العلامة 4 بايت] — منها HEIC و HEIF و AVIF.
  if (fourCC(b, 4) === 'ftyp') {
    const brand = fourCC(b, 8);
    if (AVIF_BRANDS.has(brand)) return 'image/avif';
    if (HEIF_BRANDS.has(brand)) return brand.startsWith('hei') || brand.startsWith('hev')
      ? 'image/heic'
      : 'image/heif';
  }

  return null;
}

/** الامتداد المناسب لنوع MIME (افتراضياً bin). */
export function extensionFor(mediaType) {
  return EXT_BY_TYPE[mediaType] || 'bin';
}

/** ترميز ArrayBuffer إلى base64 على دفعات (سلسلة واحدة تتجاوز حدّ المُعاملات). */
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * تحويل صورة إلى JPEG عبر ربط Cloudflare Images، مع تصغيرها حتى تنزل
 * تحت حدّ الحجم. يقبل الربط صيغ HEIC و AVIF وغيرها ممّا لا يقبله Claude.
 *
 * @param {object} env
 * @param {ArrayBuffer} buffer
 * @param {string} sourceType نوع الصورة الأصلية (لرسالة الخطأ).
 * @returns {Promise<ArrayBuffer>} بايتات JPEG.
 */
async function convertToJpeg(env, buffer, sourceType) {
  const label = LABEL_BY_TYPE[sourceType] || sourceType;

  if (!env.IMAGES) {
    throw new Error(
      `تعذّرت قراءة صورة بصيغة ${iso(label)}: خدمة تحويل الصور غير مفعّلة. ` +
        `أرسل الصورة بصيغة ${iso('JPG')} أو ${iso('PNG')}، أو أرسل الفاتورة كملف ${iso('PDF')}.`
    );
  }

  let lastError = null;
  for (const step of CONVERT_LADDER) {
    try {
      const result = await env.IMAGES.input(new Blob([buffer]).stream())
        .transform({ width: step.width, fit: 'scale-down' })
        .output({ format: 'image/jpeg', quality: step.quality });
      const out = await result.response().arrayBuffer();
      if (out.byteLength <= MAX_IMAGE_BYTES) return out;
      lastError = new Error('الصورة ما تزال أكبر من الحدّ بعد التصغير');
    } catch (e) {
      lastError = e;
      // خطأ الربط نفسه (صيغة لا يقبلها) لا يُصلحه تصغير أصغر — لا داعي للمتابعة.
      break;
    }
  }

  throw new Error(
    `تعذّر تحويل صورة بصيغة ${iso(label)} إلى صيغة مقروءة (${lastError?.message || 'سبب غير معروف'}). ` +
      `أرسلها بصيغة ${iso('JPG')} أو ${iso('PNG')}، أو أرسل الفاتورة كملف ${iso('PDF')}. ` +
      `وعلى الآيفون يمكن ضبط: الإعدادات ← الكاميرا ← التنسيقات ← «الأكثر توافقاً».`
  );
}

/**
 * تحضير ملف وارد لتحليل Claude.
 *
 * يكشف الصيغة، ويحوّل ما يلزم تحويله، ويُرجع ما يُرسل إلى Claude مع ما
 * يُحفظ في R2. عند التحويل يُرجع الأصل أيضاً ليُحفظ إلى جانب النسخة —
 * لا نستبدل ملفاً أرسله المستخدم بنسخة معالَجة.
 *
 * @param {object} env
 * @param {ArrayBuffer} buffer بايتات الملف كما وصل.
 * @returns {Promise<{
 *   kind: 'image'|'document',
 *   mediaType: string,
 *   base64: string,
 *   bytes: ArrayBuffer,
 *   originalType: string,
 *   originalBytes: ArrayBuffer|null,
 * }>}
 */
export async function prepareMedia(env, buffer) {
  const detected = sniffMediaType(buffer);

  if (!detected) {
    throw new Error(
      `صيغة الملف غير مدعومة. الصيغ المقبولة: ${iso('PDF')} و ${iso('JPG')} و ${iso('PNG')} ` +
        `و ${iso('HEIC')} و ${iso('WebP')} و ${iso('GIF')} و ${iso('AVIF')} و ${iso('TIFF')} و ${iso('BMP')}.`
    );
  }

  // ---- مستند PDF: يقرأه Claude مباشرة، بلا تحويل ----
  if (detected === 'application/pdf') {
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error(
        `حجم ملف ${iso('PDF')} يتجاوز الحد المسموح (${iso('10')} ميغابايت). ` +
          `أرسل الصفحات المطلوبة فقط، أو صوّر الفاتورة.`
      );
    }
    return {
      kind: 'document',
      mediaType: 'application/pdf',
      base64: arrayBufferToBase64(buffer),
      bytes: buffer,
      originalType: detected,
      originalBytes: null,
    };
  }

  // ---- صورة بصيغة يقبلها Claude ----
  if (CLAUDE_IMAGE_TYPES.includes(detected)) {
    if (buffer.byteLength <= MAX_IMAGE_BYTES) {
      return {
        kind: 'image',
        mediaType: detected,
        base64: arrayBufferToBase64(buffer),
        bytes: buffer,
        originalType: detected,
        originalBytes: null,
      };
    }
    // كبيرة على Claude — نصغّرها بدل رفضها.
    const resized = await convertToJpeg(env, buffer, detected);
    return {
      kind: 'image',
      mediaType: 'image/jpeg',
      base64: arrayBufferToBase64(resized),
      bytes: resized,
      originalType: detected,
      originalBytes: buffer,
    };
  }

  // ---- صيغة لا يقبلها Claude (HEIC من الآيفون وغيرها) — تُحوَّل ----
  const converted = await convertToJpeg(env, buffer, detected);
  return {
    kind: 'image',
    mediaType: 'image/jpeg',
    base64: arrayBufferToBase64(converted),
    bytes: converted,
    originalType: detected,
    originalBytes: buffer,
  };
}

/**
 * تحضير ملف مخزّن في R2 لإعادة إرساله إلى Claude (استكمال حوار سابق).
 * الملف المخزّن سبق أن مرّ بالتحويل، فلا نحوّله مرة أخرى ولا نرفع خطأ عند
 * تلفه — نتابع بالنص وحده.
 *
 * @returns {{kind:'image'|'document', mediaType:string, base64:string}|null}
 */
export function prepareStoredMedia(buffer) {
  const detected = sniffMediaType(buffer);
  if (!detected) return null;

  if (detected === 'application/pdf') {
    if (buffer.byteLength > MAX_PDF_BYTES) return null;
    return { kind: 'document', mediaType: detected, base64: arrayBufferToBase64(buffer) };
  }
  if (CLAUDE_IMAGE_TYPES.includes(detected) && buffer.byteLength <= MAX_IMAGE_BYTES) {
    return { kind: 'image', mediaType: detected, base64: arrayBufferToBase64(buffer) };
  }
  return null;
}
