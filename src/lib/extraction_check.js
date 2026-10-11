// ============================================================================
// التحقق الحسابي من نتيجة التحليل قبل الترحيل
// ============================================================================
//
// Claude يقرأ الفاتورة، وهذه الوحدة تراجع قراءته بالحساب لا بالذكاء:
// مجموع البنود مقابل المطبوع، والضريبة المحسوبة مقابل المطبوعة، واتزان
// القيد، ووجود رموز الحسابات، ومعقولية التاريخ.
//
// ═══ لماذا هنا لا في التعليمات وحدها ═══
//
// التعليمات تطلب «البنود قبل الضريبة» و«القيد متوازن»، ولا شيء كان يتحقق.
// وأخطر ما يفوت: إيصالٌ أسعاره شاملة الضريبة يُقرأ كما هو، فيضيف النظام
// الضريبة فوقها مرة ثانية — فيدخل الدفتر مبلغٌ أكبر من الورقة ولا يلاحظه
// أحد إلا عند المطابقة.
//
// دوال صرفة بلا شبكة ولا قاعدة — تُختبر مباشرة.
// ============================================================================

/** الأرقام الهندية والفارسية إلى الغربية. */
function westernDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** رقمٌ صالح أو null (المطبوع الغائب يبقى غائباً ولا يصير صفراً). */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(westernDigits(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** بنود المستند ونسبة ضريبته حسب نوع العملية. */
function documentLines(result) {
  if (result.type === 'purchase_bill') {
    return { items: result.bill?.line_items || [], rate: Number(result.bill?.vat_percent ?? 0) };
  }
  if (result.type === 'sales_invoice') {
    return { items: result.invoice?.line_items || [], rate: Number(result.invoice?.vat_percent ?? 0) };
  }
  return null;
}

/**
 * مراجعة نتيجة التحليل.
 *
 * @param {object} result نتيجة `analyzeTransaction`.
 * @param {object} opts
 * @param {Array}  opts.accounts  شجرة الحسابات النشطة.
 * @param {string} opts.todayISO  تاريخ الرسالة YYYY-MM-DD — مرجع «المستقبل».
 * @returns {{ok:boolean, issues:Array<{code:string, message:string}>, warnings:Array<{code:string, message:string}>}}
 *   issues تمنع الترحيل حتى تُصحَّح أو يُؤكَّد، وwarnings تُعرض ولا تمنع.
 */
export function validateExtraction(result, { accounts = [], todayISO = null } = {}) {
  const issues = [];
  const warnings = [];
  const fmt = (n) => round2(n).toFixed(2);

  // ---- رموز الحسابات ----
  // كان الرمز المجهول يُمرَّر إلى وافق كما هو مكان معرّف الحساب.
  const known = new Set(accounts.map((a) => String(a.account_code)));
  const used =
    result.type === 'manual_journal'
      ? result.manual_journal?.entries || []
      : documentLines(result)?.items || [];
  const unknown = [...new Set(used.map((l) => String(l.account_code || '')).filter((c) => !known.has(c)))];
  if (known.size && unknown.length) {
    issues.push({
      code: 'account',
      message: `رموز حسابات ليست في الشجرة: ${unknown.join('، ')}`,
    });
  }

  // ---- اتزان القيد اليدوي ----
  if (result.type === 'manual_journal') {
    const entries = result.manual_journal?.entries || [];
    const debit = round2(entries.reduce((s, e) => s + Number(e.debit || 0), 0));
    const credit = round2(entries.reduce((s, e) => s + Number(e.credit || 0), 0));
    if (Math.abs(debit - credit) > 0.009) {
      issues.push({
        code: 'balance',
        message: `القيد غير متوازن: المدين ${fmt(debit)} والدائن ${fmt(credit)}`,
      });
    }
  }

  // ---- مجاميع الفاتورة مقابل المطبوع ----
  const doc = documentLines(result);
  if (doc) {
    const sub = round2(doc.items.reduce((s, li) => s + Number(li.amount || 0), 0));
    const vat = round2((sub * doc.rate) / 100);
    // تقريب كل بند لمنزلتين عند قسمة الشامل يراكم فرق هللات، فتتّسع
    // السماحية بعدد البنود.
    const tol = 0.05 + 0.01 * doc.items.length;

    const printedSub = num(result.printed_subtotal);
    const printedVat = num(result.printed_vat);
    const printedTotal = num(result.printed_total);

    if (printedTotal !== null && doc.rate > 0 && Math.abs(sub - printedTotal) <= tol) {
      // البنود تساوي الإجمالي المطبوع ونسبة الضريبة موجبة: الأسعار شاملة
      // وقُرئت كما هي — والنظام سيضيف الضريبة فوقها.
      issues.push({
        code: 'vat_inclusive',
        message:
          `مجموع البنود ${fmt(sub)} يساوي الإجمالي المطبوع ${fmt(printedTotal)}، ` +
          `فالأسعار شاملة الضريبة وستُضاف الضريبة مرتين`,
      });
    } else if (printedTotal !== null && Math.abs(sub + vat - printedTotal) > tol) {
      issues.push({
        code: 'total',
        message:
          `البنود ${fmt(sub)} مع ضريبة ${doc.rate}% تعطي ${fmt(sub + vat)}، ` +
          `والإجمالي المطبوع ${fmt(printedTotal)}`,
      });
    }

    if (printedSub !== null && Math.abs(sub - printedSub) > tol) {
      issues.push({
        code: 'subtotal',
        message: `مجموع البنود ${fmt(sub)} والمطبوع قبل الضريبة ${fmt(printedSub)}`,
      });
    }

    if (printedVat !== null && Math.abs(vat - printedVat) > tol) {
      issues.push({
        code: 'vat',
        message: `الضريبة المحسوبة ${fmt(vat)} (${doc.rate}%) والمطبوعة ${fmt(printedVat)}`,
      });
    }
  }

  // ---- التاريخ ----
  const date = String(result.date || '');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (Number.isNaN(parsed)) {
    issues.push({ code: 'date', message: `تاريخ غير صالح: ${date || 'فارغ'}` });
  } else if (todayISO && date > todayISO) {
    // تاريخ هجري حُوّل خطأً يقع غالباً في المستقبل.
    issues.push({ code: 'date', message: `تاريخ العملية ${date} بعد تاريخ الرسالة ${todayISO}` });
  }

  // ---- الرقم الضريبي ----
  // صيغة الرقم الضريبي السعودي: ١٥ رقماً تبدأ بـ٣ وتنتهي بـ٣. خطؤه لا يمنع
  // الترحيل — الرقم لا يُرحَّل — لكنه يُعرض ليُراجَع.
  const vatNo = westernDigits(result.supplier_vat_number || '').replace(/\s+/g, '');
  if (vatNo && !/^3\d{13}3$/.test(vatNo)) {
    warnings.push({ code: 'vat_number', message: `الرقم الضريبي المقروء لا يطابق الصيغة: ${vatNo}` });
  }

  return { ok: issues.length === 0, issues, warnings };
}

/**
 * نصّ المراجعة الذي يُعاد به التحليل مرةً واحدة: ما اختلّ تحديداً.
 * يُكتب للنموذج لا للمستخدم.
 */
export function correctionPrompt(issues) {
  return (
    '# مراجعة آلية لقراءتك السابقة — وُجد فيها خلل:\n' +
    issues.map((i) => `- ${i.message}`).join('\n') +
    '\nأعد قراءة المرفق والنص بعناية وصحّح النتيجة. تذكّر: مبالغ البنود قبل الضريبة دائماً، ' +
    'والمجاميع المطبوعة تُنقل حرفياً كما هي، ورموز الحسابات من الشجرة وحدها. ' +
    'وإن كانت القراءة الأولى صحيحة والفاتورة نفسها غير متسقة فأبقِها كما هي.'
  );
}
