// Pure-TS zlib/raw DEFLATE decoder (RFC 1950/1951). No deps, no Node APIs: runs on Hermes.
// ponytail: simple canonical-Huffman decode (bit-by-bit), ~5-10 MB/s on a phone; table-driven if it ever matters.
type Tree = { counts: Uint16Array; symbols: Uint16Array };
function build(lengths: Uint8Array, off: number, n: number): Tree {
  const counts = new Uint16Array(16), symbols = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[off + i]]++;
  counts[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  for (let i = 0; i < n; i++) if (lengths[off + i]) symbols[offs[lengths[off + i]]++] = i;
  return { counts, symbols };
}
const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
const fixed = (() => {
  const l = new Uint8Array(320);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); l.fill(5, 288, 320);
  return [build(l, 0, 288), build(l, 288, 30)] as const;
})();

export function inflate(src: Uint8Array, zlibHeader = true): Uint8Array {
  let pos = zlibHeader ? 2 : 0, bit = 0, bits = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0;
  const need = (k: number) => { if (n + k > out.length) { const o = new Uint8Array(Math.max(out.length * 2, n + k)); o.set(out); out = o; } };
  const get = (k: number) => {
    while (bits < k) { if (pos >= src.length) throw new Error("inflate: truncated"); bit |= src[pos++] << bits; bits += 8; }
    const v = bit & ((1 << k) - 1); bit >>>= k; bits -= k; return v;
  };
  const sym = (t: Tree) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= get(1); const c = t.counts[len];
      if (code - first < c) return t.symbols[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error("inflate: bad code");
  };
  let final = 0;
  while (!final) {
    final = get(1); const type = get(2);
    if (type === 0) {
      bit = 0; bits = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      if (pos + len > src.length) throw new Error("inflate: truncated");
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len; continue;
    }
    let lt: Tree, dt: Tree;
    if (type === 1) [lt, dt] = fixed;
    else if (type === 2) {
      const hl = get(5) + 257, hd = get(5) + 1, hc = get(4) + 4, lens = new Uint8Array(320);
      for (let i = 0; i < hc; i++) lens[CLORDER[i]] = get(3);
      const ct = build(lens, 0, 19); lens.fill(0, 0, 19);
      for (let i = 0; i < hl + hd;) {
        const s = sym(ct);
        if (s < 16) lens[i++] = s;
        else { const [rep, prev] = s === 16 ? [3 + get(2), lens[i - 1]] : s === 17 ? [3 + get(3), 0] : [11 + get(7), 0]; lens.fill(prev, i, i + rep); i += rep; }
      }
      lt = build(lens, 0, hl); dt = build(lens, hl, hd);
    } else throw new Error("inflate: bad block type");
    for (;;) {
      const s = sym(lt);
      if (s === 256) break;
      if (s < 256) { need(1); out[n++] = s; continue; }
      const len = LBASE[s - 257] + get(LEXT[s - 257]), ds = sym(dt), d = DBASE[ds] + get(DEXT[ds]);
      if (d > n) throw new Error("inflate: bad distance");
      need(len); for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
    }
  }
  return out.subarray(0, n);
}
