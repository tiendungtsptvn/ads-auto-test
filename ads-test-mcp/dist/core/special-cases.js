import data from '../data/special-cases.json' with { type: 'json' };
export const SPECIAL_CASES = data.cases;
function identifierMatches(identifier, candidate) {
    const id = identifier.toLowerCase();
    const c = candidate.toLowerCase();
    return id.endsWith('*') ? c.startsWith(id.slice(0, -1)) : c === id;
}
/**
 * Tìm case đặc biệt của một ad theo các tên nhận diện (resource name, enable key, Ads name).
 * Trả về case đầu tiên khớp theo thứ tự trong file dữ liệu.
 */
export function matchSpecialCase(names, cases = SPECIAL_CASES) {
    for (const sc of cases) {
        for (const identifier of sc.identifiers) {
            if (names.some((n) => n !== '' && identifierMatches(identifier, n))) {
                return {
                    name: sc.name,
                    matchedBy: identifier,
                    acceptanceSection: sc.acceptanceSection,
                    identifiers: [...sc.identifiers],
                    enableKeys: [...(sc.enableKeys ?? [])],
                    relatedKeys: [...(sc.relatedKeys ?? [])],
                };
            }
        }
    }
    return undefined;
}
//# sourceMappingURL=special-cases.js.map