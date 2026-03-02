// logicle.ts
// True Logicle transform (raw -> axis/display in [0,1]) using Halley's method.
// No LUT. Works for negative values. Designed to match FlowJo/Floreada behavior
// when using the same (T, M, W, A).

import type { LogicleSettings } from '../store/types';

const LN10 = Math.log(10);
const EPS = Number.EPSILON;
const TAYLOR_LENGTH = 16;

type LogicleCoefficients = {
  // Derived internal parameters for fast evaluation.
  // Names mirror the standard logicle reference implementations.
  T: number;
  M: number;
  W: number;
  A: number;

  w: number;
  x0: number;
  x1: number;
  x2: number;
  b: number;
  d: number;
  a: number;
  c: number;
  f: number;

  xTaylor: number;
  taylor: Float64Array; // length TAYLOR_LENGTH
};

function logicleSolve(b: number, w: number): number {
  if (w === 0) return b;

  const tol = 2 * b * EPS;
  let dLo = 0;
  let dHi = b;
  let d = 0.5 * (dLo + dHi);

  // f(b) = -2 ln(b) + w b
  const fB = -2 * Math.log(b) + w * b;

  let f = 2 * Math.log(d) + w * d + fB;
  let lastF = NaN;
  let lastDelta = dHi - dLo;

  for (let iter = 0; iter < 20; iter++) {
    const df = 2 / d + w;

    // Use bisection if Newton step would leave bracket or isn't converging well
    const newtonBad =
      (((d - dHi) * df - f) * ((d - dLo) * df - f) >= 0) ||
      (Math.abs(1.9 * f) > Math.abs(lastDelta * df));

    let delta: number;

    if (newtonBad) {
      delta = 0.5 * (dHi - dLo);
      d = dLo + delta;
      if (d === dLo) return d;
    } else {
      delta = f / df;
      const t = d;
      d = d - delta;
      if (d === t) return d;
    }

    if (Math.abs(delta) < tol) return d;

    lastDelta = delta;
    f = 2 * Math.log(d) + w * d + fB;

    if (f === 0 || f === lastF) return d;
    lastF = f;

    if (f < 0) dLo = d;
    else dHi = d;
  }

  throw new Error("logicleSolve did not converge");
}

export function computeLogicleCoefficients(settings: LogicleSettings): LogicleCoefficients {
  const T = settings.T;
  const M = settings.M;
  const W = settings.W;
  const A = settings.A ?? 0;
  const bins = settings.bins ?? 0;

  if (!(T > 0)) throw new Error("Logicle: T must be > 0");
  if (!(M > 0)) throw new Error("Logicle: M must be > 0");
  if (!(W >= 0)) throw new Error("Logicle: W must be >= 0");
  if (2 * W > M) throw new Error("Logicle: require 2W <= M");
  if (-A > W || A + W > M - W) throw new Error("Logicle: A too large for given W,M");

  // Optional bin alignment: place 0 on an exact bin boundary in display coords.
  let Aeff = A;
  if (bins && bins > 0) {
    let zero = (W + Aeff) / (M + Aeff);
    zero = Math.round(zero * bins) / bins;
    Aeff = (M * zero - W) / (1 - zero);
  }

  const w = W / (M + Aeff);
  const x2 = Aeff / (M + Aeff);
  const x1 = x2 + w;         // location of 0 in display space
  const x0 = x2 + 2 * w;

  const b = (M + Aeff) * LN10;
  const d = logicleSolve(b, w);

  // Build a,c,f so that inverse transform matches T at top
  const cA = Math.exp(x0 * (b + d));
  const mfA = Math.exp(b * x1) - cA / Math.exp(d * x1);

  const a = T / ((Math.exp(b) - mfA) - cA / Math.exp(d));
  const c = cA * a;
  const f = -mfA * a;

  // Taylor region to avoid roundoff near zero
  const xTaylor = x1 + w / 4;

  let posCoef = a * Math.exp(b * x1);
  let negCoef = -c / Math.exp(d * x1);

  const taylor = new Float64Array(TAYLOR_LENGTH);
  for (let i = 0; i < TAYLOR_LENGTH; i++) {
    posCoef *= b / (i + 1);
    negCoef *= -d / (i + 1);
    taylor[i] = posCoef + negCoef;
  }
  taylor[1] = 0; // exact logicle condition

  return { T, M, W, A: Aeff, w, x0, x1, x2, b, d, a, c, f, xTaylor, taylor };
}

function seriesBiexponential(x: number, coeff: LogicleCoefficients): number {
  // Evaluate near-zero inverse with Taylor series (Horner), skipping taylor[1]
  const xt = x - coeff.x1;
  let s = coeff.taylor[TAYLOR_LENGTH - 1] * xt;
  for (let i = TAYLOR_LENGTH - 2; i >= 2; i--) {
    s = (s + coeff.taylor[i]) * xt;
  }
  return (s * xt + coeff.taylor[0]) * xt;
}

export function logicleScaleSingle(value: number, coeff: LogicleCoefficients): number {
  // Returns display coordinate in [0,1]
  if (value === 0) return coeff.x1;

  const neg = value < 0;
  const v = neg ? -value : value;

  // Initial guess:
  // - linear near zero
  // - log-ish for large values
  let x =
    v < -coeff.f
      ? coeff.x1 + v / coeff.taylor[0]
      : Math.log(v / coeff.a) / coeff.b;

  // Convergence tolerance
  const tol = x > 1 ? 3 * x * EPS : 3 * EPS;

  // Halley's method iterations
  for (let iter = 0; iter < 12; iter++) {
    // Compute y(x) = inverse(x) - v
    let y: number;
    if (x < coeff.xTaylor) {
      y = seriesBiexponential(x, coeff) - v;
    } else {
      const ae2bx = coeff.a * Math.exp(coeff.b * x);
      const ce2mdx = coeff.c / Math.exp(coeff.d * x);
      y = (ae2bx + coeff.f) - (ce2mdx + v);
    }

    // Derivatives
    const ae2bx = coeff.a * Math.exp(coeff.b * x);
    const ce2mdx = coeff.c / Math.exp(coeff.d * x);
    const dy = coeff.b * ae2bx + coeff.d * ce2mdx;
    const ddy = coeff.b * coeff.b * ae2bx - coeff.d * coeff.d * ce2mdx;

    // Halley update
    const denom = dy * (1 - (y * ddy) / (2 * dy * dy));
    const delta = y / denom;
    x -= delta;

    if (Math.abs(delta) < tol) break;
  }

  // Reflect negatives
  const xOut = neg ? 2 * coeff.x1 - x : x;

  // Clamp to [0,1] for plotting stability
  if (xOut < 0) return 0;
  if (xOut > 1) return 1;
  return xOut;
}
