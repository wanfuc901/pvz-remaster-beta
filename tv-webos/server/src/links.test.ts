import { describe, expect, it } from 'vitest';
import { firstHttpUrl, isHttpUrl, parseYouTube } from '@tvwebos/shared/links';

describe('parseYouTube', () => {
  const ID = 'dQw4w9WgXcQ';

  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}&feature=share`, ID],
    [`https://youtu.be/${ID}?si=abc123`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://youtube.com/live/${ID}`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
  ])('reads the video id from %s', (url, id) => {
    expect(parseYouTube(url)?.videoId).toBe(id);
  });

  it('keeps the playlist and start offset', () => {
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&list=PL1234567890&t=1m30s`)).toEqual({
      videoId: ID,
      listId: 'PL1234567890',
      start: 90,
    });
    expect(parseYouTube('https://www.youtube.com/playlist?list=PL1234567890')).toEqual({ videoId: null, listId: 'PL1234567890', start: 0 });
    expect(parseYouTube(`https://youtu.be/${ID}?t=42`)?.start).toBe(42);
  });

  it('ignores other sites and malformed ids', () => {
    expect(parseYouTube(`https://evil.example/watch?v=${ID}`)).toBeNull();
    expect(parseYouTube(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
    expect(parseYouTube('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseYouTube('https://www.youtube.com/')).toBeNull();
    expect(parseYouTube('not a url')).toBeNull();
  });
});

describe('link text helpers', () => {
  it('finds the link inside shared text', () => {
    expect(firstHttpUrl('Xem cái này nè https://youtu.be/dQw4w9WgXcQ?si=x).')).toBe('https://youtu.be/dQw4w9WgXcQ?si=x');
    expect(firstHttpUrl('chỉ có chữ')).toBeNull();
  });

  it('accepts only http(s) URLs', () => {
    expect(isHttpUrl('https://coccoc.com/')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl(`https://a.example/${'x'.repeat(3000)}`)).toBe(false);
  });
});
