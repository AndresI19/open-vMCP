import { useEffect, useRef } from 'react';

/**
 * Stamp every body cell with its column's header text, so CSS can turn a table row into a card below
 * the breakpoint (no honest column layout for seven columns on 390px). Auto-layout + app.css's
 * `overflow-wrap: anywhere` on long opaque values (ids, URLs) is a trap: it tells auto-layout the
 * column's MINIMUM width is one char, so the longest-value column collapses while unbreakable ones
 * (dates, counts) keep their width — a uuid shredded into ten lines beside two roomy date columns.
 *
 * The label is READ FROM THE DOM, not written per cell: ~35 hand-copied data-label attributes would
 * drift from the <TableHeader> the first rename. The header IS the label; copying it can't disagree.
 *
 * Runs on every render deliberately: these tables poll and paginate, so rows are replaced under us and
 * a one-shot effect would label only the first page. A querySelectorAll + setAttribute over a few
 * dozen cells is far below the re-render that produced them.
 */
export function useCardLabels<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Per TABLE, not per root: a page can hold two (ServerDetail does), and reading every thead at
    // once would label the second table with the first's columns.
    for (const table of root.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent?.trim() ?? '');
      if (!heads.length) continue;
      for (const row of table.querySelectorAll('tbody tr')) {
        [...row.children].forEach((cell, i) => {
          // An empty header is a real thing (an actions column) and must not print a stray label.
          if (heads[i]) cell.setAttribute('data-label', heads[i]);
          else cell.removeAttribute('data-label');
        });
      }
    }
  });
  return ref;
}
