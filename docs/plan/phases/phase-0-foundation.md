# P0 – Nền tảng (MCP, TypeScript)

> **Lưu trữ.** Thiết kế này đã được thay bằng [mvp.md](../mvp.md) (D-053, D-054, D-055, D-057, D-058). Không còn workspace, session, inbox, job hay credential trong MVP. Giữ lại để tham khảo.

- **Dựa vào:** [D-006](../decisions.md), [D-007](../decisions.md), [D-008](../decisions.md), [D-009](../decisions.md), [D-010](../decisions.md), [D-011](../decisions.md)
- **Dựa thêm vào:** [D-013](../decisions.md), [D-014](../decisions.md), [D-018](../decisions.md), [D-020](../decisions.md), [D-024](../decisions.md), [D-026](../decisions.md), [D-027](../decisions.md), [D-031](../decisions.md)
- **Hướng MCP và TypeScript:** [D-037](../decisions.md), [D-038](../decisions.md), [D-039](../decisions.md), [D-040](../decisions.md), [D-041](../decisions.md), [D-042](../decisions.md), [D-043](../decisions.md), [D-044](../decisions.md), [D-045](../decisions.md), [D-046](../decisions.md)
- **Thiết kế chi tiết:** [D-028](../decisions.md) (mục 1 và 2 cũ), [D-047](../decisions.md) (thiết kế MCP, thay các mục 3 đến 6 cũ)
- **Câu hỏi còn mở, kiểm chứng ở bước đầu của phase:** [Q-031](../open-questions.md) (phiên bản MCP, cách đăng ký MCP của Claude và Codex), [Q-032](../open-questions.md) (keychain đa nền tảng cho Node), [Q-033](../open-questions.md) (cách hướng dẫn cài Node)

## Mục tiêu

Dựng nền tảng nhỏ để P1 đến P3 cắm vào: MCP server khung, quản lý workspace và session, cấu hình, cơ chế job, credential, client CLI dự phòng và skill cho agent. Tester làm được trong chat: kiểm tra môi trường, chọn thư mục dữ liệu, tạo workspace và session, thấy cấu trúc thư mục. P0 chưa nạp dữ liệu nào.

## Bước thủ công được thay

Chưa thay bước nào trực tiếp. Các phase P1 đến P3 dùng chung phần này.

## Ràng buộc đã biết

- Credential Firebase và Confluence được cung cấp bởi user, sản phẩm chỉ chạy trên máy cá nhân ([D-003](../decisions.md)). Credential lưu trong OS keychain, không nằm trong file nào, thiếu thì báo lỗi ngay thay vì dùng giá trị mặc định ([D-013](../decisions.md)).
- Chạy trên cả macOS và Windows, tester không phải viết hay chạy script ([D-008](../decisions.md)).
- Dữ liệu chuẩn hóa là Markdown kèm YAML front-matter, file raw giữ nguyên ([D-009](../decisions.md), [D-014](../decisions.md)).
- Các nguồn của một lần test gắn nhau bằng package name, có thể thêm timestamp và version ([D-010](../decisions.md)).
- Phase phải nhỏ, ra sản phẩm dùng được nhanh ([D-011](../decisions.md)).
- Phân phối qua GitHub: tester clone về, cài môi trường, chạy local, không dùng file cài đặt đã ký ([D-024](../decisions.md)).
- Dữ liệu workspace lưu ngoài repo, người dùng chọn thư mục lưu trữ, người dùng cuối không push được lên repo ([D-027](../decisions.md)).
- Khi tạo workspace, tester nhập Firebase project id để gắn với package name ([D-026](../decisions.md)). Workspace định danh bằng package name ([D-020](../decisions.md)), mỗi workspace có nhiều session ([D-018](../decisions.md)). Một package name gắn với một Firebase project, sửa được sau ([D-031](../decisions.md)).
- Cửa vào chính là MCP server chạy trong chat của agent app (Claude, Codex), có đường dự phòng bằng CLI client và skill; desktop app hoãn ([D-038](../decisions.md), [D-039](../decisions.md), [D-040](../decisions.md)).
- Nhận file qua đường dẫn hoặc thư mục inbox, hạn chế đính kèm vào chat ([D-041](../decisions.md)). Nạp file dài chạy dạng job ([D-042](../decisions.md)).
- Thiết kế theo concept chuẩn MCP và tham khảo `grooming-mcp` ([D-043](../decisions.md)). Ngôn ngữ TypeScript, tái dùng khuôn của `grooming-mcp` ([D-045](../decisions.md)).
- Tác vụ nào tool xử lý được thì để tool xử lý, agent chỉ nhận kết quả và điều phối ([D-046](../decisions.md)).

