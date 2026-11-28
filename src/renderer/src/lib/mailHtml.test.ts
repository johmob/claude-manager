import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, MAIL_CSP, linkMismatch, mailLinkItems, mailLinks, mailSrcdoc, remoteImageCount, sanitizeMailHtml, textLinks, textSrcdoc } from './mailHtml';

describe('sanitizeMailHtml', () => {
  it('removes scripts with their content, also unclosed ones', () => {
    expect(sanitizeMailHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeMailHtml('<p>a</p><SCRIPT src=x>')).toBe('<p>a</p>');
  });

  it('removes frames, objects, embeds and forms but keeps the text of forms', () => {
    const out = sanitizeMailHtml('<iframe src="x"></iframe><object data="x"></object><embed src="x"><form action="x">hej<input name="a"></form>');
    expect(out).toBe('hej');
  });

  it('removes base, link and meta http-equiv, keeps meta charset', () => {
    const out = sanitizeMailHtml('<base href="http://x"><link rel="stylesheet" href="http://x"><meta http-equiv="refresh" content="0;url=http://x"><meta charset="utf-8">');
    expect(out).toBe('<meta charset="utf-8">');
  });

  it('removes on* attributes in every spelling', () => {
    expect(sanitizeMailHtml('<img src="data:image/png;base64,AA" onerror="x()">')).toBe('<img src="data:image/png;base64,AA">');
    expect(sanitizeMailHtml('<img src="x"/ONERROR=alert(1)>')).not.toMatch(/onerror/i);
    expect(sanitizeMailHtml("<div onclick='a>b'>hej</div>")).toBe('<div>hej</div>');
  });

  it('removes javascript: urls, also hidden by entities and whitespace', () => {
    expect(sanitizeMailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeMailHtml('<a href="java&#x09;script:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeMailHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeMailHtml('<img src="data:text/html,<b>x</b>">')).toBe('<img>');
    expect(sanitizeMailHtml('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png');
  });

  it('makes links inert: the target moves to data-href', () => {
    expect(sanitizeMailHtml('<a href="https://example.org/x" target="_blank">x</a>')).toBe('<a data-href="https://example.org/x">x</a>');
  });

  it('removes dangerous inline styles', () => {
    expect(sanitizeMailHtml('<div style="width:expression(alert(1))">x</div>')).toBe('<div>x</div>');
    expect(sanitizeMailHtml('<div style="margin:4px">x</div>')).toBe('<div style="margin:4px">x</div>');
  });

  it("removes the sender's colours, fonts, backgrounds and style blocks but keeps structure", () => {
    expect(sanitizeMailHtml('<div style="color:red; FONT-FAMILY: Comic Sans; background:#fff; margin:4px">x</div>')).toBe('<div style="margin:4px">x</div>');
    expect(sanitizeMailHtml('<td style="background-image:url(http://x/a.png);text-align:center">x</td>')).toBe('<td style="text-align:center">x</td>');
    expect(sanitizeMailHtml('<table bgcolor="#fff" background="x.png"><tr><td>x</td></tr></table>')).toBe('<table><tr><td>x</td></tr></table>');
    expect(sanitizeMailHtml('<font face="Arial" color="red" size="4"><b>x</b></font>')).toBe('<font size="4"><b>x</b></font>');
    expect(sanitizeMailHtml('<style>p{color:red}</style><p>x</p>')).toBe('<p>x</p>');
  });

  it('leaves text with a stray less-than alone', () => {
    expect(sanitizeMailHtml('<p>a < b and c > d</p>')).toBe('<p>a < b and c > d</p>');
  });
});

describe('mailSrcdoc', () => {
  it('puts the CSP before anything of the mail', () => {
    const doc = mailSrcdoc('<html><head><title>t</title></head><body><img src="http://tracker.example.org/p.gif"><p>hej</p></body></html>');
    expect(doc.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<html'));
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<img'));
    expect(doc).toContain(MAIL_CSP);
  });

  it('works without a head or any html element', () => {
    const doc = mailSrcdoc('<p>bara text</p>');
    expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain('<p>bara text</p>');
  });

  it('keeps the mail from setting its own policy and drops its doctype', () => {
    const doc = mailSrcdoc('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN"><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>x</body></html>');
    expect(doc.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(doc.match(/<!doctype/gi)).toHaveLength(1);
  });

  it("uses the app's colours and font, not a white page", () => {
    const doc = mailSrcdoc('<p>x</p>', { ...DEFAULT_PALETTE, bg: '#05060b', text: '#f6f8fc', font: '"Inter Variable", sans-serif', size: 14 });
    expect(doc).toContain('background:#05060b');
    expect(doc).toContain('color:#f6f8fc');
    expect(doc).toContain('font:14px/1.5 "Inter Variable", sans-serif');
    expect(doc).not.toContain('#fff');
  });

  it('does not let a theme value break out of the stylesheet', () => {
    const doc = mailSrcdoc('x', { ...DEFAULT_PALETTE, bg: 'red}</style><script>alert(1)</script>' });
    expect(doc).not.toContain('<script');
    expect(doc.match(/<\/style>/g)).toHaveLength(1);
  });

  it('allows images from the web only when asked for', () => {
    expect(mailSrcdoc('x')).toContain('img-src data:"');
    expect(mailSrcdoc('x', DEFAULT_PALETTE, true)).toContain('img-src data: https:');
  });

  it('shows the plain text in the app style too', () => {
    expect(textSrcdoc('a < b')).toContain('a &lt; b');
    expect(textSrcdoc('x')).toContain('background:#0f1115');
  });
});

describe('textSrcdoc', () => {
  it('escapes the text', () => {
    const doc = textSrcdoc('a <script>x</script> & b');
    expect(doc).toContain('a &lt;script&gt;x&lt;/script&gt; &amp; b');
    expect(doc).toContain(MAIL_CSP);
  });
});

describe('mailLinks', () => {
  const html =
    '<a href="https://example.org/a">A</a> <a href="https://example.org/a">again</a> <a href=\'mailto:anna@example.com\'>mail</a>' +
    '<a href="javascript:x()">no</a><a href="ftp://example.org/f">no</a><a href="/relative">no</a><a name="x">no</a><a href="https://example.org/q?a=1&amp;b=2">q</a>';

  it('lists http(s) and mailto once each, decoded', () => {
    expect(mailLinks(html)).toEqual(['https://example.org/a', 'mailto:anna@example.com', 'https://example.org/q?a=1&b=2']);
  });

  it('caps at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => `<a href="https://example.org/${i}">x</a>`).join('');
    expect(mailLinks(many)).toHaveLength(50);
  });

  it('gives the text of a link, and flags text that names another address', () => {
    const items = mailLinkItems('<a href="https://evil.example.net/x"><b>www.example.com</b></a><a href="https://www.example.com/ok">example.com</a><a href="https://example.org/">Läs mer</a>');
    expect(items.map((i) => [i.text, i.mismatch])).toEqual([['www.example.com', true], ['example.com', false], ['Läs mer', false]]);
  });
});

describe('linkMismatch', () => {
  it('compares hosts, ignoring www and sub-domains of the shown name', () => {
    expect(linkMismatch('example.com', 'https://example.com/x')).toBe(false);
    expect(linkMismatch('https://example.com', 'https://news.example.com/x')).toBe(false);
    expect(linkMismatch('bank.example.com', 'https://example.net/x')).toBe(true);
    expect(linkMismatch('Klicka här', 'https://example.net/x')).toBe(false);
  });
});

describe('textLinks and remoteImageCount', () => {
  it('finds addresses in plain text without trailing punctuation', () => {
    expect(textLinks('Se https://example.org/a, och (https://example.org/b). Samma https://example.org/a.')).toEqual(['https://example.org/a', 'https://example.org/b']);
  });

  it('counts images that point at the web', () => {
    expect(remoteImageCount('<img src="https://example.org/a.gif"><img alt="x" src=\'http://example.org/b\'><img src="data:image/png;base64,AA"><img src="cid:x">')).toBe(2);
  });
});
