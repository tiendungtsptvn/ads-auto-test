# Kế hoạch tự động hóa test ads Android

Bộ tài liệu này là nguồn sự thật duy nhất của kế hoạch. Cập nhật dần qua các buổi thảo luận.

## Hướng đi hiện tại

**MVP "verify trước"** ([D-051](decisions.md)): một MCP server local gồm 5 tool cùng một skill. Tester chỉ ra file logcat và file kịch bản ads, nhận lại report đối chiếu từng ad, rồi có thể so Remote Config trong app với console. Thiết kế ở [mvp.md](mvp.md).

| Mốc | Việc | Bước thủ công được thay |
|---|---|---|
| M1 | `parse_logcat`, `search_logcat` | Đọc log bằng mắt |
| M2 | `read_ad_script` | Lọc danh sách ad từ file kịch bản |
| M3 | `verify_ads` và report | Đối chiếu log với kịch bản |
| M4 | `map_remote_keys`, console cho `verify_ads` ([m4.md](m4.md)) | Mở console xem key bật/tắt của từng ad |

Rule đối chiếu của M3 đã chốt hết (D-063 đến D-077, bổ sung D-083 đến D-091). M4 đã chốt hướng ở D-092 đến D-105, kế hoạch ở [m4.md](m4.md). Thứ tự thực hiện M1 → M2 → M3 → M4, đóng gói MCPB sau M3 ([D-078](decisions.md)). Lộ trình chi tiết và ghi chú cho session triển khai ở mục "Lộ trình thực hiện" của [mvp.md](mvp.md).

## Quyết định đang hiệu lực (tóm tắt)

Định nghĩa đầy đủ ở [decisions.md](decisions.md). Bảng này chỉ để tra nhanh, nếu lệch thì `decisions.md` là chuẩn.

| Nhóm | Quyết định |
|---|---|
| Phạm vi MVP | D-051 (các mốc), D-052 (RC app lấy từ log), D-061 (so RC console với app), D-097 (console là chuẩn, log là đối tượng được test), D-059 (đề bài là file kịch bản), D-002 (đọc full log), D-017 và D-060 (log xuất từ Android Studio, đã lọc `FOR_TESTER_`), D-019 (chỉ Remote Config) |
| Kiến trúc | D-038 (MCP trong agent app là cửa vào chính), D-045 (TypeScript), D-054 (không workspace, đọc file tại chỗ), D-055 (không job), D-056 (chỉ ghi `report.md`), D-057 (4 tool cùng skill), D-058 (`cli.js` dự phòng), D-043 (bám spec MCP), D-079 (hỗ trợ song song MCP 2026-07-28 và handshake cũ), D-080 (skill gọi `cli.js` qua Bash khi host chặn MCP, mọi tool MCP mới cũng phải gọi được qua `cli.js`), D-081 (đọc Excel bằng ExcelJS kèm bước kiểm tra zip), D-082 (`cli.js` là MCP client thật như `test-client.mjs` của grooming-mcp), D-046 (tool làm việc xác định, agent chỉ điều phối) |
| Rule đối chiếu | D-063 (HF trước, fail thì không show, load một lần trước show), D-064 (nhận diện HF, một ID nhiều resource), D-065 (vắng mặt là FAIL kèm vị trí), D-066 (key ad in-app lấy từ console theo `Tester_<version>`), D-067 (5 loại ad), D-068 (sub, preload, reload để sau), D-069 (ghép cặp HF theo resource bỏ `_hf`), D-070 (rule MIX), D-071 (tester chọn sheet, kiểm mọi phase trong sheet), D-072 (ad in-app dùng Ads name thay resource và key), D-073 (key `false` thì không request), D-074 (ghép cặp bỏ thêm `_2`), D-075 (case đặc biệt không theo rule HF, luôn CẦN XEM kèm chi tiết), D-076 (file nghiệm thu là đầu vào tùy chọn), D-077 (danh sách case đặc biệt trong file dữ liệu), D-083 (dòng không ghi key thì tra file nghiệm thu), D-084 (dòng `Note:` kiểm bình thường), D-085 (rule HF khi một key bật; key `false` thì không load, không show), D-086 (request chỉ tính từ `starting load`, dòng lẻ thì cảnh báo), D-087 (hạn chế đã biết, vẫn ghi FAIL), D-088 và D-090 (một ad có thể có nhiều key theo vị trí hiển thị, nhiều ad có thể chung một ID, một ad không có nhiều ID), D-089 (cách đọc file nghiệm thu để lấy key), D-091 (app khởi động lại không phải ranh giới của rule load một lần) |
| An toàn | D-004 (không sửa Remote Config), D-053 (M1 đến M3 không có credential), D-093 (M4: đọc bằng `firebase-tools`, tester tự `firebase login`, không có lệnh ghi), D-037 (logic trong core, ghi nguyên tử, không trả credential) |
| Người dùng và phân phối | D-008 (macOS và Windows, tester không viết script), D-011 (mốc nhỏ, dùng được ngay), D-062 (clone, copy folder hoặc gói MCPB, chỉ chạy local), D-078 (thứ tự mốc), D-024 và D-027 (GitHub, repo cá nhân, dữ liệu ngoài repo), D-029 (thông báo tiếng Việt), D-030 (hỏi trước khi cài), D-040 (desktop app hoãn) |
| Hoãn sang sau MVP | D-005, D-021, D-022, D-035 (Confluence, checklist, nghiệm thu lib) |

