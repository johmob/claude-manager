// Pure placement rules for the overlay: snapping to fixed places and hiding over a maximised app.
import type { OverlayAnchor } from '../../../shared/contracts';

export type OverlaySnap = NonNullable<OverlayAnchor['snap']>;
export interface Box { x: number; y: number; width: number; height: number }

/** How close to an edge (px) the overlay must be to snap. */
export const SNAP_EDGE = 48;
/** How close to the middle of that edge (px) it must be. */
export const SNAP_MIDDLE = 120;
const SNAP_MARGIN = 8;
const TOP_GAP = 2;

/** The place the overlay would snap to, or null: top centre, middle left or middle right of the work area. `bounds` is the icon row only, not an open detail panel below it. */
export function snapZone(bounds: Box, area: Box): OverlaySnap | null {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const midX = area.x + area.width / 2;
  const midY = area.y + area.height / 2;
  if (Math.abs(bounds.y - area.y) <= SNAP_EDGE && Math.abs(cx - midX) <= SNAP_MIDDLE) return 'top';
  if (Math.abs(bounds.x - area.x) <= SNAP_EDGE && Math.abs(cy - midY) <= SNAP_MIDDLE) return 'left';
  if (Math.abs(area.x + area.width - (bounds.x + bounds.width)) <= SNAP_EDGE && Math.abs(cy - midY) <= SNAP_MIDDLE) return 'right';
  return null;
}

/** Where a snapped overlay of this size sits; `rowHeight` is the icon row, the rest is the open detail panel. */
export function snappedPosition(snap: OverlaySnap, area: Box, width: number, height: number, rowHeight = height): { x: number; y: number } {
  const clampY = (y: number): number => Math.max(area.y, Math.min(y, area.y + area.height - height));
  if (snap === 'top') return { x: Math.round(area.x + (area.width - width) / 2), y: area.y + TOP_GAP };
  const x = snap === 'left' ? area.x + SNAP_MARGIN : area.x + area.width - width - SNAP_MARGIN;
  return { x, y: Math.round(clampY(area.y + (area.height - rowHeight) / 2)) };
}

export interface SuppressFlags {
  /** The main window is shown (not hidden to the tray). */
  mainVisible: boolean;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  /** The overlay is on the display the main window is on. */
  sameDisplay: boolean;
  /** One of the app's own windows has focus (so nothing else covers the main window). */
  appFocused: boolean;
}

/** The overlay hides only while the app fills the screen and is the window in front. */
export function overlaySuppressed(f: SuppressFlags): boolean {
  return f.mainVisible && !f.minimized && (f.maximized || f.fullscreen) && f.sameDisplay && f.appFocused;
}
