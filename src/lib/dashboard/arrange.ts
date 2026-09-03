// Putting widgets side by side on one row — the layout maths behind the Builder
// Assistant's `arrange_row`, kept out of the store so it stays a pure function
// of (items, ids, cols) and can be reasoned about on its own.
//
// Why an ARRANGE action rather than letting the assistant set x/y: the grid runs
// react-grid-layout's VERTICAL compaction (RGL 2.x's default, which the
// dashboard never overrides), so every item floats up to close any gap above it
// on each render. Absolute coordinates from a model are therefore only a hint —
// a layout with a hole in it is silently re-packed, and "leave the top row
// empty" is not expressible at all. What IS stable is the reading order and the
// row groupings, so that is what the assistant gets to say.
//
// The compaction pass itself is RGL's own `verticalCompactor`, not a
// re-implementation: whatever it settles on here is exactly what the grid will
// render, so nothing jumps after the change lands.

import { verticalCompactor } from "react-grid-layout/core";
import type { GridItem } from "@/lib/dashboard/types";

/**
 * Column spans that fit `cols` together, starting from what the widgets have
 * now. The widest one gives up a column at a time — never below its own `minW`,
 * which is a real rendering floor (a table squeezed under it has nowhere to put
 * its columns) — so "three-quarters + quarter" is left exactly as asked while
 * "two-thirds + half" is trimmed to halves.
 *
 * When every widget is already at its minimum and they still do not fit, the
 * spans come back as they are and the caller spills them onto another row. That
 * is the normal case on the 4-column phone grid, not an error.
 */
function fitWidths(targets: readonly GridItem[], cols: number): number[] {
  const widths = targets.map((t) => Math.max(1, Math.min(t.w, cols)));
  const floors = targets.map((t) => Math.max(1, Math.min(t.minW ?? 1, cols)));

  let total = widths.reduce((sum, w) => sum + w, 0);
  while (total > cols) {
    let pick = -1;
    for (let k = 0; k < widths.length; k++) {
      if (widths[k] <= floors[k]) continue;
      if (pick === -1 || widths[k] > widths[pick]) pick = k;
    }
    if (pick === -1) break;
    widths[pick] -= 1;
    total -= 1;
  }
  return widths;
}

/**
 * `items` with the widgets named by `ids` laid out side by side, in that order,
 * on one row — then compacted the way the grid itself would.
 *
 * The row lands at the topmost target's row. Anything at or below that row
 * moves down by exactly the height the row inserted, and compaction then closes
 * both that gap and the slots the targets vacated, so the result is always
 * collision-free and gap-free.
 *
 * Returns null when fewer than two of the ids are actually on this grid: a row
 * of one widget is not a rearrangement, and silently doing nothing is better
 * than reporting a move that had no effect.
 */
export function arrangeIntoRow(
  items: readonly GridItem[],
  ids: readonly string[],
  cols: number
): GridItem[] | null {
  const byId = new Map(items.map((it) => [it.i, it]));
  const targetIds = new Set<string>();
  const targets: GridItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || targetIds.has(id)) continue;
    targetIds.add(id);
    targets.push(item);
  }
  if (targets.length < 2) return null;

  const widths = fitWidths(targets, cols);
  const others = items.filter((it) => !targetIds.has(it.i));

  // Where the row goes. The topmost target's row is the intent, but a widget
  // that already STRADDLES that row (a tall chart beside shorter ones) cannot be
  // pushed out of the way by a downward shift — its top is above the row, so
  // shifting it would still leave it overlapping. The row starts below such a
  // widget instead. Compaction pulls the whole result back up as far as it goes,
  // so this only ever costs vertical position that was not available anyway.
  let anchorY = Math.min(...targets.map((t) => t.y));
  for (let pass = 0; pass <= others.length; pass++) {
    const straddler = others.find((it) => it.y < anchorY && it.y + it.h > anchorY);
    if (!straddler) break;
    anchorY = straddler.y + straddler.h;
  }

  // Left to right, spilling onto a further row when the columns run out. The
  // spill is what makes this safe on the narrow breakpoints: two widgets whose
  // minimums are 3 each cannot share a 4-column row, so they stack instead of
  // overlapping.
  const placed: GridItem[] = [];
  let x = 0;
  let y = anchorY;
  let bandHeight = 0;
  targets.forEach((target, k) => {
    const w = widths[k];
    if (x > 0 && x + w > cols) {
      y += bandHeight;
      x = 0;
      bandHeight = 0;
    }
    placed.push({ ...target, x, y, w });
    x += w;
    bandHeight = Math.max(bandHeight, target.h);
  });
  const insertedHeight = y + bandHeight - anchorY;

  const shifted = others.map((it) =>
    it.y >= anchorY ? { ...it, y: it.y + insertedHeight } : it
  );
  const compacted = new Map(
    verticalCompactor.compact([...shifted, ...placed], cols).map((it) => [it.i, it])
  );

  // Geometry from the compactor, everything else (the minimums) from the item as
  // it was, and the original array order — RGL does not care about the order,
  // but a stable one keeps saved layouts diffable.
  return items.map((it) => {
    const next = compacted.get(it.i);
    return next ? { ...it, x: next.x, y: next.y, w: next.w, h: next.h } : it;
  });
}
