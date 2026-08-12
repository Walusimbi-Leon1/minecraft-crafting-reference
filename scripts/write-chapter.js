#!/usr/bin/env node
/**
 * SGSS Daily Crafting Writer — runs in GitHub Actions for Minecraft Crafting Reference.
 *
 * Every day this script:
 *   1. Reads book/part1.md (the growing crafting reference)
 *   2. Reads covered.json (item names already documented — no repeats)
 *   3. Calls opencode.ai (big-pickle) and asks for the NEXT chapter
 *      (~2,000 words, several new items with exact recipes), covering
 *      progressively more advanced topics
 *   4. Appends the chapter before the appendix
 *   5. Updates covered.json with the new items
 *   6. Regenerates the site (python3 build_site.py -> index.html)
 *   7. Commits + pushes -> GitHub Pages auto-rebuilds -> reference grows daily
 *
 * Running from GitHub runners keeps opencode.ai from flagging any IP.
 *
 * Exit codes: 0 = ok (content written or nothing to do), 1 = failure.
 */

const fs = require("fs");
const { execSync } = require("child_process");

// ── Config ─────────────────────────────────────────────────────────────────
const CONFIG_PATH = "book.config.json";
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const TITLE = cfg.title || "Minecraft Crafting Reference";
const BOOK_FILE = cfg.bookFile || "book/part1.md";
const COVERED_FILE = "covered.json";
const BUILD_SITE = cfg.buildSite || "python3 build_site.py";
const TARGET_WORDS = cfg.targetWords || 2000;
const MIN_WORDS = cfg.minWords || 1500;
const MAX_WORDS = cfg.maxWords || 3200;
const MIN_ITEMS = cfg.minItems || 4;
const API_TIMEOUT_MS = cfg.apiTimeoutMs || 600000;
const MAX_TOKENS = cfg.maxTokens || 24000;
const MAX_TRIES = 6;

const BASE_URL = process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1";
const MODEL = process.env.MODEL || "big-pickle";

const KEYS = [process.env.OPENCODE_API_KEY, process.env.OPENCODE_API_KEY_2, process.env.OPENCODE_API_KEY_3, process.env.OPENCODE_API_KEY_4, process.env.OPENCODE_API_KEY_5]
  .filter(Boolean);
