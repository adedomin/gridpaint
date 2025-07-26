// Copyright (C) 2020  Anthony DeDominic
// See COPYING for License

import type { GridPaint as gp } from '../index.js';

/** Stateful global for holding the start of a line drawing */
const control_points: ReadonlyArray<gp['cursor']> = [ { x: -1, y: -1 }, { x: -1, y: -1} ];


const STATE = {
    unset: 0,
    line: 1,
    bezier: 2,
} as const;
type StateEnum = typeof STATE[keyof typeof STATE];

/**
 * Detect if we are drawing a line or not
 * -1 being a sigil value indicating unset.
 *
 * @returns STATE.unset  if no control point set.
 *          STATE.line   if line control point set.
 *          STATE.bezier if quadratic bezier point set.
 */
function currentState(): StateEnum {
    if (control_points[0].x === -1 && control_points[0].y === -1) {
        return STATE.unset;
    }
    else if (control_points[1].x === -1 && control_points[1].y === -1) {
        return STATE.line;
    }
    else {
        return STATE.bezier;
    }
}

/**
 * clear the state of the control points.
 */
function clear(): void {
    for (let i = 0; i < control_points.length; ++i) {
        control_points[i].x = -1;
        control_points[i].y = -1;
    }
}

/**
 * Returns a series of points that make up and approximate
 * line between a starting point and an end point.
 * If the starting point is unset, the ending point is returned.
 *
 * @param x ending x point.
 * @param y ending y point.
 */
function* line_approx(x: number, y: number): Generator<
    gp['cursor'], undefined, undefined
> {
    switch (currentState()) {
    case STATE.unset:
        yield { x, y };
        break;
    case STATE.line: {
        let x1 = control_points[0].x;
        let y1 = control_points[0].y;
        const x2 = x;
        const y2 = y;
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const sx = (x1 < x2) ? 1 : -1;
        const sy = (y1 < y2) ? 1 : -1;
        let err = dx - dy;

        while (!(x1 === x2 && y1 === y2)) {
            yield { x: x1, y: y1 };
            const err2 = err << 1;
            if (err2 > -dy) {
                err -= dy;
                x1  += sx;
            }
            if (err2 < dx) {
                err += dx;
                y1  += sy;
            }
        }
        yield { x: x1, y: y1 };
        break;
    }
    case STATE.bezier: {
        const x1 = control_points[0].x;
        const x2 = control_points[1].x;
        const y1 = control_points[0].y;
        const y2 = control_points[1].y;
        for (let t = 0.0; t <= 1.0; t += 0.005) {
            const xp = (Math.pow(1 - t, 2) * x1) + (2 * (1 - t) * t * x2) + (Math.pow(t, 2) * x);
            const yp = (Math.pow(1 - t, 2) * y1) + (2 * (1 - t) * t * y2) + (Math.pow(t, 2) * y);
            yield { x: Math.round(xp), y: Math.round(yp) };
        }
        break;
    }
    }
}

/**
 * Draws a Line or Quadratic Bezier curve from start to finish.
 *
 * This function is stateful has two to three states:
 *   - No control points set:  unset
 *   - One control point set:  line
 *   - Two control points set: bezier
 * Initially the function is in the unset state.
 * When done drawing the line or curve, it returns to the unset state.
 * You can reset the state at any time by passing `true` as the first argument to this function.
 *
 * @param cancel If truthy, it will cancel the starting line coordinates.
 * @param bezier If truthy, it will draw a bezier curve instead of a line.
 */
function line(this: gp, cancel?: boolean, bezier?: boolean): void {
    if (cancel) return clear();

    const s = currentState();
    if (s === STATE.unset) {
        control_points[0].x = this.cursor.x;
        control_points[0].y = this.cursor.y;
    }
    else if (s === STATE.line && bezier) {
        control_points[1].x = this.cursor.x;
        control_points[1].y = this.cursor.y;
    }
    else {
        for (const { x, y } of line_approx(this.cursor.x, this.cursor.y)) {
            this.painting[y][x] = this.colour;
        }
        clear();
    }
}

export { line_approx, line };
