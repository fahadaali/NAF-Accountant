// ============================================================================
// سحب التقارير المالية من وافق (بيانات JSON)
// ============================================================================
//
// مهم: يجب إرسال ترويسة Accept: application/json وإلا تُرجع وافق صفحة HTML
// (واجهة DRF التصفّحية) بدل البيانات.
//
// نقاط النهاية (قد تحتاج تعديلاً بسيطاً حسب حسابك):
//   GET /v1/reports/profit_and_loss/
//   GET /v1/reports/trial_balance/
//   المعاملات: currency, date_after, date_before
// ============================================================================

async function fetchReport(env, path, params) {
  const base = env.WAFEQ_API_BASE || 'https://api.wafeq.com/v1';
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/${path}/?${qs}`, {
    headers: {
      Authorization: `Api-Key ${env.WAFEQ_API_KEY}`,
      Accept: 'application/json', // حاسم: يمنع رجوع HTML
    },
  });

  const ct = res.headers.get('content-type') || '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`Wafeq report ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (!ct.includes('json')) {
    throw new Error(
      `Wafeq report ${path} لم يُرجع JSON (نوع: ${ct}). قد يكون مسار التقرير مختلفاً في حسابك.`
    );
  }
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error(`تعذّر تحليل رد تقرير ${path} كـ JSON.`);
  }
}

/** قائمة الدخل (الأرباح والخسائر) لفترة. */
export function getProfitAndLoss(env, dateAfter, dateBefore) {
  return fetchReport(env, 'reports/profit_and_loss', {
    currency: env.WAFEQ_CURRENCY || 'SAR',
    date_after: dateAfter,
    date_before: dateBefore,
  });
}

/** ميزان المراجعة لفترة. */
export function getTrialBalance(env, dateAfter, dateBefore) {
  return fetchReport(env, 'reports/trial_balance', {
    currency: env.WAFEQ_CURRENCY || 'SAR',
    date_after: dateAfter,
    date_before: dateBefore,
  });
}
