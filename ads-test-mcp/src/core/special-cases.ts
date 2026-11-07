import data from '../data/special-cases.json' with { type: 'json' };

/** Case đặc biệt khai báo trong `src/data/special-cases.json` (D-077). */
export interface SpecialCase {
  name: string;
  identifiers: string[];
  acceptanceSection: string | null;
  /** Key bật/tắt ad của case khi kịch bản không ghi key (ví dụ MIX tắt bằng `fo_inter_splash`, D-070). */
  enableKeys?: string[];
  /** Key liên quan, chỉ để hiển thị giá trị trong log. */
  relatedKeys?: string[];
}

export interface SpecialMatch {
  name: string;
  /** Identifier trong file dữ liệu đã khớp. */
  matchedBy: string;
  acceptanceSection: string | null;
  /** Toàn bộ identifier của case (tên key không có dấu `*` được dùng để hiển thị giá trị trong log). */
  identifiers: string[];
  enableKeys: string[];
  relatedKeys: string[];
}

export const SPECIAL_CASES: readonly SpecialCase[] = (data as { cases: SpecialCase[] }).cases;

function identifierMatches(identifier: string, candidate: string): boolean {
  const id = identifier.toLowerCase();
  const c = candidate.toLowerCase();
  return id.endsWith('*') ? c.startsWith(id.slice(0, -1)) : c === id;
}

/**
 * Tìm case đặc biệt của một ad theo các tên nhận diện (resource name, enable key, Ads name).
 * Trả về case đầu tiên khớp theo thứ tự trong file dữ liệu.
 */
export function matchSpecialCase(
  names: readonly string[],
  cases: readonly SpecialCase[] = SPECIAL_CASES,
): SpecialMatch | undefined {
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