## Quy tắc ghi chép

1. **Chỉ ghi ý đã chốt.** Ý đang thảo luận nằm ở [open-questions.md](open-questions.md), không đưa vào các file khác.
2. Khi một câu hỏi được chốt: ghi vào [decisions.md](decisions.md) với ID `D-xxx`, chuyển câu hỏi tương ứng sang trạng thái `Đã chốt` kèm link tới `D-xxx`.
3. Các file khác chỉ tham chiếu quyết định bằng ID, ví dụ `(theo D-003)`, không chép lại nội dung. Muốn sửa thì sửa ở `decisions.md`.
4. Nếu một quyết định bị đổi: không xóa, ghi trạng thái `Thay thế bởi`, `Điều chỉnh bởi` hoặc `Hoãn bởi D-yyy` rồi thêm dòng mới. Cập nhật luôn bảng tóm tắt ở trên.

## Bản đồ file

| File | Nội dung | Trạng thái |
|---|---|---|
| [README.md](README.md) | Hướng đi, tóm tắt quyết định, quy tắc | Đang dùng |
| [00-context.md](00-context.md) | Bối cảnh, công việc hàng ngày, ràng buộc (do user cung cấp) | Đã chốt |
| [mvp.md](mvp.md) | Thiết kế MVP: tool, rule đối chiếu, skill, tiêu chí hoàn thành, việc sau MVP | Đang dùng |
| [decisions.md](decisions.md) | Nhật ký quyết định (`D-001` đến `D-105`) | Đang cập nhật |
| [open-questions.md](open-questions.md) | Câu hỏi đang thảo luận (`Q-xxx`) | Đang mở |
| [phases/](phases/) | Thiết kế P0 đến P3 cũ | **Lưu trữ**, đã thay bằng [mvp.md](mvp.md). Phần dùng lại sau MVP được ghi ở mục "Sau MVP" của mvp.md |

## Cơ chế liên kết

- Quyết định: `D-xxx`, định nghĩa duy nhất trong `decisions.md`.
- Câu hỏi: `Q-xxx`, định nghĩa duy nhất trong `open-questions.md`.
- Mốc MVP: `M<N>`, định nghĩa trong `mvp.md`. Phase cũ `P<N>` chỉ còn trong `phases/` (lưu trữ).
- Link giữa file dùng đường dẫn tương đối.