## Thiết kế chi tiết

### 1. Cấu trúc thư mục dữ liệu (D-028)

Nằm ngoài repo, trong thư mục do người dùng chọn. Có thêm `inbox/` và file hướng dẫn agent ([D-041](../decisions.md), [D-037](../decisions.md)).

```
<thư mục dữ liệu>/
  inbox/                              # tester thả file vào đây
  README-for-agents.md                # tự sinh, mô tả cấu trúc và cách đọc
  workspaces/
    <package-name>/                   # workspace = package name
      workspace.md                    # front-matter: package, firebase_project_id, ngày tạo
      sessions/
        <YYYYMMDD-HHMMSS>_<version>/  # timestamp + version
          session.md                  # front-matter: package, version, timestamp, ghi chú
          logcat/  remote-config/  brief/   # các phase sau tạo thư mục con khi cần
```

- Không dùng database. Server liệt kê workspace và session bằng cách quét thư mục và đọc front-matter.
- Version của app nhập tay khi tạo session và là tùy chọn. Nếu không nhập thì phần `_<version>` trong tên thư mục được bỏ.
- Inbox nằm ở gốc thư mục dữ liệu. Khi nạp, file được **copy** vào session, không xóa file ở inbox.
- Tên thư mục chỉ lấy từ giá trị đã validate (định dạng package name Android, định dạng Firebase project id, ký tự của version). Đường dẫn cuối cùng phải được kiểm tra nằm trong thư mục dữ liệu.

### 2. Cấu hình, trạng thái và key

- Cấu hình (đường dẫn thư mục dữ liệu, ...) và trạng thái job lưu ở thư mục chuẩn của từng hệ điều hành, ngoài repo: macOS `~/Library/Application Support`, Windows `%LOCALAPPDATA%`. Ghi nguyên tử (ghi tạm rồi đổi tên), quyền 0600, có `expiresAt` và dọn dẹp tự động, theo mẫu `durable-workflow-state` của `grooming-mcp` (bản đó mới có macOS và Linux, cần thêm Windows).
- Key chỉ nằm trong keychain của hệ điều hành. **Launcher không đọc secret**, server đọc keychain qua một module riêng. Cách truy cập keychain bằng TypeScript trên cả hai hệ điều hành cần kiểm chứng ở bước đầu phase ([Q-032](../open-questions.md)).
- Token được lưu bằng lệnh `auth set <service>` của client CLI: nhập ẩn trong terminal, ngoài chat, rồi lưu keychain. Đăng nhập Google qua trình duyệt ở P2 ([D-044](../decisions.md)).

### 3. Tool, resource, prompt

