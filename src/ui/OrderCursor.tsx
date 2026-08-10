/**
 * Plays the click animation where the player clicked.
 *
 * A DOM canvas rather than anything in Pixi, because this belongs to the cursor: it
 * happens at a point on the *screen* and must not pan, zoom or scale with the world. It
 * also has to keep animating while the game is paused, which rules out anything driven
 * by the simulation clock.
 *
 * The drawing itself is `render/art/orderCursor.ts`, a pure function of normalised time —
 * see the note there about why an animation is written that way.
 */

import { useEffect, useRef } from 'react';
import {
  drawOrderCursor,
  ORDER_CURSOR_MS,
  ORDER_CURSOR_SIZE,
} from '../render/art/orderCursor';
import type { OrderPing } from '../app/uiStore';

interface OrderCursorProps {
  /** Null until the first order. A new `id` is what replays it. */
  readonly ping: OrderPing | null;
}

export function OrderCursor({ ping }: OrderCursorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ping) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const started = performance.now();

    const step = (now: number): void => {
      const t = (now - started) / ORDER_CURSOR_MS;
      drawOrderCursor(ctx, ORDER_CURSOR_SIZE, t);
      // Past the end the draw call has already cleared the canvas, so stopping here
      // leaves nothing behind rather than freezing on the last frame.
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Keyed on `id`, so clicking the same tile twice replays rather than doing nothing.
  }, [ping]);

  if (!ping) return null;

  return (
    <canvas
      ref={canvasRef}
      className="order-cursor"
      width={ORDER_CURSOR_SIZE}
      height={ORDER_CURSOR_SIZE}
      style={{ left: ping.x - ORDER_CURSOR_SIZE / 2, top: ping.y - ORDER_CURSOR_SIZE / 2 }}
    />
  );
}
