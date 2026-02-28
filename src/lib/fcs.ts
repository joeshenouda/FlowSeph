import type { ChannelData, ParsedFcs, SpilloverInfo } from '../types';

interface FcsHeader {
  textStart: number;
  textEnd: number;
  dataStart: number;
  dataEnd: number;
}

const HEADER_LENGTH = 58;

function parseOffset(field: string): number {
  const trimmed = field.trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid FCS offset: ${field}`);
  }

  return parsed;
}

function parseHeader(buffer: ArrayBuffer): FcsHeader {
  if (buffer.byteLength < HEADER_LENGTH) {
    throw new Error('File is too short to be a valid FCS file.');
  }

  const headerText = new TextDecoder('ascii').decode(buffer.slice(0, HEADER_LENGTH));
  const signature = headerText.slice(0, 6);

  if (!signature.startsWith('FCS')) {
    throw new Error('File does not start with an FCS signature.');
  }

  return {
    textStart: parseOffset(headerText.slice(10, 18)),
    textEnd: parseOffset(headerText.slice(18, 26)),
    dataStart: parseOffset(headerText.slice(26, 34)),
    dataEnd: parseOffset(headerText.slice(34, 42))
  };
}

function parseTextSegment(textSegment: string): Record<string, string> {
  if (!textSegment) {
    throw new Error('FCS TEXT segment is empty.');
  }

  const delimiter = textSegment[0];
  const tokens: string[] = [];
  let current = '';

  for (let i = 1; i < textSegment.length; i += 1) {
    const char = textSegment[i];
    if (char === delimiter) {
      if (textSegment[i + 1] === delimiter) {
        current += delimiter;
        i += 1;
      } else {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  const pairs: Record<string, string> = {};
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    pairs[tokens[i].toUpperCase()] = tokens[i + 1];
  }

  return pairs;
}

function parseSpillover(value: string | undefined): SpilloverInfo | undefined {
  if (!value) {
    return undefined;
  }

  const tokens = value.split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }

  const size = Number.parseInt(tokens[0], 10);
  if (!Number.isFinite(size) || size <= 0) {
    return undefined;
  }

  const expected = 1 + size + size * size;
  if (tokens.length < expected) {
    return undefined;
  }

  const channels = tokens.slice(1, 1 + size);
  const matrixValues = tokens.slice(1 + size, expected).map((token) => Number.parseFloat(token));

  if (matrixValues.some((val) => !Number.isFinite(val))) {
    return undefined;
  }

  const matrix: number[][] = [];
  for (let row = 0; row < size; row += 1) {
    matrix.push(matrixValues.slice(row * size, (row + 1) * size));
  }

  return { channels, matrix };
}

function readDataValue(
  view: DataView,
  offset: number,
  dataType: string,
  bits: number,
  littleEndian: boolean
): number {
  if (dataType === 'F') {
    return view.getFloat32(offset, littleEndian);
  }

  if (dataType === 'D') {
    return view.getFloat64(offset, littleEndian);
  }

  if (dataType === 'I') {
    switch (bits) {
      case 8:
        return view.getUint8(offset);
      case 16:
        return view.getUint16(offset, littleEndian);
      case 32:
        return view.getUint32(offset, littleEndian);
      case 64:
        return Number(view.getBigUint64(offset, littleEndian));
      default:
        throw new Error(`Unsupported integer bit width: ${bits}`);
    }
  }

  throw new Error(`Unsupported FCS data type: ${dataType}`);
}

export function parseFcsFile(buffer: ArrayBuffer): ParsedFcs {
  const header = parseHeader(buffer);
  const textSegment = new TextDecoder('ascii').decode(buffer.slice(header.textStart, header.textEnd + 1));
  const text = parseTextSegment(textSegment);

  const parameterCount = Number.parseInt(text.$PAR ?? '', 10);
  const eventCount = Number.parseInt(text.$TOT ?? '', 10);
  const dataType = (text.$DATATYPE ?? 'F').toUpperCase();
  const byteOrder = text.$BYTEORD ?? '1,2,3,4';
  const littleEndian = byteOrder.startsWith('1,2');

  if (!Number.isFinite(parameterCount) || parameterCount <= 0) {
    throw new Error('Invalid or missing $PAR value in FCS TEXT segment.');
  }

  if (!Number.isFinite(eventCount) || eventCount <= 0) {
    throw new Error('Invalid or missing $TOT value in FCS TEXT segment.');
  }

  const paramBits: number[] = [];
  const channels: ChannelData[] = [];

  for (let p = 1; p <= parameterCount; p += 1) {
    const bits = Number.parseInt(text[`$P${p}B`] ?? '', 10);
    if (!Number.isFinite(bits) || bits <= 0 || bits % 8 !== 0) {
      throw new Error(`Unsupported bit width for channel ${p}.`);
    }

    const name = text[`$P${p}S`] || text[`$P${p}N`] || `P${p}`;
    paramBits.push(bits);
    channels.push({ name, values: new Float32Array(eventCount) });
  }

  const dataStart = header.dataStart > 0 ? header.dataStart : Number.parseInt(text.$BEGINDATA ?? '0', 10);
  const dataEnd = header.dataEnd > 0 ? header.dataEnd : Number.parseInt(text.$ENDDATA ?? '0', 10);

  if (!Number.isFinite(dataStart) || dataStart <= 0 || !Number.isFinite(dataEnd) || dataEnd <= dataStart) {
    throw new Error('Invalid DATA segment offsets in FCS file.');
  }

  const view = new DataView(buffer);
  const bytesPerEvent = paramBits.reduce((sum, bits) => sum + bits / 8, 0);

  for (let event = 0; event < eventCount; event += 1) {
    let cursor = dataStart + event * bytesPerEvent;
    for (let p = 0; p < parameterCount; p += 1) {
      const bits = paramBits[p];
      const value = readDataValue(view, cursor, dataType, bits, littleEndian);
      channels[p].values[event] = Number.isFinite(value) ? value : 0;
      cursor += bits / 8;
    }
  }

  const spillover = parseSpillover(text.$SPILLOVER ?? text.SPILL);

  return {
    eventCount,
    channels,
    spillover
  };
}
