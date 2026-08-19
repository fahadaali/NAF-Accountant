#!/usr/bin/env node
// ============================================================================
// تشغيل مسارات الترحيل بالترتيب.
//   npm run db:migrate         (على القاعدة البعيدة)
//   npm run db:migrate:local   (على القاعدة المحلية)
//
// كان `db:migrate` يشغّل 0001 وحده، فمن يتبع خطوات README يحصل على منصة بلا
// تسجيل دخول ولا حوار تفاعلي ولا عمليات متكرّرة — الجداول في 0003 و0004
// و0005 لم يكن لها أمر تشغيل أصلاً.
//
// كل ملف هنا يستعمل CREATE TABLE IF NOT EXISTS، فإعادة التشغيل آمنة.
// ملفات البذور (0002_seed_*) مستثناة: البذر قرار منفصل — npm run db:seed.
// ============================================================================

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'naf-accountant-db';
const DIR = './migrations';

const flags = process.argv.slice(2);
if (!flags.includes('--remote') && !flags.includes('--local')) {
  console.error('حدّد الهدف: --remote أو --local');
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && !/_seed_/.test(f))
  .sort();

if (files.length === 0) {
  console.error(`لا ملفات ترحيل في ${DIR}`);
  process.exit(1);
}

console.log(`تشغيل ${files.length} ملف ترحيل على ${DB}:`);
for (const file of files) {
  console.log(`  → ${file}`);
  const run = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, `--file=${DIR}/${file}`, ...flags],
    { stdio: 'inherit' }
  );
  if (run.status !== 0) {
    console.error(`\nتوقّف عند ${file}. عالج الخطأ ثم أعد التشغيل — الملفات السابقة طُبّقت.`);
    process.exit(run.status ?? 1);
  }
}
console.log('اكتملت الترحيلات.');
