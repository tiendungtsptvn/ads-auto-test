import fs from 'node:fs';
import path from 'node:path';
import { ToolError } from './errors.js';

/** Giới hạn kích thước mặc định của file đầu vào (mvp.md, mục "Quy tắc đầu vào"). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Kiểm tra đường dẫn do người dùng truyền vào: tuyệt đối, chuẩn hóa, là file thường,
 * không phải symlink, không vượt giới hạn kích thước. Trả về đường dẫn đã chuẩn hóa.
 */
export function validateInputFile(
  rawPath: unknown,
  label: string,
  maxBytes: number = MAX_FILE_BYTES,
): string {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    throw new ToolError(`${label} không hợp lệ. Hãy truyền đường dẫn tuyệt đối tới file.`);
  }
  if (!path.isAbsolute(rawPath)) {
    throw new ToolError(`${label} phải là đường dẫn tuyệt đối.`);
  }
  const resolved = path.resolve(rawPath);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new ToolError(`Không tìm thấy hoặc không đọc được ${label}. Kiểm tra lại đường dẫn.`);
  }
  if (stat.isSymbolicLink()) {
    throw new ToolError(`${label} là symlink, không được hỗ trợ. Hãy truyền đường dẫn tới file thật.`);
  }
  if (!stat.isFile()) {
    throw new ToolError(`${label} phải là file thường, không phải thư mục.`);
  }
  if (stat.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new ToolError(`${label} vượt giới hạn ${mb} MB.`);
  }
  return resolved;
}

/**
 * Đọc file text, xử lý BOM (UTF-8, UTF-16 LE/BE) và UTF-16 không BOM.
 * CRLF được chuẩn hóa khi tách dòng, ở tầng parser.
 */
export function readTextFile(filePath: string): string {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    throw new ToolError('Không đọc được file. Kiểm tra quyền truy cập.');
  }
  return decodeText(buf);
}

export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  // UTF-16 LE không BOM: byte lẻ toàn 0x00 trong phần đầu file
  if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00 && buf[0] !== 0x00) {
    return buf.toString('utf16le');
  }
  return buf.toString('utf8');
}
