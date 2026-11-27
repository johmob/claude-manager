import { describe, expect, it } from 'vitest';
import { encodeWav16, padToMinLength, resampleLinear, rms } from './wav';

describe('padToMinLength', () => {
  it('pads short clips with silence and keeps the samples', () => {
    const out = padToMinLength(new Float32Array([0.5, -0.5]), 5);
    expect(Array.from(out)).toEqual([0.5, -0.5, 0, 0, 0]);
  });
  it('leaves long clips alone', () => {
    const a = new Float32Array(10);
    expect(padToMinLength(a, 5)).toBe(a);
  });
});

const tag = (b: Uint8Array, o: number): string => String.fromCharCode(...b.slice(o, o + 4));

describe('encodeWav16', () => {
  it('writes a valid 16 kHz mono 16-bit header', () => {
    const wav = encodeWav16(new Float32Array(100), 16000);
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(wav.length).toBe(44 + 200);
    expect(tag(wav, 0)).toBe('RIFF');
    expect(tag(wav, 8)).toBe('WAVE');
    expect(tag(wav, 12)).toBe('fmt ');
    expect(tag(wav, 36)).toBe('data');
    expect(v.getUint32(4, true)).toBe(wav.length - 8);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(200);
  });
  it('clamps samples', () => {
    const wav = encodeWav16(new Float32Array([2, -2, 0.5]), 16000);
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(Math.round(0.5 * 32767));
  });
});

describe('resampleLinear', () => {
  it('gives the right length', () => {
    expect(resampleLinear(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(100), 16000, 16000).length).toBe(100);
  });
  it('keeps a constant signal constant', () => {
    const out = resampleLinear(new Float32Array(300).fill(0.25), 44100, 16000);
    expect(out.every((x) => Math.abs(x - 0.25) < 1e-6)).toBe(true);
  });
});

describe('rms', () => {
  it('is 0 for silence and empty', () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });
  it('is the amplitude for a constant and amp/sqrt2 for a sine', () => {
    expect(rms(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5);
    const sine = new Float32Array(1000).map((_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(rms(sine)).toBeCloseTo(Math.SQRT1_2, 2);
  });
});
