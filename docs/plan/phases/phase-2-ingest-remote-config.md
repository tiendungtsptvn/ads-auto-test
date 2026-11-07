# P2 – Ingest Remote Config (MCP)

> **Lưu trữ.** Việc đọc Remote Config từ Firebase nay là mốc M4 trong [mvp.md](../mvp.md) (D-061), dùng để so với giá trị app lấy từ log. Mục 3 (thử nghiệm A/B), 5 (chỉ-đọc do code bảo đảm) và 6 (lỗi và thử lại) được dùng lại. Không lưu snapshot (D-056).

- **Dựa vào:** [D-001](../decisions.md), [D-003](../decisions.md), [D-004](../decisions.md), [D-006](../decisions.md), [D-007](../decisions.md)
- **Phụ thuộc phase:** [P0](phase-0-foundation.md)
- **Dựa thêm vào:** [D-013](../decisions.md), [D-014](../decisions.md), [D-018](../decisions.md), [D-019](../decisions.md), [D-023](../decisions.md), [D-026](../decisions.md), [D-037](../decisions.md), [D-038](../decisions.md), [D-044](../decisions.md), [D-045](../decisions.md), [D-046](../decisions.md)
- **Thiết kế chi tiết:** [D-033](../decisions.md) (phần dữ liệu và thử nghiệm A/B), [D-049](../decisions.md) (thiết kế MCP, thay phần giao diện cũ)
- **Câu hỏi còn chặn:** [Q-023](../open-questions.md) (chọn A hoặc B, giải quyết bằng bước thử nghiệm đầu phase). [Q-028](../open-questions.md) (số key lớn nhất) còn mở nhưng không chặn.

## Mục tiêu

Lấy key/value Remote Config của Firebase project gắn với workspace qua MCP, chỉ đọc, lưu snapshot kèm project, thời điểm và version. Cho phép xem giá trị của một số key mà không làm phình context của agent.

## Bước thủ công được thay

Mở console từng project để xem key.

## Nguyên tắc đã chốt

- Lượng key lớn, nhiều project ([D-003](../decisions.md)).
- Chỉ đọc. Việc sửa key để phase sau và phải theo rule nghiêm ngặt ([D-004](../decisions.md)).
- Đọc theo từng project khi được yêu cầu, không đọc tất cả project cùng lúc. Lưu vào workspace của project đó, thuộc một session test ([D-018](../decisions.md)).
- Nguồn cấu hình chỉ là Remote Config, không gồm AdMob hay A/B Testing ([D-019](../decisions.md)).
- Credential lấy từ OS keychain ([D-013](../decisions.md)). Snapshot lưu dạng Markdown ([D-014](../decisions.md)).
- Đọc bằng đăng nhập Google của tester, theo hướng A (`firebase-tools`) hoặc B (tự đăng nhập Google và gọi REST API). Chọn một trong hai sau thử nghiệm ([D-023](../decisions.md)). Đăng nhập Google bằng trình duyệt ([D-044](../decisions.md)).
- Tester có vai trò Editor (có quyền ghi), nên việc chỉ đọc ([D-004](../decisions.md)) phải do chính code bảo đảm, không dựa vào quyền của tài khoản.
- Tác vụ nào tool xử lý được thì để tool xử lý, agent chỉ nhận kết quả gọn và điều phối ([D-046](../decisions.md)).

## Dữ kiện đã xác nhận từ tài liệu Firebase

