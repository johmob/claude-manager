// voice/assets: what is downloaded for local speech-to-text, and where it lands. Pure data and paths.
// whisper.cpp Windows builds sit on build tags (the newest release tag has no binaries). A new tag lands in a
// new folder, so updating is a change of these constants.
import { join } from 'node:path';

export interface VoiceAsset {
  url: string;
  /** Exact byte size, checked before the file is used. */
  size: number;
  sha256: string;
}

export const WHISPER_TAG = 'b5907';

/** Plain CPU x64 build. The zip holds a `Release/` folder; ggml picks the best `ggml-cpu-*.dll` at run time. */
export const WHISPER_ZIP: VoiceAsset & { tag: string } = {
  tag: WHISPER_TAG,
  url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`,
  size: 9_168_428,
  sha256: 'ecca07b277d943e9b9f4712856a144b857271a6b333104e511e1988e80db582b',
};

/** KBLab Swedish models (Apache-2.0), q5_0, pinned to a revision. */
export const VOICE_MODELS = {
  small: {
    file: 'kb-whisper-small-q5_0.bin',
    url: 'https://huggingface.co/KBLab/kb-whisper-small/resolve/3564d61a42fc210ceaa55a22a96dd64478959c78/ggml-model-q5_0.bin',
    size: 175_209_680,
    sha256: '6768836a51abc902e420c613153e6d418c90ea2774e913274d02ab23170225b7',
  },
  base: {
    file: 'kb-whisper-base-q5_0.bin',
    url: 'https://huggingface.co/KBLab/kb-whisper-base/resolve/1499d2d2f0c7ed545bd6f2eec85287cf8d8c8b38/ggml-model-q5_0.bin',
    size: 55_295_450,
    sha256: 'aead29b356bca8840e72a8dc2286e2d69e6702639751a1e60cb3c8eacefec546',
  },
} as const satisfies Record<string, VoiceAsset & { file: string }>;

export type VoiceModelName = keyof typeof VOICE_MODELS;
export const DEFAULT_MODEL: VoiceModelName = 'small';

export interface VoicePaths {
  /** Folder holding whisper-cli.exe and its DLLs. */
  binDir: string;
  cli: string;
  model: string;
  /** Temp WAV/TXT files while transcribing, and the zip download. */
  tmp: string;
}

export function voicePaths(dir: string, model: VoiceModelName = DEFAULT_MODEL): VoicePaths {
  const binDir = join(dir, `whisper-${WHISPER_TAG}`);
  return { binDir, cli: join(binDir, 'whisper-cli.exe'), model: join(dir, 'models', VOICE_MODELS[model].file), tmp: join(dir, 'tmp') };
}
