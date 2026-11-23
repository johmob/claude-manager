// keep-awake: stops Windows from sleeping and turning the display off while on, so agents keep working
// overnight. Uses Windows' own mechanism (as video players do), not fake input.
import { powerSaveBlocker } from 'electron';

export interface KeepAwake {
  set(on: boolean): void;
}

export function createKeepAwake(): KeepAwake {
  let blocker: number | null = null;
  return {
    set(on) {
      if (on && blocker === null) blocker = powerSaveBlocker.start('prevent-display-sleep');
      if (!on && blocker !== null) {
        powerSaveBlocker.stop(blocker);
        blocker = null;
      }
    },
  };
}
