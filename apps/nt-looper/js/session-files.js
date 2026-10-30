// session-files.js
// Formatos locais para presets, projetos e exportacao em lote, sem servidor.

const NS_PROJECT_MAGIC = 'NTLOOP6\0';

function ns_safeFilename(value) {
  return String(value || 'sample')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sample';
}

async function ns_blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function ns_crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ns_dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function ns_buildStoreZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = ns_dosDateTime();

  for (const file of files) {
    const name = encoder.encode(ns_safeFilename(file.name));
    const data = file.data instanceof Uint8Array ? file.data : await ns_blobBytes(file.data);
    const crc = ns_crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
}

async function ns_packProject(setup, trackFiles) {
  const encoder = new TextEncoder();
  const payloads = [];
  const files = [];
  for (const entry of trackFiles) {
    const bytes = await ns_blobBytes(entry.data);
    files.push({
      kind: entry.kind || 'track',
      track: Number.isInteger(entry.track) ? entry.track : null,
      pad: Number.isInteger(entry.pad) ? entry.pad : null,
      name: entry.name,
      byteLength: bytes.length,
    });
    payloads.push(bytes);
  }
  const manifest = encoder.encode(JSON.stringify({
    format: 'NT LOOPER PROJECT',
    version: 17,
    createdAt: new Date().toISOString(),
    setup,
    files,
  }));
  const header = new Uint8Array(12);
  header.set(encoder.encode(NS_PROJECT_MAGIC), 0);
  new DataView(header.buffer).setUint32(8, manifest.length, true);
  return new Blob([header, manifest, ...payloads], { type: 'application/x-ntlooper' });
}

async function ns_unpackProject(file) {
  const bytes = await ns_blobBytes(file);
  if (bytes.length < 12) throw new Error('INVALID_PROJECT');
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, 8)) !== NS_PROJECT_MAGIC) throw new Error('INVALID_PROJECT');
  const manifestLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  const manifestStart = 12;
  const payloadStart = manifestStart + manifestLength;
  if (payloadStart > bytes.length) throw new Error('INVALID_PROJECT');
  const manifest = JSON.parse(decoder.decode(bytes.subarray(manifestStart, payloadStart)));
  let offset = payloadStart;
  const files = (manifest.files || []).map((entry) => {
    const end = offset + entry.byteLength;
    if (end > bytes.length) throw new Error('INVALID_PROJECT');
    const data = bytes.slice(offset, end);
    offset = end;
    return { kind: entry.kind || 'track', track: entry.track, pad: entry.pad, name: entry.name, data };
  });
  return { manifest, files };
}
