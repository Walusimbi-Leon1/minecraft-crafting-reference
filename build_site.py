#!/usr/bin/env python3
"""Build minecraft-crafting-reference site: book markdown -> styled single-page HTML."""
import markdown
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "book" / "part1.md"
OUT = ROOT / "index.html"

md_text = SRC.read_text(encoding="utf-8")

# --- chapter ladder for the nav (what tier/era each chapter covers) ---
CHAPTER_TIERS = {
    1: "Fundamentals", 2: "Fundamentals", 3: "Fundamentals",
    4: "Iron Age", 5: "Iron Age", 6: "Iron Age",
    7: "Redstone", 8: "Redstone", 9: "Redstone",
    10: "Nether", 11: "Nether", 12: "Nether",
    13: "End-game", 14: "End-game", 15: "End-game",
}


def chapter_era(n):
    if n <= 3:
        return "Fundamentals"
    if n <= 6:
        return "Iron Age"
    if n <= 9:
        return "Redstone"
    if n <= 12:
        return "Nether"
    if n <= 15:
        return "End-game"
    # After the first 15 chapters, derive from the era labels in order
    eras = ["Fundamentals", "Iron Age", "Redstone", "Nether", "End-game",
            "Master Craftsman", "Brewing", "Enchanting", "Mechanics", "Mythic"]
    return eras[min((n - 1) // 3, len(eras) - 1)]


def slugify(text):
    """Match python-markdown's toc slugifier so nav anchors actually work."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# --- collect chapter headings for the nav sidebar ---
nav_items = []
for line in md_text.splitlines():
    m = re.match(r"^## CHAPTER (\d+) — (.+)$", line)
    if m:
        nav_items.append((int(m.group(1)), m.group(2)))

# toc extension gives every heading a real id (the nav links need these)
body = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "sane_lists", "smarty", "toc"],
    extension_configs={"toc": {"toc_depth": "2-2"}},
    output_format="html5",
)

# --- build nav ---
nav_links = []
for num, title in nav_items:
    anchor = f"chapter-{num}-{slugify(title)}"
    nav_links.append(
        f'<a href="#{anchor}"><span class="era">{chapter_era(num)}</span>'
        f'<span class="ctitle"><b>Chapter {num}</b> — {title}</span></a>'
    )
if nav_items:
    nav_links.append('<hr style="border-color:var(--line);margin:10px 0;">')
nav_links.append('<a href="#appendix-whats-inside">Appendix — Index</a>')
nav_html = "\n".join(nav_links)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Crafting Reference — How Everything in Minecraft Is Made</title>
<meta name="description" content="A living crafting reference: exact recipes for every tool, weapon, block, and item in Minecraft. A new chapter of recipes lands every day.">
<style>
:root {{
  --bg: #14100b; --panel: #1d1812; --panel2: #2a2118; --ink: #f0e9dd;
  --muted: #a89f8f; --orange: #e8892c; --gold: #f2c14e; --green: #7ec850;
  --line: #3a3128; --red: #f85149;
}}
* {{ box-sizing: border-box; }}
html {{ scroll-behavior: smooth; }}
body {{
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.65;
}}
a {{ color: #58a6ff; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.wrap {{ display: flex; min-height: 100vh; }}
nav {{
  width: 300px; min-width: 300px; background: var(--panel); border-right: 1px solid var(--line);
  padding: 22px 14px; position: sticky; top: 0; height: 100vh; overflow-y: auto;
}}
nav h1 {{ font-size: 15px; margin: 0 0 4px; color: var(--gold); letter-spacing: .5px; }}
nav .sub {{ font-size: 11px; color: var(--muted); margin: 0 0 14px; }}
nav a {{
  display: block; padding: 7px 10px; border-radius: 8px; color: var(--ink);
  font-size: 13px; margin-bottom: 2px; border-left: 3px solid transparent;
}}
nav a:hover {{ background: var(--panel2); text-decoration: none; border-left-color: var(--orange); }}
nav .era {{ display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }}
nav .ctitle {{ display: block; }}
main {{ flex: 1; max-width: 900px; margin: 0 auto; padding: 40px 32px 80px; }}
main h1 {{
  font-size: 34px; line-height: 1.15; margin: 0 0 6px; color: var(--orange);
}}
main h2 {{
  margin-top: 64px; padding-bottom: 10px; border-bottom: 2px solid var(--line);
  font-size: 26px; color: var(--gold);
}}
main h3 {{ margin-top: 34px; font-size: 19px; color: var(--orange); }}
main h4 {{ margin-top: 26px; font-size: 16px; }}
main p, main li {{ font-size: 15.5px; }}
main blockquote {{
  margin: 22px 0; padding: 16px 22px; background: var(--panel);
  border-left: 4px solid var(--gold); border-radius: 0 10px 10px 0;
}}
main blockquote p {{ font-style: italic; color: #d9cbb3; }}
main table {{
  border-collapse: collapse; width: 100%; margin: 18px 0; font-size: 14px;
  background: var(--panel); border-radius: 10px; overflow: hidden;
}}
main th {{
  text-align: left; background: var(--panel2); color: var(--gold);
  padding: 9px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .8px;
}}
main td {{ padding: 8px 12px; border-top: 1px solid var(--line); }}
main tr:nth-child(even) td {{ background: rgba(255,255,255,.02); }}
main code {{
  background: var(--panel2); border: 1px solid var(--line); border-radius: 5px;
  padding: 1px 6px; font-size: 13px; font-family: "SF Mono", Consolas, monospace; color: #79c0ff;
}}
main pre {{
  background: var(--panel2); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 18px; overflow-x: auto; display: inline-block; min-width: 180px;
}}
main pre code {{ background: none; border: none; padding: 0; font-size: 14px; line-height: 1.5; color: #e6d9bd; }}
main ul {{ padding-left: 22px; }}
main li {{ margin: 5px 0; }}
main li::marker {{ color: var(--orange); }}
hr {{ border: none; border-top: 1px solid var(--line); margin: 44px 0; }}
strong {{ color: #fff; }}
@media (max-width: 900px) {{
  .wrap {{ flex-direction: column; }}
  nav {{ width: 100%; min-width: 0; height: auto; position: static; border-right: none; border-bottom: 1px solid var(--line); }}
  main {{ padding: 24px 18px 60px; }}
  main h1 {{ font-size: 26px; }}
}}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <h1>MINECRAFT CRAFTING REFERENCE</h1>
  <p class="sub">How Everything in Minecraft Is Made</p>
  {nav_html}
</nav>
<main>
{body}
<footer style="margin-top:70px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;">
  Minecraft Crafting Reference — written block by block.<br>
  The reference grows daily: a new chapter of recipes lands every day.<br>
  Source markdown in <code>book/part1.md</code>
</footer>
</main>
</div>
</body>
</html>
"""

OUT.write_text(html, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes), {len(nav_items)} chapters in nav")
