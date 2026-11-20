import { gzipSync } from "node:zlib";

export interface BundleFile {
  readonly path: string;
  readonly content: Buffer;
}

const BLOCK = 512;

const writeString = (
  buffer: Buffer,
  value: string,
  offset: number,
  length: number,
): void => {
  buffer.write(value.slice(0, length), offset, length, "utf8");
};

const writeOctal = (
  buffer: Buffer,
  value: number,
  offset: number,
  length: number,
): void => {
  buffer.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
};

const header = (file: BundleFile, mtime: number): Buffer => {
  const block = Buffer.alloc(BLOCK, 0);
  writeString(block, file.path, 0, 100);
  writeOctal(block, 0o644, 100, 8);
  writeOctal(block, 0, 108, 8);
  writeOctal(block, 0, 116, 8);
  writeOctal(block, file.content.length, 124, 12);
  writeOctal(block, mtime, 136, 12);
  block.write("        ", 148, 8, "ascii");
  block.write("0", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  writeString(block, "freebuff", 265, 32);
  writeString(block, "freebuff", 297, 32);
  let checksum = 0;
  for (const byte of block) {
    checksum += byte;
  }
  block.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return block;
};

/**
 * Minimal ustar writer: deterministic mtime, POSIX paths, no symlinks. Used for
 * the eject download so it needs no external archiver.
 */
export const createTarGz = (
  files: readonly BundleFile[],
  options: { readonly mtimeSeconds?: number } = {},
): Buffer => {
  const mtime = options.mtimeSeconds ?? Math.floor(Date.now() / 1000);
  const chunks: Buffer[] = [];
  for (const file of files) {
    if (file.path.length > 100) {
      throw new Error(`Tar entry path is too long: ${file.path}`);
    }
    chunks.push(header(file, mtime));
    chunks.push(file.content);
    const remainder = file.content.length % BLOCK;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(BLOCK - remainder, 0));
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
};
