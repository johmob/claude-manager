import { describe, expect, it } from 'vitest';
import { decidePermission, fakeMicSwitches } from './index';

const isApp = (url: string) => url.startsWith('http://localhost:5173/') || url.startsWith('file:///app/');
const own = 'http://localhost:5173/index.html';

describe('decidePermission', () => {
  it('allows the microphone (audio only) for the app\'s own pages', () => {
    expect(decidePermission('media', { mediaTypes: ['audio'], requestingUrl: own }, isApp)).toBe(true);
  });

  it('allows audio when no media types are given', () => {
    expect(decidePermission('media', { requestingUrl: own }, isApp)).toBe(true);
  });

  it('denies video', () => {
    expect(decidePermission('media', { mediaTypes: ['video'], requestingUrl: own }, isApp)).toBe(false);
    expect(decidePermission('media', { mediaTypes: ['audio', 'video'], requestingUrl: own }, isApp)).toBe(false);
  });

  it('denies a page that is not the app', () => {
    expect(decidePermission('media', { mediaTypes: ['audio'], requestingUrl: 'https://example.com/' }, isApp)).toBe(false);
    expect(decidePermission('media', { mediaTypes: ['audio'] }, isApp)).toBe(false);
  });

  it('denies other permissions the app does not use', () => {
    expect(decidePermission('geolocation', { requestingUrl: own }, isApp)).toBe(false);
    expect(decidePermission('notifications', { requestingUrl: own }, isApp)).toBe(false);
    expect(decidePermission('display-capture', { requestingUrl: own }, isApp)).toBe(false);
  });

  it('keeps clipboard writes allowed', () => {
    expect(decidePermission('clipboard-sanitized-write', { requestingUrl: own }, isApp)).toBe(true);
  });
});

describe('fakeMicSwitches', () => {
  it('gives the fake-mic switches only with test mode and a file', () => {
    const switches = fakeMicSwitches({ CLAUDE_MANAGER_TEST: '1', CLAUDE_MANAGER_FAKE_MIC: 'C:/scratch/speech.wav' });
    expect(switches.map((s) => s[0])).toEqual([
      'use-fake-ui-for-media-stream',
      'use-fake-device-for-media-stream',
      'use-file-for-fake-audio-capture',
    ]);
    expect(switches[2][1]).toBe('C:/scratch/speech.wav%noloop');
  });

  it('gives nothing without test mode', () => {
    expect(fakeMicSwitches({ CLAUDE_MANAGER_FAKE_MIC: 'C:/scratch/speech.wav' })).toEqual([]);
    expect(fakeMicSwitches({ CLAUDE_MANAGER_TEST: '0', CLAUDE_MANAGER_FAKE_MIC: 'C:/scratch/speech.wav' })).toEqual([]);
  });

  it('gives nothing without a fake-mic file', () => {
    expect(fakeMicSwitches({ CLAUDE_MANAGER_TEST: '1' })).toEqual([]);
  });
});
