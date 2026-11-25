// vendored from code-kit@0.89.0, src/ts/pure/bytes-equal.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Two byte arrays hold the same bytes. A full comparison, no hash: for the callers that have both files in memory anyway (a snapshot against the file it
 *  would replace, an attachment against the copy on disk, a recording part against the one already written) and want to know whether a write is needed.
 *
 *  Origin (Welle 37, kit-a): `sameBytes` of `chunk-journal.ts` (this repo), obsidian-kit `file-snapshot.ts` (took two `ArrayBuffer`s) and `replace-file-safely.ts`,
 *  mailstone `core/mirror/attachments.ts` (exported, ordered by `.length`), plus an inline loop in filename-sanitizer `engine.ts` and a hash comparison
 *  (`sha256Hex(a) === sha256Hex(b)`) in docs-mirror `core/apply.ts`. The four loops answer the same on every `Uint8Array`; the hash version answers the same
 *  too, bar a collision, but reads both arrays to the end and hashes them twice, and this one stops at the first byte that differs.
 *
 *  Decisions: **`Uint8Array` only.** A caller with an `ArrayBuffer` writes `bytesEqual(new Uint8Array(a), new Uint8Array(b))`, a view and no copy; one signature
 *  for two kinds of argument would hide that the cheap thing and the expensive thing look the same. **Views compare by their own window:** two views over
 *  different buffers or different offsets are equal when the bytes they show are, `Buffer` (a `Uint8Array`) included. **Not constant time:** it returns at the
 *  first difference, so it is no check for a secret (a MAC, a token); that wants a constant-time comparison. Pure, no I/O, linear in the shorter length. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
