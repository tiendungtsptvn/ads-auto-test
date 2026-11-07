import zlib from 'node:zlib';
import { ToolError } from './errors.js';
export const DEFAULT_ZIP_LIMITS = {
    maxEntries: 2000,
    maxEntryBytes: 100 * 1024 * 1024,
    maxTotalBytes: 300 * 1024 * 1024,
};
const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const BAD_ZIP = 'File zip hỏng hoặc không đọc được.';
export class ZipArchive {
    buf;
    limits;
    entries = new Map();
    constructor(buf, limits) {
        this.buf = buf;
        this.limits = limits;
    }
    static open(buf, limits = DEFAULT_ZIP_LIMITS) {
        const zip = new ZipArchive(buf, limits);
        zip.parseDirectory();
        return zip;
    }
    has(name) {
        return this.entries.has(name);
    }
    names() {
        return [...this.entries.keys()];
    }
    /** Đọc và giải nén một entry. Kích thước thực tế phải khớp khai báo (chống zip bomb khai gian). */
    read(name) {
        const e = this.entries.get(name);
        if (!e)
            throw new ToolError(`File xlsx thiếu thành phần bắt buộc (${name}).`);
        const { buf } = this;
        if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== SIG_LOCAL) {
            throw new ToolError(BAD_ZIP);
        }
        const nameLen = buf.readUInt16LE(e.localOffset + 26);
        const extraLen = buf.readUInt16LE(e.localOffset + 28);
        const start = e.localOffset + 30 + nameLen + extraLen;
        const end = start + e.compSize;
        if (end > buf.length)
            throw new ToolError(BAD_ZIP);
        const raw = buf.subarray(start, end);
        if (e.uncompSize === 0)
            return Buffer.alloc(0);
        let out;
        if (e.method === 0) {
            out = Buffer.from(raw);
        }
        else {
            try {
                out = zlib.inflateRawSync(raw, { maxOutputLength: e.uncompSize });
            }
            catch {
                throw new ToolError('Không giải nén được file xlsx (hỏng, hoặc kích thước thực tế vượt khai báo).');
            }
        }
        if (out.length !== e.uncompSize)
            throw new ToolError(BAD_ZIP);
        return out;
    }
    parseDirectory() {
        const { buf, limits } = this;
        const eocd = this.findEocd();
        const total = buf.readUInt16LE(eocd + 10);
        const cdSize = buf.readUInt32LE(eocd + 12);
        const cdOffset = buf.readUInt32LE(eocd + 16);
        if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
            throw new ToolError('File zip64 không được hỗ trợ.');
        }
        if (total > limits.maxEntries) {
            throw new ToolError(`File xlsx có quá nhiều thành phần (tối đa ${limits.maxEntries}).`);
        }
        if (cdOffset + cdSize > buf.length)
            throw new ToolError(BAD_ZIP);
        let p = cdOffset;
        let declaredTotal = 0;
        for (let i = 0; i < total; i++) {
            if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN)
                throw new ToolError(BAD_ZIP);
            const flags = buf.readUInt16LE(p + 8);
            const method = buf.readUInt16LE(p + 10);
            const compSize = buf.readUInt32LE(p + 20);
            const uncompSize = buf.readUInt32LE(p + 24);
            const nameLen = buf.readUInt16LE(p + 28);
            const extraLen = buf.readUInt16LE(p + 30);
            const commentLen = buf.readUInt16LE(p + 32);
            const localOffset = buf.readUInt32LE(p + 42);
            if (p + 46 + nameLen > buf.length)
                throw new ToolError(BAD_ZIP);
            const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
            p += 46 + nameLen + extraLen + commentLen;
            if (flags & 1)
                throw new ToolError('File có mật khẩu hoặc được mã hóa, không đọc được.');
            if (method !== 0 && method !== 8)
                throw new ToolError('File xlsx dùng kiểu nén không hỗ trợ.');
            if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
                throw new ToolError('File zip64 không được hỗ trợ.');
            }
            if (name.endsWith('/'))
                continue; // thư mục
            if (this.entries.has(name))
                throw new ToolError('File xlsx có thành phần trùng tên, không an toàn để đọc.');
            if (uncompSize > limits.maxEntryBytes) {
                throw new ToolError('File xlsx có thành phần quá lớn sau giải nén.');
            }
            declaredTotal += uncompSize;
            if (declaredTotal > limits.maxTotalBytes) {
                throw new ToolError('File xlsx quá lớn sau giải nén.');
            }
            this.entries.set(name, { name, method, compSize, uncompSize, localOffset });
        }
    }
    findEocd() {
        const { buf } = this;
        if (buf.length < EOCD_MIN)
            throw new ToolError(BAD_ZIP);
        const lowest = Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT);
        for (let i = buf.length - EOCD_MIN; i >= lowest; i--) {
            if (buf.readUInt32LE(i) === SIG_EOCD)
                return i;
        }
        throw new ToolError(BAD_ZIP);
    }
}
//# sourceMappingURL=zip.js.map