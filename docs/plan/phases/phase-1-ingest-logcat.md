# P1 – Ingest logcat (MCP)

> **Lưu trữ.** Thiết kế này đã được thay bằng mốc M1 trong [mvp.md](../mvp.md) (D-056, D-057). Phần parser (mục 4) và quan sát từ file mẫu vẫn dùng được cho M1. Không lưu bản chuẩn hóa, không dùng job.

- **Dựa vào:** [D-001](../decisions.md), [D-002](../decisions.md), [D-006](../decisions.md), [D-007](../decisions.md)
- **Phụ thuộc phase:** [P0](phase-0-foundation.md)
- **Dựa thêm vào:** [D-014](../decisions.md), [D-016](../decisions.md), [D-017](../decisions.md), [D-037](../decisions.md), [D-038](../decisions.md), [D-041](../decisions.md), [D-042](../decisions.md), [D-045](../decisions.md), [D-046](../decisions.md)
- **Thiết kế chi tiết:** [D-032](../decisions.md) (phần dữ liệu), [D-048](../decisions.md) (thiết kế MCP, thay phần giao diện và lệnh CLI cũ)
- **Câu hỏi còn chặn:** chưa có. [Q-027](../open-questions.md) (kích thước và nội dung log thật) còn mở nhưng không chặn. Rule lọc nhiễu để xử lý sau ([D-016](../decisions.md)).

## Mục tiêu

Nhận file logcat xuất từ Android Studio vào session qua MCP, đọc theo từng dòng (không nạp toàn bộ vào RAM), parse thành bản ghi chuẩn gồm thời gian, pid, level, tag, message, lưu cùng bản raw. Cho phép xem một đoạn log theo bộ lọc mà không làm phình context của agent.

## Bước thủ công được thay

Đọc và lọc log bằng mắt.

## Nguyên tắc đã chốt

- Đọc toàn bộ logcat của full luồng app, không phụ thuộc luồng hay màn hình ([D-002](../decisions.md)).
- Phase này chỉ thu thập, chuẩn hóa cơ bản và lưu. Chưa verify điều kiện ([D-006](../decisions.md)).
- Đầu vào là file logcat xuất từ Android Studio. Giữ bản raw, chỉ lọc nhiễu thành bản view riêng ([D-016](../decisions.md), [D-017](../decisions.md)).
- Nhận file qua đường dẫn hoặc thư mục inbox, hạn chế đính kèm vào chat ([D-041](../decisions.md)). Nạp file dài chạy dạng job ([D-042](../decisions.md)).
- Tác vụ nào tool xử lý được thì để tool xử lý, agent chỉ nhận kết quả gọn và điều phối ([D-046](../decisions.md)).

## Quan sát từ file mẫu

Dữ kiện đo từ [log cat mẫu.txt](../../log%20cat%20mẫu.txt), không phải quyết định:

- Mỗi entry bắt đầu bằng: `YYYY-MM-DD HH:MM:SS.mmm  PID-TID  TAG  PACKAGE  LEVEL  message`, các cột cách nhau bằng khoảng trắng.
- Một entry có thể gồm nhiều dòng. Các dòng tiếp theo không có timestamp và thụt lề sâu. Trong mẫu có 317 dòng tiếp theo trên tổng 805 dòng.
- Kích thước mẫu: 805 dòng (488 entry), khoảng 140 KB, kéo dài khoảng 3 phút 15 giây, một package, hai thread.
- Các tag trong mẫu đều có tiền tố `FOR_TESTER_`: CONFIG, LOAD_AD, PRELOAD, SHOW_AD, FO, LOAD_FAILURE, KEY_WORD, InAppAd.
- Ad unit id xuất hiện ở các tag LOAD_AD, SHOW_AD, LOAD_FAILURE, FO, CONFIG, InAppAd.
- Mức log trong mẫu: I, D, W, E (event hiển thị quảng cáo ở tag SHOW_AD dùng mức E).
- Tag CONFIG in ra danh sách key/value Remote Config mà app đang dùng và danh sách ad unit theo nhóm.

## Thiết kế chi tiết

### 1. Tool, resource, prompt (D-048)

| Tool | Việc | Trả về (gọn) |
|---|---|---|
| `ingest_logcat {package_name, session_id, source, wait_seconds?}` | Nạp một file log vào session. `source` là tên file trong inbox hoặc đường dẫn tuyệt đối | Log nhỏ: kết quả luôn. Log lớn: `job_id` |
| `list_logcat {package_name, session_id}` | Các file log đã nạp | Mỗi file một dòng: `logcat_id`, tên gốc, số entry, khoảng thời gian, số cảnh báo |
| `get_logcat_summary {…, logcat_id}` | Thống kê chi tiết một file | Số entry, số dòng không parse được, theo level, 15 tag nhiều nhất, số part, cảnh báo |
| `search_logcat {…, logcat_id, tag?, level_min?, text?, from?, to?, limit?, cursor?}` | Xem một đoạn log theo bộ lọc | Tối đa 30 entry mỗi lần, mỗi entry cắt khoảng 300 ký tự, entry nhiều dòng chỉ hiện dòng đầu kèm "+N dòng", có `next_cursor` |

