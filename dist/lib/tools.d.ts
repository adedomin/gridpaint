import { bucket } from './bucket';
import { clear } from './clear';
import { replace } from './replace';
import { line, line_approx } from './line';
import type { GridPaint as gp } from '../index';
declare function apply(this: gp, isApplied?: boolean): void;
declare function compare(this: gp): void;
declare type GridPaintActionTools = 'pencil' | 'bucket' | 'line';
declare type GridPaintTools = 'clear' | 'undo' | 'redo';
declare function pencil(this: gp): void;
declare function redo(this: gp): void;
declare function undo(this: gp): void;
export { pencil, bucket, line, redo, undo, clear, apply, replace, compare, line_approx, };
export type { GridPaintActionTools, GridPaintTools };
