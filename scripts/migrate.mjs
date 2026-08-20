#!/usr/bin/env node
// ============================================================================
// تشغيل مسارات الترحيل بالترتيب.
//   npm run db:migrate         (القاعدة البعيدة)
//   npm run db:migrate:local   (القاعدة المحلية)
//
// ═══ لماذا ملف واحد بدل أمرٍ لكل ترحيل ═══
//
// كان `db:migrate` يشغّل `0001` وحده، ولـ`0006` و`0007` أمران منفصلان
// يُشغَّلان باليد، و`0003` و`0004` و`0005` بلا أمر إطلاقاً. فمن اتّبع خطوات
// README حصل على منصة بلا جدول `conversation_state` ولا `telegram_chats`
// ولا `recurring_transactions` — أي بلا حوار تفاعلي ولا إدارة محادثات ولا
// عمليات متكرّرة، ولا شيء يقول له لماذا.
//
// وكل ملف هنا يستعمل `CREATE TABLE IF NOT EXISTS`، فإعادة التشغيل آمنة،
// وإضافة ترحيل جديد لا تحتاج أمراً جديداً.
//
// وملفات البذور (`0002_seed_*`) مستثناة: البذر قرار منفصل — `npm run db:seed`.
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
    console.error(`\nتوقّف عند ${file}. عالج الخطأ ثم أعد التشغيل — ما سبقه طُبّق.`);
    process.exit(run.status ?? 1);
  }
}
console.log('اكتملت الترحيلات.');