- **Resource:** `index` của từng file log, để đọc lại thống kê mà không chạy lại tool.
- **Prompt `ingest-logcat`:** liệt kê inbox, chọn file, nạp, đọc tóm tắt, báo cảnh báo.
- Theo dõi và hủy job dùng lại `get_job_status` và `cancel_job` của P0.
- `search_logcat` có mặt ở P1 để agent không phải mở thẳng các file part khi cần tìm một đoạn log ([D-046](../decisions.md)). Việc đối chiếu và kiểm tra thật sự (ad id, thứ tự) để các phase sau.

### 2. Luồng nạp

1. Tester thả file vào inbox (hoặc đưa đường dẫn) và nói muốn nạp log vào session. Agent chỉ gọi tool, không đọc file.
2. Tool kiểm tra trước: tên file trong inbox chỉ là tên thuần (không có dấu phân cách đường dẫn); đường dẫn tuyệt đối phải là file thường; nhìn qua vài chục dòng đầu phải giống định dạng logcat Android Studio, nếu không trả `Lỗi:` mà không in nội dung file.
3. **Package khác workspace:** so package chiếm nhiều nhất trong log với package của workspace. Nếu khác, tool không báo lỗi mà trả `needs_confirmation` kèm package tìm thấy. Agent hỏi tester, rồi gọi lại với cờ xác nhận. Cách này không phụ thuộc việc agent app có hỗ trợ elicitation ([Q-031](../open-questions.md)).
4. **Trùng file:** tính sha256 theo luồng. Nếu session đã có file cùng hash thì trả lại bản đã nạp, không nạp lại.
5. **Nạp an toàn:** ghi vào thư mục `.partial` rồi đổi tên khi xong. Lỗi hoặc hủy thì dọn sạch. Bước copy raw kiểm hash để bảo đảm giống bản gốc từng byte.
6. Chạy bằng job tách rời ([D-047](../decisions.md)). Tiến độ tính theo số byte đã đọc.

### 3. Cấu trúc lưu trữ

Mỗi file log nằm trong một thư mục riêng, đánh số theo thứ tự nạp. Cho phép nhiều file log trong một session.

```
logcat/
  001_<tên-file>/
    raw/source<đuôi>             # giữ nguyên nội dung, tên gốc ghi trong index.md
    normalized/index.md, part-001.md, part-002.md ...
    view/                        # chừa sẵn, rule lọc làm sau (D-016)
```

### 4. Parser

- Đọc từng dòng, nhận entry theo định dạng `ngày giờ  PID-TID  TAG  PACKAGE  LEVEL  message`.
- Dòng không có timestamp và thụt lề sâu được gộp vào entry trước.
- Dòng không khớp định dạng và không có entry trước thì không bỏ: giữ trong mục "không parse được" và đếm trong thống kê.
- Xử lý BOM, xuống dòng CRLF và UTF-16. Nếu mã hóa không hỗ trợ thì trả `Lỗi:` rõ ràng.

### 5. Bản chuẩn hóa (normalized)

- Lossless: mọi entry đều có mặt, chưa lọc gì.
- Mỗi `part-N.md` có front-matter (package, khoảng thời gian, số entry). Phần thân là khối code gồm các dòng gọn: `timestamp LEVEL TAG[pid-tid] message`, message nhiều dòng giữ nguyên thụt lề.
- Chia part theo số entry, **mặc định 5.000** (thay 20.000 của [D-032](../decisions.md)), cấu hình được. File hướng dẫn agent ghi rõ không đọc part trực tiếp mà dùng `search_logcat`.
- `index.md` liệt kê các part và khoảng thời gian, kèm thống kê cơ bản: số entry, số dòng không parse được, khoảng thời gian, số lượng theo tag và theo level, tên file gốc.

### 6. Kết quả trả về

Một lần nạp xong trả khoảng 10 trường: `logcat_id`, tên gốc, package, số entry, số dòng không parse được, thời gian bắt đầu và kết thúc, số part, tối đa 5 cảnh báo, và `next` gợi ý (`get_logcat_summary`, `search_logcat`). Không có nội dung log. Mặc định nhỏ hơn khoảng 2 KB ([D-047](../decisions.md)).

### 7. Việc P1 không làm

- Chưa tạo bản view lọc nhiễu (rule làm sau, [D-016](../decisions.md)).
- Chưa rút ad unit id hay verify điều kiện ([D-006](../decisions.md)).

### 8. Tiêu chí hoàn thành

- File mẫu 805 dòng nạp qua inbox bằng MCP và qua `client.mjs`: đúng 488 entry, 0 dòng không parse được, raw khớp hash.
- File lớn giả lập (vài trăm MB) nạp bằng job, RAM không tăng theo kích thước file, có tiến độ, hủy được, dọn sạch phần dở.
- Nạp lại cùng file trả bản cũ. Package khác workspace trả `needs_confirmation`, gọi lại với cờ xác nhận thì nạp được.
- Từ chối file không giống logcat mà không lộ nội dung.
- `search_logcat`: lọc đúng theo tag, level, text, khoảng thời gian; chặn ở 30 entry mỗi lần; cắt entry dài; phân trang đúng.
- Kích thước kết quả các tool P1 nằm trong ngưỡng, có test.
- Có unit test cho parser. Fixture của test dùng dữ liệu giả hoặc đã ẩn danh, không dùng nguyên file mẫu thật.
