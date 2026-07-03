/**
 * weekly_sheets テスト問題更新スクリプト
 *
 * 【実行方法】
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   WEEK_START_DATE=2026-06-29 \
 *   TEST1_JSON='[{"sentence":"...","answer":"...","hint":"..."}]' \
 *   TEST2_JSON='[{"sentence":"...","answer":"...","hint":"..."}]' \
 *   node scripts/update-test-questions.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY     = process.env.VITE_SUPABASE_ANON_KEY;
const WEEK_START_DATE  = process.env.WEEK_START_DATE;
const TEST1_JSON       = process.env.TEST1_JSON;
const TEST2_JSON       = process.env.TEST2_JSON;

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未設定'); process.exit(1); }
if (!WEEK_START_DATE) { console.error('❌ WEEK_START_DATE 未設定'); process.exit(1); }
if (!TEST1_JSON)      { console.error('❌ TEST1_JSON 未設定'); process.exit(1); }
if (!TEST2_JSON)      { console.error('❌ TEST2_JSON 未設定'); process.exit(1); }

let test1, test2;
try {
  test1 = JSON.parse(TEST1_JSON);
} catch (e) {
  console.error('❌ TEST1_JSON のパースに失敗:', e.message);
  process.exit(1);
}
try {
  test2 = JSON.parse(TEST2_JSON);
} catch (e) {
  console.error('❌ TEST2_JSON のパースに失敗:', e.message);
  process.exit(1);
}

if (!Array.isArray(test1)) { console.error('❌ TEST1_JSON が配列ではありません'); process.exit(1); }
if (!Array.isArray(test2)) { console.error('❌ TEST2_JSON が配列ではありません'); process.exit(1); }

console.log(`📋 ${WEEK_START_DATE} のテスト問題を更新します`);
console.log(`  test1: ${test1.length} 問`);
console.log(`  test2: ${test2.length} 問`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { error } = await supabase
  .from('weekly_sheets')
  .update({ test1_questions: test1, test2_questions: test2 })
  .eq('week_start_date', WEEK_START_DATE);

if (error) {
  console.error('❌ Supabase UPDATE 失敗:', error.message);
  process.exit(1);
}

console.log(`✅ 완료: ${WEEK_START_DATE}`);
console.log(`  test1_questions: ${test1.length} 問`);
console.log(`  test2_questions: ${test2.length} 問`);