| Tool | Việc | Trả về |
|---|---|---|
| `get_environment_status` | Kiểm tra Node, thư mục dữ liệu, quyền ghi, keychain, version | Danh sách đạt/không đạt kèm gợi ý sửa ngắn |
| `set_data_folder {path}` | Đặt thư mục dữ liệu, tạo `inbox/` và file hướng dẫn agent | Đường dẫn đã chuẩn hóa |
| `create_workspace {package_name, firebase_project_id}` | Validate, tạo `workspace.md` | Thông tin workspace (idempotent nếu đã tồn tại) |
| `update_workspace {package_name, firebase_project_id}` | Sửa Firebase project id | Thông tin sau khi sửa |
| `list_workspaces {cursor?}` | Liệt kê | Tối đa 20 dòng: package, project, số session |
| `create_session {package_name, version?, note?}` | Tạo session | `session_id` và đường dẫn |
| `list_sessions {package_name, cursor?}` | Liệt kê | Tối đa 20 dòng |
| `get_session {package_name, session_id}` | Tóm tắt nguồn dữ liệu đã có | Số lượng log, snapshot, đề bài (ở P0 là trống) |
| `list_inbox` | Liệt kê file trong inbox | Tên, kích thước, ngày sửa |
| `get_job_status {job_id}` | Trạng thái job | Trạng thái, tiến độ, tóm tắt kết quả |
| `cancel_job {job_id}` | Hủy job | Trạng thái sau khi hủy |
| `get_auth_status {service}` | Credential đã có hay chưa | Có hoặc không, **không bao giờ trả giá trị** |

- **Resource:** `guide` (hướng dẫn cho agent) và tóm tắt session, để agent đọc khi cần thay vì mọi tool đều trả dài.
- **Prompt:** `start-test-session` (kiểm tra môi trường, chọn hoặc tạo workspace, tạo session, nhắc thả file vào inbox). Các prompt khác do P1 đến P3 thêm.

### 4. Quy ước kết quả và lỗi

- Kết quả là văn bản chứa JSON gọn: 1 đến 3 dòng tóm tắt, danh sách giới hạn 20 dòng kèm `next_cursor`, không chứa nội dung file, có trường `next` gợi ý tool nên gọi tiếp ([D-046](../decisions.md)). Mặc định mỗi kết quả nhỏ hơn khoảng 2 KB.
- Lỗi nghiệp vụ: `isError: true`, nội dung bắt đầu bằng `Lỗi:` bằng tiếng Việt, kèm mã lỗi và gợi ý sửa ngắn (như `grooming-mcp`).
- Validate ở phía `core`: định dạng package name và Firebase project id, ký tự của version và note, đường dẫn phải nằm dưới thư mục dữ liệu sau khi chuẩn hóa. Không ghi secret vào log hay kết quả. Log ra `stderr`, không ra stdout.

### 5. Job ([D-042](../decisions.md))

- Ở đường dự phòng bằng CLI, mỗi lệnh `call` khởi chạy một server rồi thoát, nên job chạy nền trong tiến trình server sẽ chết theo. Vì vậy job chạy bằng **tiến trình con tách rời**, ghi trạng thái ra file; `get_job_status` đọc file này ở lần gọi sau, trong cả hai đường gọi.
- Tool khởi chạy job nhận tham số `wait_seconds`: job ngắn xong trong thời gian chờ thì trả kết quả luôn, job dài mới trả `job_id`. Cách này giảm số vòng gọi và token.
- P0 có một job thử `selftest` để kiểm tra cơ chế.

### 6. Cấu trúc repo (theo khuôn `grooming-mcp`)

```
package.json, tsconfig.json, README.md, dist/ (commit sẵn)
run-mcp.sh (macOS), run-mcp.cmd (Windows)
client.mjs            # MCP client CLI: tools/list, call, session, prompts, resources, doctor, setup, auth
src/
  index.ts            # server: tools, prompts, resources
  core/               # lưu trữ, workspace, session, config, job, secrets, validation (không import MCP)
  tools/  prompts/  resources/
skills/               # SKILL.md cho Claude, đoạn AGENTS.md cho Codex
tests/                # node --test
```

`core/` không phụ thuộc MCP để server và CLI dùng chung một bản logic ([D-037](../decisions.md), [D-039](../decisions.md)).

### 7. Launcher, client CLI và cài đặt

