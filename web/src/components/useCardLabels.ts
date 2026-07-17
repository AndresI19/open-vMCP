import { useEffect, useRef } from 'react';

/**
 * Stamp every body cell with its column's header text, so CSS can turn a table row into a card.
 *
 * WHY A TABLE NEEDS THIS ON A PHONE. Carbon's tables use the browser's automatic layout, which sizes
 * a column to its content — and app.css asks long opaque values (tool ids, upstream URLs, user ids) to
 * break anywhere so they wrap instead of overflowing. Those two together are a trap: `overflow-wrap:
 * anywhere` tells auto-layout that such a column's MINIMUM width is one character, so the column
 * carrying the longest value collapses to nothing while the columns that cannot break — dates, counts
 * — keep their comfortable width. On Users that meant a uuid shredded into ten 4-character lines
 * beside two roomy date columns. The fix for the content wrecked the columns.
 *
 * Below the breakpoint there is no honest column layout for seven columns of this on 390px, so the
 * row stops being a row: each cell becomes a labelled line, and nothing has to be squeezed at all.
 *
 * WHY THE LABEL IS READ FROM THE DOM rather than written on each cell. The alternative is ~35
 * data-label attributes across six pages, hand-copied from the <TableHeader> right above them and free
 * to drift from it the first time a column is renamed — a caption that lies about its own value. The
 * header IS the label; this copies it rather than restating it, so the two cannot disagree.
 *
 * It runs on every render, deliberately: these tables poll (usePoll) and paginate, so the rows are
 * replaced under us and a one-shot effect would label the first page and nothing after. The work is a
 * querySelectorAll and a setAttribute over a few dozen cells — far below the cost of the re-render
 * that just produced them.
 */
export function useCardLabels<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Per TABLE, not per root: a page can hold two of them (ServerDetail does), and reading every
    // thead under the root at once would label the second table with the first one's columns.
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
