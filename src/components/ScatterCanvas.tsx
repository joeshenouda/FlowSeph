import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { DataGate } from '../types';

interface ScatterCanvasProps {
  xValues: Float32Array;
  yValues: Float32Array;
  width?: number;
  height?: number;
  gate: DataGate | null;
  onGateChange: (gate: DataGate | null) => void;
}

interface PixelRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface Domain {
  min: number;
  max: number;
}

function computeDomain(values: Float32Array): Domain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }

  return { min, max };
}

function toPixel(value: number, domain: Domain, size: number): number {
  return ((value - domain.min) / (domain.max - domain.min)) * (size - 1);
}

function toData(pixel: number, domain: Domain, size: number): number {
  return domain.min + (pixel / (size - 1)) * (domain.max - domain.min);
}

export default function ScatterCanvas({
  xValues,
  yValues,
  width = 820,
  height = 520,
  gate,
  onGateChange
}: ScatterCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragRect, setDragRect] = useState<PixelRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  const xDomain = useMemo(() => computeDomain(xValues), [xValues]);
  const yDomain = useMemo(() => computeDomain(yValues), [yValues]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04111f';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(80, 202, 255, 0.56)';
    const count = Math.min(xValues.length, yValues.length);
    for (let i = 0; i < count; i += 1) {
      const px = toPixel(xValues[i], xDomain, width);
      const py = height - 1 - toPixel(yValues[i], yDomain, height);
      ctx.fillRect(px, py, 1.4, 1.4);
    }

    if (gate) {
      const x1 = toPixel(gate.minX, xDomain, width);
      const x2 = toPixel(gate.maxX, xDomain, width);
      const y1 = height - 1 - toPixel(gate.maxY, yDomain, height);
      const y2 = height - 1 - toPixel(gate.minY, yDomain, height);
      ctx.strokeStyle = 'rgba(255, 188, 78, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }

    if (dragRect) {
      const x = Math.min(dragRect.startX, dragRect.endX);
      const y = Math.min(dragRect.startY, dragRect.endY);
      const w = Math.abs(dragRect.endX - dragRect.startX);
      const h = Math.abs(dragRect.endY - dragRect.startY);

      ctx.fillStyle = 'rgba(255, 121, 63, 0.18)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255, 121, 63, 0.96)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x, y, w, h);
    }
  }, [xValues, yValues, xDomain, yDomain, width, height, gate, dragRect]);

  function getLocalPoint(event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(width - 1, event.clientX - rect.left)),
      y: Math.max(0, Math.min(height - 1, event.clientY - rect.top))
    };
  }

  function handleMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    const point = getLocalPoint(event);
    setDragStart(point);
    setDragRect({ startX: point.x, startY: point.y, endX: point.x, endY: point.y });
  }

  function handleMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!dragStart) {
      return;
    }

    const point = getLocalPoint(event);
    setDragRect({ startX: dragStart.x, startY: dragStart.y, endX: point.x, endY: point.y });
  }

  function handleMouseUp(event: MouseEvent<HTMLCanvasElement>) {
    if (!dragStart) {
      return;
    }

    const point = getLocalPoint(event);
    const minPx = Math.min(dragStart.x, point.x);
    const maxPx = Math.max(dragStart.x, point.x);
    const minPy = Math.min(dragStart.y, point.y);
    const maxPy = Math.max(dragStart.y, point.y);

    setDragStart(null);
    setDragRect(null);

    if (Math.abs(maxPx - minPx) < 3 || Math.abs(maxPy - minPy) < 3) {
      onGateChange(null);
      return;
    }

    const minX = toData(minPx, xDomain, width);
    const maxX = toData(maxPx, xDomain, width);
    const maxY = toData(height - 1 - minPy, yDomain, height);
    const minY = toData(height - 1 - maxPy, yDomain, height);

    onGateChange({ minX, maxX, minY, maxY });
  }

  function handleMouseLeave() {
    setDragStart(null);
    setDragRect(null);
  }

  return (
    <canvas
      ref={canvasRef}
      className="scatter-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}
