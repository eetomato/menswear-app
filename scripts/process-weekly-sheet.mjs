/**
 * 학습 시트 자동처리 스크립트
 *
 * 【SHEET_TEXT 형식】
 * ## Situation タイトル
 * Pattern: 文1 → 文2 → 文3
 * EN: English sentence
 * JP: 日本語訳
 * EN: ...
 * JP: ...
 *
 * 【実行方法】
 *   ANTHROPIC_API_KEY=... VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
 *   WEEK_START_DATE=2026-06-29 TITLE="6/29~" SHEET_TEXT="..." \
 *   node scripts/process-weekly-sheet.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ── 環境変数 ──────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY      = process.env.VITE_SUPABASE_ANON_KEY;
const SHEET_TEXT        = process.env.SHEET_TEXT;
const WEEK_START_DATE   = process.env.WEEK_START_DATE;
const TITLE             = process.env.TITLE || `${WEEK_START_DATE}~`;

if (!ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY 未設定'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未設定'); process.exit(1); }
if (!SHEET_TEXT)        { console.error('❌ SHEET_TEXT 未設定'); process.exit(1); }
if (!WEEK_START_DATE)   { console.error('❌ WEEK_START_DATE 未設定'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SHEET_TEXT パーサー ────────────────────────────────────────
function parseSheetText(text) {
  // 1行で渡された場合も対応:
  //  1) 全角コロン「：」→ 半角「:」、全角スペース → 半角（日本IME対策）
  //  2) キーワード前後の空白を柔軟にマッチ、大文字小文字も無視
  const normalized = text
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .replace(/\s*##\s+/g, '\n## ')
    .replace(/\s*Pattern\s*:\s*/gi, '\nPattern: ')
    .replace(/\s*EN\s*:\s*/gi, '\nEN: ')
    .replace(/\s*JP\s*:\s*/gi, '\nJP: ')
    .trim();

  const situations = [];
  const lines = normalized.split(/\r?\n/);
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('## ')) {
      if (current && current.sentences.length > 0) situations.push(current);
      current = { title: line.slice(3).trim(), pattern: '', sentences: [] };
    } else if (current) {
      if (line.startsWith('Pattern:')) {
        current.pattern = line.slice('Pattern:'.length).trim();
      } else if (line.startsWith('EN:')) {
        const enText = line.slice(3).trim();
        if (enText) current.sentences.push({ text: enText, translation: '' });
      } else if (line.startsWith('JP:')) {
        const jp = line.slice(3).trim();
        if (current.sentences.length > 0) {
          current.sentences[current.sentences.length - 1].translation = jp;
        }
      }
    }
  }

  if (current && current.sentences.length > 0) situations.push(current);
  return situations;
}

// ── JSON 抽出ヘルパー (Claudeがmarkdownで包んだ場合の対策) ─────
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1].trim());
  const first = text.indexOf('[') !== -1 ? text.indexOf('[') : text.indexOf('{');
  const last  = text.lastIndexOf(']') !== -1 ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (first !== -1 && last !== -1) return JSON.parse(text.slice(first, last + 1));
  return JSON.parse(text.trim());
}

// ── Anthropic API 呼び出し ─────────────────────────────────────
async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

// ── チャンク分割生成 ───────────────────────────────────────────
async function generateChunks(situations) {
  const sentences = situations.flatMap(s => s.sentences.map(se => se.text));

  const prompt = `以下の英語文を各2〜4個の意味単位チャンクに分割してください。\n\n各文について以下のJSONオブジェクトを生成します:\n- "chunk": 最初のチャンク（文字列）\n- "chunk_meaning": 最初のチャンクの日本語意味（文字列）\n- "chunks": 全チャンク配列\n- "chunk_meanings": 各チャンクとその日本語意味のオブジェクト\n\n英語文リスト:\n${sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nJSON配列のみ返してください（説明文・コードブロック不要）:`;

  const raw = await callClaude(prompt);
  return extractJson(raw);
}

// ── テスト問題生成 ────────────────────────────────────────────
async function generateTestQuestions(situations) {
  const pairs = situations.flatMap(s =>
    s.sentences.map(se => `${se.text}（${se.translation || ''}）`)
  );

  const prompt = `以下の英語文から2種類の穴埋めテスト問題を生成してください。\n\n【Test 1 — キーワード穴埋め】\n各文から名詞・重要単語を1つ選んで___ で隠した問題。${pairs.length}問。\n\n【Test 2 — チャンク穴埋め】\n各文から動詞句・意味チャンクを1つ選んで___で隠した問題。${pairs.length}問。\n\n各問題の形式: {"sentence": "穴埋め文", "answer": "答え", "hint": "日本語ヒント"}\n\n英語文リスト:\n${pairs.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n以下のJSON形式のみで返してください（説明文不要）:\n{"test1": [...], "test2": [...]}`;

  const raw = await callClaude(prompt);
  return extractJson(raw);
}

// ── メイン ────────────────────────────────────────────────────
async function main() {
  console.log('📋 SHEET_TEXT を解析中...');
  const situations = parseSheetText(SHEET_TEXT);
  if (situations.length === 0) {
    console.error('❌ situations が空です。SHEET_TEXT の形式を確認してください。');
    console.error('  期待形式: "## タイトル\\nEN: ...\\nJP: ..."');
    process.exit(1);
  }
  situations.forEach((s, i) => console.log(`  [${i}] ${s.title} — ${s.sentences.length}文`));

  console.log('\n🤖 Claude でチャンク分割中...');
  let chunkData;
  try {
    chunkData = await generateChunks(situations);
    console.log(`  ${chunkData.length} 件のチャンクデータを取得`);
  } catch (e) {
    console.error('❌ チャンク生成失敗:', e.message);
    process.exit(1);
  }

  let idx = 0;
  const enrichedSituations = situations.map(sit => ({
    ...sit,
    sentences: sit.sentences.map(s => ({ ...s, ...(chunkData[idx++] || {}) })),
  }));

  console.log('\n📝 Claude でテスト問題生成中...');
  let testData;
  try {
    testData = await generateTestQuestions(situations);
    console.log(`  Test1: ${testData.test1?.length ?? 0} 問 / Test2: ${testData.test2?.length ?? 0} 問`);
  } catch (e) {
    console.error('❌ テスト問題生成失敗:', e.message);
    process.exit(1);
  }

  console.log('\n💾 Supabase に INSERT 中...');
  const { error } = await supabase.from('weekly_sheets').insert({
    week_start_date: WEEK_START_DATE,
    title: TITLE,
    is_hidden: false,
    situations: enrichedSituations,
    test1_questions: testData.test1 || [],
    test2_questions: testData.test2 || [],
  });

  if (error) {
    console.error('❌ Supabase INSERT 失敗:', error.message);
    process.exit(1);
  }

  console.log(`\n✅ 완료: ${WEEK_START_DATE} (${TITLE})`);
  console.log(`  situations : ${enrichedSituations.length} 件`);
  console.log(`  test1      : ${testData.test1?.length ?? 0} 問`);
  console.log(`  test2      : ${testData.test2?.length ?? 0} 問`);
}

main().catch(e => {
  console.error('❌ 予期しないエラー:', e.message);
  process.exit(1);
});
