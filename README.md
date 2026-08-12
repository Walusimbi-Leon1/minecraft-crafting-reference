# Minecraft Crafting Reference

**How Everything in Minecraft Is Made**

*A living reference. Every day, a new chapter of recipes lands.*

This book documents how everything in Minecraft is crafted — tools,
weapons, armor, blocks, redstone, food, brewing, and more. Every entry
gives you the exact recipe: the crafting grid, the materials, the
step-by-step build, and how the item fits into your progression.

It starts at the very beginning (your first wooden tools) and advances
chapter by chapter through the Iron Age, redstone, the Nether, and the
end-game — never repeating an item, always moving forward.

## Read the Book

The full reference is published on GitHub Pages:

**https://walusimbi-leon1.github.io/minecraft-crafting-reference/**

The raw source is `book/part1.md` (growing daily).

## How Each Entry Looks

- **Recipe** — the exact 3×3 crafting grid (ASCII diagram), or furnace /
  brewing / smithing inputs
- **Legend** — what each letter in the grid means
- **Materials** — every ingredient with quantity and where to get it
- **How to craft** — step-by-step instructions
- **Uses** — what the item is for
- **Progression tip** — how it fits into survival progression

## The Daily Writer

The **Daily Crafting Writer** (a GitHub Actions workflow powered by the
big-pickle model on opencode.ai) runs every day at 07:00 UTC and writes
the next ~2,000-word chapter — several new items with full recipes. It
tracks covered items in `covered.json` so nothing is ever repeated, and
regenerates this site automatically.

## Building the Site

The published page is generated from `book/part1.md`:

```bash
python3 build_site.py   # regenerates index.html
```

---

*Written block by block.*
