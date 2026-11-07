/** Key (tên biến Remote Config) có chứa từ khóa secret không. */
export declare function isSecretKey(key: string): boolean;
/** Thay giá trị đi sau `<key>: ` hoặc `<key>=` của key kiểu secret bằng `***`. */
export declare function maskSecrets(text: string): string;
