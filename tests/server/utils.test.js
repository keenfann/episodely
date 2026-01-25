import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTodayDate, isReleased, stripHtml } from '../../server/utils.js';

describe('server utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-04-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('strips HTML tags and trims whitespace', () => {
    expect(stripHtml('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
    expect(stripHtml('   <div>Episode</div>  ')).toBe('Episode');
    expect(stripHtml(null)).toBe('');
  });

  it('returns a YYYY-MM-DD date string', () => {
    expect(getTodayDate()).toBe('2024-04-10');
  });

  it('checks if an airdate is released', () => {
    expect(isReleased('2024-04-09')).toBe(true);
    expect(isReleased('2024-04-10')).toBe(true);
    expect(isReleased('2024-04-11')).toBe(false);
    expect(isReleased(null)).toBe(false);
  });
});