- `run-mcp.sh` và `run-mcp.cmd`: tìm Node, nếu thiếu thì in hướng dẫn và dừng, không cài ngầm ([D-030](../decisions.md), điều chỉnh bởi [D-045](../decisions.md)). Launcher không đọc secret.
- `client.mjs` dựa trên `test-client.mjs`, thêm: `doctor`, `setup claude|codex` (in hoặc ghi cấu hình đăng ký MCP, cú pháp cần kiểm chứng ở [Q-031](../open-questions.md)), `auth set <service>`.
- Các bước của tester: cài Node, `git clone`, `npm install`, chạy `setup`, mở agent app. Không cần build vì `dist/` commit sẵn.

### 8. Skill và hướng dẫn cho agent ([D-039](../decisions.md))

- `skills/ads-auto-test/SKILL.md` cho Claude: khi nào kích hoạt, cách gọi tool bằng MCP, cách gọi bằng `node client.mjs call <tool> '<json>'` khi MCP bị chặn, các quy tắc (không dán secret vào chat, không đính kèm file lớn mà dùng inbox, lỗi bắt đầu bằng `Lỗi:`, theo [D-046](../decisions.md)). Có thẻ dán sẵn cho Codex, như `USING-FROM-ANOTHER-SESSION.md` của `grooming-mcp`.
- Skill ghi rõ lệnh nào có thể cần chạy ngoài sandbox hoặc tester tự chạy trong terminal, vì thư mục dữ liệu nằm ngoài thư mục dự án và đăng nhập Google sau này cần trình duyệt hoặc cổng local.

### 9. Tiêu chí hoàn thành

- Máy sạch macOS và Windows chỉ có Node: clone, `npm install`, `doctor` báo đạt.
- `setup` đăng ký được MCP vào Claude và Codex, cả hai thấy tool (kiểm tay).
- Trong chat: tạo workspace và session, thư mục đúng cấu trúc, đóng mở lại vẫn thấy.
- Cùng thao tác đó chạy được qua `client.mjs` và skill khi không đăng ký MCP.
- Job `selftest` khởi chạy bằng CLI, tiến trình thoát, hỏi trạng thái sau vẫn thấy kết quả.
- `auth set` lưu keychain, `get_auth_status` trả có hoặc không. Test chứng minh không có giá trị credential nào xuất hiện trong log, file hay kết quả tool.
- Unit test: validate đầu vào, chống đường dẫn thoát khỏi thư mục dữ liệu, ghi nguyên tử, giới hạn kích thước kết quả.
- Thư mục dữ liệu có `README-for-agents.md`.

### 10. Nguyên tắc cho AI agent (D-037, D-046)

Áp dụng cho P0 đến P3 để P4 trở đi thêm tool mà không phải dựng lại:

1. Logic và validation nằm trong `core`, không nằm riêng trong lớp MCP.
2. Ghi file nguyên tử (ghi tạm rồi đổi tên), vì server, CLI và job có thể cùng chạy.
3. Đường dẫn thư mục dữ liệu lưu ở thư mục cấu hình của hệ điều hành để mọi tiến trình cùng đọc.
4. Tên thư mục và ID ổn định, `index.md` có tóm tắt.
5. Tool MCP không bao giờ trả về credential.
6. Tự sinh file hướng dẫn cho agent ở thư mục dữ liệu.
7. Tác vụ nào tool xử lý được thì để tool xử lý, agent chỉ nhận kết quả và điều phối.

### 11. Việc kiểm chứng ở bước đầu phase (không phải quyết định)

- Phiên bản MCP và SDK mà Claude và Codex hỗ trợ (`grooming-mcp` dùng SDK 1.29.0, chưa biết bản này có hỗ trợ đặc tả 2026-07-28 không), cú pháp đăng ký MCP của hai app ([Q-031](../open-questions.md)).
- Thư viện hoặc lệnh hệ điều hành để đọc và ghi keychain từ Node trên cả macOS và Windows ([Q-032](../open-questions.md)).
- Cách hướng dẫn cài Node trên từng hệ điều hành ([Q-033](../open-questions.md)).
