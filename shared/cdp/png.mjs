// Разбор и сборка PNG без зависимостей: zlib есть в Node, остальное — сто
// строк на распаковку строк развёртки. Ставить ради пиксельного дифа пакет с
// собственным деревом зависимостей не стоит.
//
// Поддержаны 8 бит на канал без чересстрочности — это то, что отдаёт
// Page.captureScreenshot. Палитра и 16 бит осознанно не поддержаны: встретив
// их, лучше упасть с внятной ошибкой, чем молча сравнить мусор.
import { inflateSync, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Разбирает PNG в { width, height, pixels } — пиксели всегда RGBA. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Это не PNG');

  let offset = 8;
  let header = null;
  const dataChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      dataChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!header) throw new Error('В PNG нет IHDR');
  if (header.bitDepth !== 8) throw new Error(`Ожидалось 8 бит на канал, а не ${header.bitDepth}`);
  if (header.interlace !== 0) throw new Error('Чересстрочный PNG не поддержан');
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`Тип цвета ${header.colorType} не поддержан`);

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(dataChunks));
  const stride = width * channels;
  const lines = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const target = lines.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? target[x - channels] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= channels ? previous[x - channels] : 0;
      let value = source[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Неизвестный фильтр строки: ${filter}`);
      target[x] = value & 0xff;
    }
  }

  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const from = i * channels;
    const to = i * 4;
    if (channels === 4) {
      lines.copy(pixels, to, from, from + 4);
    } else if (channels === 3) {
      lines.copy(pixels, to, from, from + 3);
      pixels[to + 3] = 255;
    } else if (channels === 2) {
      pixels[to] = pixels[to + 1] = pixels[to + 2] = lines[from];
      pixels[to + 3] = lines[from + 1];
    } else {
      pixels[to] = pixels[to + 1] = pixels[to + 2] = lines[from];
      pixels[to + 3] = 255;
    }
  }

  return { width, height, pixels };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Собирает RGBA-пиксели обратно в PNG без фильтрации строк. */
export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Сравнивает два снимка. Отличающиеся пиксели подсвечиваются красным поверх
 * приглушённого оригинала — так на дифе видно, ЧТО именно поехало.
 */
export function diffPng(baselineBuffer, currentBuffer, { threshold = 12 } = {}) {
  const baseline = decodePng(baselineBuffer);
  const current = decodePng(currentBuffer);

  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      sameSize: false,
      differing: current.width * current.height,
      total: current.width * current.height,
      ratio: 1,
      baselineSize: `${baseline.width}x${baseline.height}`,
      currentSize: `${current.width}x${current.height}`,
      image: null,
    };
  }

  const total = current.width * current.height;
  const image = Buffer.alloc(total * 4);
  let differing = 0;

  for (let i = 0; i < total; i++) {
    const at = i * 4;
    const delta = Math.max(
      Math.abs(baseline.pixels[at] - current.pixels[at]),
      Math.abs(baseline.pixels[at + 1] - current.pixels[at + 1]),
      Math.abs(baseline.pixels[at + 2] - current.pixels[at + 2]),
      Math.abs(baseline.pixels[at + 3] - current.pixels[at + 3]),
    );
    if (delta > threshold) {
      differing++;
      image[at] = 255;
      image[at + 1] = 40;
      image[at + 2] = 40;
    } else {
      const grey = Math.round(
        (current.pixels[at] * 0.3 + current.pixels[at + 1] * 0.59 + current.pixels[at + 2] * 0.11) *
          0.35 +
          160,
      );
      image[at] = image[at + 1] = image[at + 2] = Math.min(255, grey);
    }
    image[at + 3] = 255;
  }

  return {
    sameSize: true,
    differing,
    total,
    ratio: differing / total,
    image: encodePng({ width: current.width, height: current.height, pixels: image }),
  };
}