if (!KEYS.length) {
  console.error("❌ OPENCODE_API_KEY not set");
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function log(...a) { console.log("[writer]", ...a); }

function readFile(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}

function wordCount(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

function maxChapterNumber(md) {
  let maxN = 0;
  const re = /^##\s+CHAPTER\s+(\d+)\s*[—\-–]/gm;
  let m;
  while ((m = re.exec(md)) !== null) maxN = Math.max(maxN, parseInt(m[1], 10));
  return maxN;
}

function loadCovered() {
  try {
    const raw = JSON.parse(fs.readFileSync(COVERED_FILE, "utf8"));
    return Array.isArray(raw) ? raw : (raw.items || []);
  } catch {
    return [];
  }
}

function extractItemNames(md) {
  const names = [];
  const re = /^###\s+(.+)$/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const t = m[1].trim();
    if (/^(Mission Briefing|Objective|Supplies|Coordinates|The Plan|Success Checklist|Missionary Note)$/i.test(t)) continue;
    names.push(t);
  }
  return names;
}

// ── API call ───────────────────────────────────────────────────────────────
async function generateChapter(prompt, keyIndex) {
  const API_KEY = KEYS[keyIndex % KEYS.length];
  const sys =
    `You are the crafting chronicler for "${TITLE}" by ${cfg.author || "Walusimbi Leon (SGSS)"}.\n` +
    `You write precise, playable Minecraft crafting reference entries in the book's house style: ` +
    `exact ASCII crafting grids, exact material quantities, and zero fluff.\n` +
    `IMPORTANT: plan briefly, then write. Do not spend excessive hidden reasoning; your token ` +
    `budget must go to the content itself.\n` +
    `Write ONLY the chapter content described in the user prompt — no commentary, no recaps, ` +
    `no meta-notes, no "here is" introductions.`;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (res.status === 429) throw new Error("rate limited");
  if (!res.ok) throw new Error(`opencode.ai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  let content = data?.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
    console.error("RAW RESPONSE:", JSON.stringify(data).slice(0, 800));
    throw new Error("empty content from model");
  }
  content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
  return content;
}

// ── Normalization ──────────────────────────────────────────────────────────
function normalizeChapter(raw, chapterN) {
  let c = raw.trim();

  // Cut anything before the first real heading (model chatter)
  const firstHeading = c.search(/^#{1,2}\s/m);
  if (firstHeading > 0) c = c.slice(firstHeading).trim();

  // Normalize the chapter heading to the exact number + em dash
  const headingRe = /^##\s+CHAPTER\s+(\d+)\s*[—\-–]?\s*(.*)$/m;
  const hm = c.match(headingRe);
  if (!hm) throw new Error("generated content has no '## CHAPTER N — TITLE' heading");
  const title = hm[2].trim() || "NEW CRAFTING CHAPTER";
  c = c.replace(headingRe, `## CHAPTER ${chapterN} — ${title}`);

  return { content: c, title };
}

// ── Insertion — before the appendix, else append at end ────────────────────
function insertChapter(md, newContent) {
  const idx = md.search(/^##\s+APPENDIX\b/m);
  if (idx >= 0) {
    const head = md.slice(0, idx).replace(/[\s]*$/, "\n\n");
    const tail = md.slice(idx);
    return head + newContent.trim() + "\n\n---\n\n" + tail;
  }
  return md.replace(/[\s]*$/, "\n\n") + newContent.trim() + "\n\n";
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  let md = readFile(BOOK_FILE);

  // Empty repo? Seed a minimal skeleton so the book has a spine.
  if (!md || !md.trim()) {
    md = `# ${TITLE}\n\n` +
      `**${cfg.subtitle || "How Everything in Minecraft Is Made"}**\n\n` +
      `*A living reference. Every day a new chapter of recipes lands here.*\n\n` +
      `## HOW TO USE THIS BOOK\n\n` +
      `Each entry shows the exact recipe — the crafting grid, the materials, ` +
      `the step-by-step build, and how the item fits into your progression. ` +
      `Crafting grids use letters that map to items in a legend below each grid.\n\n` +
      `## APPENDIX — WHAT'S INSIDE\n\n` +
      `*(This appendix grows as chapters are added.)*\n`;
    fs.writeFileSync(BOOK_FILE, md);
    log(`seeded empty book: ${BOOK_FILE}`);
  }

  const covered = loadCovered();
  const chapterN = maxChapterNumber(md) + 1;
  log(`chapters so far: ${chapterN - 1} → writing CHAPTER ${chapterN}`);
  log(`items already covered: ${covered.length}`);

  // Continuity: tail of the book (last chapter) for style + topic flow
  const appIdx = md.search(/^##\s+APPENDIX\b/m);
  const bodyEnd = appIdx >= 0 ? md.slice(0, appIdx).trim() : md.trim();
  const lastWords = bodyEnd.split(/\s+/).slice(-1200).join(" ");

  // Items covered so far (manifest + parsed from the book) — no repeats allowed
  const coveredSet = new Set([...covered, ...extractItemNames(md)].map((s) => s.toLowerCase()));
  const coveredList = [...coveredSet].slice(-60).join(", ");

  const prompt =
    `BOOK: ${cfg.description || ""}\n\n` +
    (cfg.genre ? `GENRE: ${cfg.genre}\n\n` : "") +
    (cfg.style ? `STYLE: ${cfg.style}\n\n` : "") +
    (cfg.setting ? `SETTING: ${cfg.setting}\n\n` : "") +
    `YOUR TASK TODAY: write **CHAPTER ${chapterN}** of the reference — roughly ${TARGET_WORDS} words ` +
    `of crafting content (${MIN_ITEMS}-8 distinct items/recipes).\n\n` +
    `PROGRESSION: the reference advances chapter by chapter through the game. Chapter ${chapterN - 1} ` +
    `covered the most advanced content so far; this chapter must move FURTHER along the progression ` +
    `(never backward, never repeat). If the basics are done, move to mid-game; if mid-game is done, ` +
    `move to end-game; if end-game is done, go deeper into niche blocks, decorations, foods, and ` +
    `mechanics. Follow the direction in the book notes.\n\n` +
    `FORMAT — house style, in this order:\n` +
    `1. Heading: "## CHAPTER ${chapterN} — <THEME TITLE>" (e.g. "THE IRON AGE", "REDSTONE LOGIC", "THE CRAFTER'S WORKSHOP").\n` +
    `2. ONE short intro paragraph (2-4 sentences) setting up the theme of the chapter.\n` +
    `3. For EACH item (${MIN_ITEMS}-8 of them), this exact structure:\n` +
    `   - "### <Item Name>" (e.g. "### Iron Pickaxe", "### Piston", "### Cake").\n` +
    `   - "**Category:** <Tools | Weapons | Armor | Blocks | Redstone | Food | Brewing | Materials | Transportation | Decoration>**" ` +
    `and "**Tier:** <Early-game | Mid-game | End-game>**".\n` +
    `   - "**Recipe**" followed by the exact 3×3 crafting grid as an ASCII code block ` +
    `(9 cells per row, letters for items, [ ] or . for empty). Example:\n` +
    `   \x60\x60\x60\n   [I][ ][ ]\n   [I][S][ ]\n   [I][S][ ]\n   \x60\x60\x60\n` +
    `   - "**Legend:**" mapping each letter to the exact item (e.g. "I = Iron Ingot, S = Stick").\n` +
    `   - "**Materials:**" a markdown table (columns "Item | Qty | How to get it") for every ingredient.\n` +
    `   - "**How to craft:**" 2-4 short numbered or prose steps (place 3 iron ingots down the left column, etc.).\n` +
    `   - "**Uses:**" 1-3 sentences on what the item is for.\n` +
    `   - "**Progression tip:**" 1-2 sentences (how it fits into survival progression).\n` +
    `   For furnace/brewing/smithing/stonecutter recipes, adapt the grid: state the fuel/inputs ` +
    `clearly (e.g. "Furnace: 1 iron ore + 1 coal → 1 iron ingot").\n` +
    `4. A closing line: "***" then a one-line hook for the next chapter (e.g. "Next: the Nether awaits.").\n\n` +
    `DO NOT cover any of these already-documented items: ${coveredList || "(none)"}.\n` +
    `Every item in this chapter must be NEW to the book. All quantities and recipes must be ` +
    `accurate for current Minecraft (1.20+/1.21).\n\n` +
    `LENGTH: about ${TARGET_WORDS} words total.\n\n` +
    `CONTINUITY — the end of the book as it stands now. Your chapter follows immediately after it:\n` +
    `---\n${lastWords}\n---\n` +
    `\nOutput ONLY the chapter.`;

  // Generate — rotate through fallback keys, back off harder each try
  let content = null, title = null, newItems = [];
  for (let i = 1; i <= MAX_TRIES; i++) {
    const keyIdx = i - 1;
    try {
      const raw = await generateChapter(prompt, keyIdx);
      const wc = wordCount(raw.replace(/^#{1,6}\s.*$/gm, ""));
      log(`attempt ${i} (key ${keyIdx + 1}/${KEYS.length}): generated ${wc} words`);
      if (wc < MIN_WORDS) throw new Error(`too short (${wc} words)`);
      if (wc > MAX_WORDS) throw new Error(`too long (${wc} words)`);

      // Extract the item headings from the raw content
      const items = extractItemNames(raw);
      if (items.length < MIN_ITEMS) throw new Error(`only ${items.length} items (need ≥ ${MIN_ITEMS})`);

      // No repeats allowed
      const dupes = items.filter((it) => coveredSet.has(it.toLowerCase()));
      if (dupes.length) throw new Error(`repeats covered items: ${dupes.join(", ")}`);

      // Recipe grids must be present
      const grids = (raw.match(/```/g) || []).length;
      if (grids < items.length) throw new Error(`only ${grids} code blocks for ${items.length} items`);

      const norm = normalizeChapter(raw, chapterN);
      content = norm.content;
      title = norm.title;
      newItems = items;
      log(`✅ chapter parsed: "${title}" with ${items.length} items`);
      break;
    } catch (err) {
      log(`attempt ${i} (key ${keyIdx + 1}/${KEYS.length}) failed: ${err.message}`);
      if (i === MAX_TRIES) throw err;
      await new Promise((r) => setTimeout(r, 15000 * i * i)); // 15s, 60s, 135s, 240s…
    }
  }

  // Guard against double-writing the same chapter (e.g. manual re-run)
  if (new RegExp(`^##\\s+CHAPTER\\s+${chapterN}\\s+[—\\-–]`, "m").test(md)) {
    log(`CHAPTER ${chapterN} already exists — nothing to do`);
    return;
  }

  // Apply to the book
  const updated = insertChapter(md, content);
  fs.writeFileSync(BOOK_FILE, updated);
  log(`✍️  chapter written: ${BOOK_FILE} (+${wordCount(content)} words)`);

  // Update covered.json
  const newCovered = [...new Set([...loadCovered(), ...newItems])].sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(COVERED_FILE, JSON.stringify(newCovered, null, 2) + "\n");
  log(`📋 covered.json updated: ${newCovered.length} items`);

  // Regenerate the site
  try {
    execSync(BUILD_SITE, { stdio: "inherit" });
    log("🌐 site regenerated");
  } catch (err) {
    console.error("⚠️  build_site.py failed:", err.message);
    process.exit(1);
  }

  // Commit & push
  execSync("git add -A", { stdio: "inherit" });
  const diff = execSync("git diff --cached --stat", { encoding: "utf8" });
  log(diff);
  const wcNew = wordCount(content.replace(/^#{1,6}\s.*$/gm, ""));
  execSync(
    `git -c user.name="SGSS Books Bot" -c user.email="walusimbileon3@gmail.com" commit -m "📗 Chapter ${chapterN} — ${title} added (+~${wcNew} words, ${newItems.length} new recipes)"`,
    { stdio: "inherit" }
  );
  try {
    const pushToken = process.env.GH_PUSH_TOKEN;
    if (pushToken) {
      const origin = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
      const authed = origin.replace(/^https:\/\//, `https://x-access-token:${pushToken}@`);
      // actions/checkout sets an Authorization extraheader (GITHUB_TOKEN) that
      // would override the PAT — clear it so the PAT authenticates the push.
      execSync(`git -c "http.https://github.com/.extraheader=" push "${authed}" HEAD:main`, { stdio: "inherit" });
    } else {
      execSync("git push", { stdio: "inherit" });
    }
    log("✅ pushed — GitHub Pages will rebuild");
  } catch (err) {
    if (process.env.ALLOW_NO_PUSH !== "1") throw err;
    log("⚠️  no remote — skipped push (local test mode)");
  }
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