Không phải quyết định, nguồn: [Modify Remote Config programmatically](https://firebase.google.com/docs/remote-config/automate-rc).

- Đọc template bằng `GET https://firebaseremoteconfig.googleapis.com/v1/projects/<project-id>/remoteConfig`. Header trả về có ETag, cần gửi `Accept-Encoding: gzip` thì mới nhận được.
- Chỉ có một scope `https://www.googleapis.com/auth/firebase.remoteconfig`, dùng cho cả đọc và ghi.
- Một template tối đa 2.000 key, lưu 300 phiên bản, mỗi phiên bản tồn tại 90 ngày.
- Trang tài liệu chỉ hướng dẫn xác thực bằng service account. Việc dùng token đăng nhập Google của người dùng (hướng A, B) chưa được tài liệu này xác nhận.
- Chưa có tài liệu nói rõ về gói Spark. Cấu trúc chi tiết của template (conditions, parameters, parameterGroups, kiểu giá trị) cần kiểm chứng ở bước thử nghiệm.

## Thiết kế chi tiết

### 1. Tool, resource, prompt (D-049)

| Tool | Việc | Trả về (gọn) |
|---|---|---|
| `fetch_remote_config {package_name, session_id, force?}` | Lấy template đang chạy của Firebase project gắn với workspace ([D-026](../decisions.md)), lưu snapshot | `snapshot_id`, version, số key, số condition, số nhóm, cảnh báo |
| `list_remote_config_snapshots {package_name, session_id}` | Các snapshot đã lấy | Mỗi snapshot một dòng: id, thời điểm, version, số key |
| `get_remote_config_summary {…, snapshot_id}` | Thống kê một snapshot | Theo kiểu giá trị, số key có giá trị theo condition, danh sách nhóm, danh sách condition (tên) |
| `search_remote_config {…, snapshot_id, keys?, prefix?, text?, limit?, cursor?}` | Xem giá trị của một số key | Tối đa 30 key mỗi lần, mỗi giá trị cắt khoảng 200 ký tự kèm độ dài thật, có `next_cursor`. Hỏi riêng một key thì có tùy chọn lấy đủ giá trị |

- **Resource:** `snapshot.md` của từng snapshot, để người hoặc agent đọc khi cần.
- **Prompt `fetch-remote-config`:** kiểm tra đăng nhập, lấy, đọc tóm tắt, nhắc rằng P2 chưa tính giá trị theo condition.
- `fetch_remote_config` chỉ là một lần GET nên chạy đồng bộ, không dùng job. Template tối đa 2.000 key nên vẫn nhanh.
- `search_remote_config` cùng kiểu với `search_logcat` của P1: agent không phải đọc cả `snapshot.md` khi chỉ cần vài key ([D-046](../decisions.md)).

### 2. Đăng nhập Google ([D-044](../decisions.md))

- Đăng nhập là một lệnh chạy trong terminal của tester: `node client.mjs auth login google`, cùng kiểu với `auth set` của [P0](phase-0-foundation.md). Lý do: đăng nhập cần mở trình duyệt và có thể cần cổng local, mà đường gọi dự phòng qua shell của agent có thể bị sandbox chặn hai việc này.
- Tool MCP chỉ có `get_auth_status {service: "google"}` (tái dùng từ P0) để báo đã đăng nhập hay chưa. Không có tool đăng nhập qua chat ở P2.
- Token luôn lưu keychain ([D-013](../decisions.md)), không bao giờ nằm trong kết quả tool, log hay file.

### 3. Bước thử nghiệm A và B (bước đầu của phase, D-023)

Thử cả hai hướng trên một project thật, bằng tài khoản Editor, gói Spark. Vì server và tester đã có Node ([D-045](../decisions.md)), hướng A không còn nhược điểm "phải cài Node thêm". Tiêu chí so sánh:

- **Cả hai:** đọc được template hay không, có nhận được ETag không (cần `Accept-Encoding: gzip`).
- **A:** `firebase-tools` là gói npm, dùng làm dependency hay chạy qua lệnh. Token do công cụ đó tự lưu, cần xác nhận cách lưu có khớp [D-013](../decisions.md) không.
- **B:** tự gọi REST API với thư viện đăng nhập Google cho Node. Cần một OAuth client của app desktop (id, và secret nếu có); quyết định lưu ở đâu cho đúng quy tắc không đưa secret vào source hay config. Kiểm tra refresh token có hết hạn sau 7 ngày không khi OAuth client nằm trong một project Google Cloud ở chế độ "Testing".

Code dùng chung một giao diện `RemoteConfigReader` với hai bản cài đặt. Kết quả thử nghiệm được ghi thành quyết định mới trong [decisions.md](../decisions.md). Thử nghiệm chưa phải sản phẩm.

### 4. Lưu snapshot (D-033)

Mỗi lần lấy tạo một thư mục trong session:

```
remote-config/
  001_<timestamp>/
    raw/template.json     # response nguyên bản
    snapshot.md           # bản chuẩn hóa
```

- Cho phép nhiều snapshot trong một session. Các phase sau dùng bản mới nhất.
- `snapshot.md` có front-matter: project id, package, thời điểm lấy, `versionNumber`, `updateTime`, `updateOrigin`, ETag, số key. Không lưu email người cập nhật.
- Phần thân gồm: bảng tham số (key, kiểu, giá trị mặc định, giá trị theo condition), danh sách condition kèm biểu thức, nhóm tham số. Giá trị dài đưa xuống phụ lục để bảng vẫn đọc được.
- P2 chỉ liệt kê condition, không tính giá trị hiệu lực của từng condition. Chỉ lấy template đang chạy, lịch sử phiên bản và so sánh để các phase sau.
- **Trùng:** nếu version và nội dung (hash) của template trùng snapshot mới nhất thì trả lại snapshot cũ với `unchanged: true`. Tham số `force` để tạo bản mới. Cùng nguyên tắc với P1.
- Ghi vào `.partial` rồi đổi tên khi xong, lỗi thì dọn sạch.

### 5. Chỉ đọc do code bảo đảm ([D-004](../decisions.md))

- Client HTTP chỉ có GET tới đúng một endpoint, không có code PUT hay POST. Với hướng A thì chỉ gọi lệnh lấy template với tham số cố định.
- `firebase_project_id` được validate theo định dạng trước khi dùng và truyền bằng mảng tham số, không ghép vào chuỗi lệnh.
- Có test chứng minh không có đường ghi.

### 6. Lỗi và thử lại

- 401 hoặc 403: "chưa đăng nhập hoặc không đủ quyền", kèm hướng dẫn chạy lệnh đăng nhập. Có thể nghĩa là chưa bật API cho project.
- 404: project id sai, gợi ý dùng `update_workspace` của P0.
- Mất mạng hoặc cần VPN: báo rõ.
- 429 và 5xx: tự thử lại tối đa 3 lần với thời gian chờ tăng dần.
- Thông báo bằng tiếng Việt, bắt đầu bằng `Lỗi:`. Token không xuất hiện trong lỗi, và lỗi không kèm stack trace, hostname hay đường dẫn.

### 7. Tiêu chí hoàn thành

Trên một project Spark thật, tài khoản Editor:

- Lấy snapshot thành công trên cả macOS và Windows, qua MCP và qua `client.mjs`.
- Số key trong snapshot khớp số key trên console (so sánh tay một project).
- `raw/template.json` lưu đủ. Không có token trong file, log, kết quả tool hay lỗi (có test).
- Test tự động chứng minh không có đường ghi.
- Lỗi đăng nhập hết hạn, thiếu quyền, project id sai đều báo dễ hiểu (có test với HTTP giả).
- `search_remote_config` chặn đúng ở 30 key, cắt giá trị dài, phân trang đúng. Kích thước kết quả các tool nằm trong ngưỡng.
- Fixture: template giả gồm không có condition, có condition, có nhóm, đủ các kiểu giá trị, template rỗng.
