/**
 * Che giá trị trông giống secret trước khi đưa nội dung log ra ngoài.
 * Log mẫu có dòng như "Adjust config token: ...", không được chuyển nguyên văn cho agent.
 * Chỉ khớp theo từ nguyên (token, pin, ...) để không che nhầm key như `fo_mapping_x`.
 */
const SECRET_WORDS = new Set(['token', 'secret', 'password', 'passwd', 'otp', 'pin']);
const SECRET_COMPOUND = /api[_-]?key|private[_-]?key/i;
/** Key (tên biến Remote Config) có chứa từ khóa secret không. */
export function isSecretKey(key) {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    if (SECRET_COMPOUND.test(spaced))
        return true;
    return spaced
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((part) => SECRET_WORDS.has(part));
}
const WORD = '(?:token|secret|password|passwd|otp|pin|api[_-]?key|private[_-]?key)';
const INLINE_SECRET = new RegExp(`(?<![A-Za-z0-9])((?:[A-Za-z0-9]+[_.-])*${WORD}(?:[_.-][A-Za-z0-9]+)*)(\\s*[:=]\\s*)(\\S+)`, 'gi');
/** Thay giá trị đi sau `<key>: ` hoặc `<key>=` của key kiểu secret bằng `***`. */
export function maskSecrets(text) {
    return text.replace(INLINE_SECRET, (_m, key, sep) => `${key}${sep}***`);
}
//# sourceMappingURL=mask.js.map