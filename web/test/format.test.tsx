import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { DASH, StatusTag, fmtLatency } from '../src/format';

/**
 * The status tag had a real bug: Recent Calls decided a call's colour with
 * `status === "ok" ? "green" : "red"`, so every POLICY-BLOCKED call was painted red, as a failure —
 * while Server Detail, which had its own three-way mapping, painted the same call neutral. Two
 * tables, one dataset, two answers.
 *
 * A blocked call is the gateway doing its job. These tests pin that down, and — more usefully — pin
 * down that a status nobody anticipated is treated as a failure rather than quietly rendered green.
 */

const html = (status: string): string => renderToStaticMarkup(<StatusTag status={status} />);

describe('StatusTag', () => {
  test('ok is green', () => {
    expect(html('ok')).toContain('green');
  });

  test('error is red', () => {
    expect(html('error')).toContain('red');
  });

  test('blocked is neutral — a refused call is policy working, not a failure', () => {
    const out = html('blocked');
    expect(out).toContain('warm-gray');
    expect(out, 'the bug: blocked used to render red').not.toContain('red');
  });

  test('an unrecognised status fails loudly rather than passing as green', () => {
    const out = html('something-new');
    expect(out).toContain('red');
    expect(out).not.toContain('green');
  });

  test('the status is always shown as text, not just as a colour', () => {
    // Colour alone is not an accessible signal.
    expect(html('blocked')).toContain('blocked');
  });
});

describe('fmtLatency', () => {
  test('renders milliseconds', () => {
    expect(fmtLatency(42)).toBe('42 ms');
  });

  test('renders a dash when there is no latency — and the SAME dash everywhere', () => {
    // The two tables used to disagree: one printed an em-dash, the other a hyphen.
    expect(fmtLatency(null)).toBe(DASH);
  });

  test('zero is a latency, not a missing value', () => {
    expect(fmtLatency(0)).toBe('0 ms');
  });
});
