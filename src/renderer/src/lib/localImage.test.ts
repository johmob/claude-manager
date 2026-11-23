import { describe, expect, it } from 'vitest';
import { isLocalPath, localImageUrl, wrapLocalImageLinks } from './localImage';

describe('localImageUrl', () => {
  it('turns a Windows path or file URL to an image into an app address', () => {
    expect(localImageUrl('C:\\Bilder\\plot.png')).toBe(`cm-img://local/${encodeURIComponent('C:\\Bilder\\plot.png')}`);
    expect(localImageUrl('file:///C:/Bilder/min%20bild.JPG')).toBe(`cm-img://local/${encodeURIComponent('C:/Bilder/min bild.JPG')}`);
    expect(localImageUrl('<D:/x/y.webp>')).toBe(`cm-img://local/${encodeURIComponent('D:/x/y.webp')}`);
    // As the markdown parser hands it over, percent-encoded.
    expect(localImageUrl('C:%5CMina%20bilder%5Ca.png')).toBe(`cm-img://local/${encodeURIComponent('C:\\Mina bilder\\a.png')}`);
  });

  it('leaves anything that is not a local image alone', () => {
    expect(localImageUrl('C:\\Kod\\main.c')).toBeNull();
    expect(localImageUrl('https://example.com/a.png')).toBeNull();
    expect(localImageUrl('bilder/plot.png')).toBeNull();
  });
});

describe('wrapLocalImageLinks', () => {
  it('wraps local image targets so paths with spaces parse', () => {
    expect(wrapLocalImageLinks('![Ikon](C:\\Mina bilder\\a.png) och [länk](https://x.se)')).toBe('![Ikon](<C:\\Mina bilder\\a.png>) och [länk](https://x.se)');
  });
});

describe('isLocalPath', () => {
  it('recognises local paths and file URLs, also percent-encoded, and not web links', () => {
    expect(['C:\\Kod\\a.txt', 'C:%5CKod%5Ca.txt', 'file:///C:/a.txt', 'D:/x'].every(isLocalPath)).toBe(true);
    expect(['https://example.com', 'mailto:a@b.c', 'docs/a.md'].some(isLocalPath)).toBe(false);
  });
});
