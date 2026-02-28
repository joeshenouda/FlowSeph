import type { ChannelData, SpilloverInfo } from '../types';

function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => {
    const identity = Array.from({ length: n }, (_, j) => (i === j ? 1 : 0));
    return [...row, ...identity];
  });

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) {
        pivotRow = row;
      }
    }

    if (Math.abs(augmented[pivotRow][col]) < 1e-12) {
      throw new Error('Spillover matrix is singular and cannot be inverted.');
    }

    if (pivotRow !== col) {
      const temp = augmented[col];
      augmented[col] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const pivot = augmented[col][col];
    for (let j = 0; j < 2 * n; j += 1) {
      augmented[col][j] /= pivot;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }

      const factor = augmented[row][col];
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

export function applyCompensation(channels: ChannelData[], spillover?: SpilloverInfo): ChannelData[] {
  if (!spillover) {
    return channels.map((channel) => ({ name: channel.name, values: channel.values.slice() }));
  }

  const indices = spillover.channels.map((name) =>
    channels.findIndex((channel) => channel.name.toLowerCase() === name.toLowerCase())
  );

  if (indices.some((index) => index < 0)) {
    return channels.map((channel) => ({ name: channel.name, values: channel.values.slice() }));
  }

  const inverse = invertMatrix(spillover.matrix);
  const eventCount = channels[0]?.values.length ?? 0;
  const output = channels.map((channel) => ({ name: channel.name, values: channel.values.slice() }));

  for (let event = 0; event < eventCount; event += 1) {
    const measured = indices.map((idx) => channels[idx].values[event]);

    for (let row = 0; row < inverse.length; row += 1) {
      let corrected = 0;
      for (let col = 0; col < inverse.length; col += 1) {
        corrected += inverse[row][col] * measured[col];
      }
      output[indices[row]].values[event] = corrected;
    }
  }

  return output;
}

export function applyArcsinh(channels: ChannelData[], cofactor: number): ChannelData[] {
  if (cofactor <= 0) {
    throw new Error('Arcsinh cofactor must be greater than zero.');
  }

  return channels.map((channel) => {
    const values = channel.values;
    const transformed = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 1) {
      transformed[i] = Math.asinh(values[i] / cofactor);
    }
    return { name: channel.name, values: transformed };
  });
}
