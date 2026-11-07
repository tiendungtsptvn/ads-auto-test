# P3 – Ingest đề bài, file Excel (MCP)

> **Lưu trữ.** MVP chỉ đọc file kịch bản ads (mốc M2 trong [mvp.md](../mvp.md), D-059). Phần quan sát 3 file mẫu, kiểm tra file Excel (mục 2) và thư viện Excel (mục 6) vẫn dùng được. Checklist và nghiệm thu lib để sau MVP.

- **Dựa vào:** [D-001](../decisions.md), [D-006](../decisions.md), [D-007](../decisions.md), [D-034](../decisions.md)
- **Phụ thuộc phase:** [P0](phase-0-foundation.md)
- **Dựa thêm vào:** [D-014](../decisions.md), [D-036](../decisions.md), [D-037](../decisions.md), [D-038](../decisions.md), [D-041](../decisions.md), [D-045](../decisions.md), [D-046](../decisions.md)
- **Thiết kế chi tiết:** [D-035](../decisions.md) (phần dữ liệu), [D-050](../decisions.md) (thiết kế MCP, thay phần giao diện và lệnh CLI cũ)
- **Câu hỏi còn mở, kiểm chứng ở bước đầu của phase:** [Q-034](../open-questions.md) (thư viện đọc Excel)

## Mục tiêu

Nhận file Excel đề bài vào session qua MCP, chuẩn hóa cơ bản và lưu lại. Một phase test thường nhận bộ 3 file: checklist, kịch bản ads, nghiệm thu tích hợp lib ([D-034](../decisions.md)). Cho phép xem một đoạn của một sheet mà không làm phình context của agent.

## Bước thủ công được thay

Mở và đọc đề bài thủ công từ các file Excel.

## Nguyên tắc đã chốt

- Phase này chỉ nhận file Excel. Việc đọc link Confluence và các định dạng file khác chưa làm ở P3 ([D-034](../decisions.md)).
- Phase này chỉ thu thập và chuẩn hóa. Chưa rút điều kiện verify từ đề bài ([D-006](../decisions.md), [D-007](../decisions.md)).
- Dữ liệu chuẩn hóa là Markdown, file gốc giữ nguyên ([D-014](../decisions.md)).
- Nhận file qua đường dẫn hoặc thư mục inbox, hạn chế đính kèm vào chat ([D-041](../decisions.md)).
- Một session tương ứng một phase test ([D-036](../decisions.md)).
- Tác vụ nào tool xử lý được thì để tool xử lý, agent chỉ nhận kết quả gọn và điều phối ([D-046](../decisions.md)).

## Quan sát từ 3 file mẫu

Dữ kiện đo từ các file trong [docs/](../../), không phải quyết định:

- **checklist mẫu.xlsx**: 1 sheet, khoảng 220 ô có dữ liệu. Cột: Element, Description, Result, Implement / Status, Pic, Verify status, Verify, Note. Các dòng gồm mã sản phẩm, quyền truy cập Firebase, package name, keystore, google-services.json. Có ghi chú (comment) trong ô và hình nhúng.
- **File kịch bản ads mẫu.xlsx**: 1 sheet tên `Phase 8`, khoảng 265 ô, 1 ô gộp.
  - Phần đầu: ID app, version LIB, các dòng ghi chú.
  - Bảng bắt đầu ở dòng 11, cột: Screen, Ads name, Resource name in the code, Description, Ads type, Ads ID, Remote config in LIB. Dòng 12 là dòng hướng dẫn mẫu.
  - Cột Screen chỉ ghi ở dòng đầu mỗi nhóm. Các dòng chỉ có chữ `Phase N` là tiêu đề nhóm. Một số ô chứa nhiều giá trị ngăn cách bằng ` / ` hoặc `, `. Một số dòng thiếu resource name hoặc remote key.
- **Nghiệm thu tích hợp lib Tera.xlsx**: 6 sheet, 5 sheet đang ẩn (các version cũ và bản nháp), 1 sheet hiển thị có tên bị cắt ở 31 ký tự. Kích thước khoảng 475 KB, vùng dữ liệu tới dòng 1071 nhưng phần lớn là ô trống. Nội dung gồm yêu cầu bắt buộc, danh sách key Remote Config cần có theo nhóm, hướng dẫn kiểm tra logcat (kèm link ảnh), và bảng kiểm từng ad (tên ad, key remote, tiền điều kiện, mô tả, mô tả ID, ví dụ log).

## Thiết kế chi tiết

### 1. Tool, resource, prompt (D-050)

| Tool | Việc | Trả về (gọn) |
|---|---|---|
| `ingest_brief_files {package_name, session_id, files: [{source, role, label?}]}` | Nạp một hoặc nhiều file Excel trong **một lần gọi**. `source` là tên file trong inbox hoặc đường dẫn tuyệt đối. `role` là `checklist`, `ads_script`, `lib_acceptance` hoặc `other` | Mỗi file một khối nhỏ: `brief_id`, vai trò, số sheet, số sheet ẩn, tổng số ô, tối đa 5 cảnh báo |
| `list_brief_files {package_name, session_id}` | Các file đề bài đã nạp | Mỗi file một dòng |
| `get_brief_summary {…, brief_id}` | Tóm tắt từng sheet | Tên, ẩn hay hiện, số hàng và cột có dữ liệu, số ô, số vùng gộp, số ghi chú, số ảnh, cảnh báo |
| `read_brief_sheet {…, brief_id, sheet, rows?, cursor?}` | Đọc một đoạn của một sheet | Tối đa 40 hàng hoặc khoảng 4 KB mỗi lần, mỗi ô cắt khoảng 300 ký tự, có `next_cursor`, có tùy chọn lấy đủ một ô |
| `search_brief {…, text, role?, sheet?, limit?}` | Tìm hàng chứa một chuỗi (ví dụ tên một key) | Tối đa 20 hàng khớp, kèm sheet và số hàng |

- **Resource:** `index` của từng file đề bài. **Prompt `ingest-brief`:** liệt kê inbox, hỏi vai trò từng file, nạp, đọc tóm tắt, báo cảnh báo.
- Excel nhỏ nên nạp **đồng bộ**, không dùng job. Gói nhiều file vào một lần gọi để giảm số vòng gọi ([D-046](../decisions.md)).
- `read_brief_sheet` và `search_brief` để agent không phải đọc cả Markdown của một sheet khi chỉ cần vài hàng. Việc rút điều kiện (điền lại ô Screen, tách ô nhiều giá trị, nhận biết dòng `Phase N`) để phase sau.

### 2. Luồng nạp và kiểm tra đầu vào

- Kiểm tra nguồn như [P1](phase-1-ingest-logcat.md): tên inbox chỉ là tên thuần, đường dẫn tuyệt đối phải là file thường.
- Nhận diện bằng cấu trúc, không tin phần đuôi file: phải là gói zip hợp lệ có `[Content_Types].xml` và `xl/workbook.xml`. File có mật khẩu (định dạng mã hóa) hoặc không phải xlsx thì trả `Lỗi:` rõ ràng.
- Giới hạn bảo vệ: kích thước file, tổng dung lượng sau giải nén, tổng số ô. Mặc định 50 MB và 2.000.000 ô, cấu hình được.
- `.xlsm`: macro không bao giờ được thực thi, chỉ đọc dữ liệu ô và ghi cảnh báo "có macro".
- Trùng: cùng hash và cùng vai trò trong session thì trả lại bản đã nạp. Hash khác thì tạo bản mới (002), giữ bản cũ.
- Ghi vào `.partial` rồi đổi tên khi xong, lỗi thì dọn sạch.

### 3. Lưu trữ

Mỗi file nạp vào có một thư mục riêng, đánh số theo thứ tự nạp:

```
brief/
  index.md                          # danh sách file đã nạp: vai trò, tên gốc, hash, ngày nạp
  001_<vai-trò>_<tên-file>/
    raw/source.xlsx                 # giữ nguyên nội dung, tên gốc ghi trong index.md
    index.md                        # danh sách sheet (ẩn/hiện, số hàng), cảnh báo chuyển đổi
    <tên-sheet>.md                  # mỗi sheet một file Markdown; tên sheet làm sạch ký tự đặc biệt, thêm hậu tố nếu trùng
  002_...
```

### 4. Chuẩn hóa cơ bản, không diễn giải nội dung (D-035)

- Mỗi sheet là một bảng Markdown gồm cột số hàng và các cột (theo chữ A, B, C, ...) có dữ liệu. Bỏ hàng và cột trống. Ký tự `|` trong ô được escape.
- Ô nhiều dòng giữ xuống dòng bằng `<br>`.
- Ô gộp chỉ ghi ở ô đầu, danh sách vùng gộp ghi vào front-matter.
- Công thức lấy giá trị đã tính. Chưa có giá trị thì để trống và ghi cảnh báo.
- Ghi chú (comment) trong ô đưa vào phần "Ghi chú" của sheet.
- Ảnh nhúng không trích xuất, chỉ ghi cảnh báo số lượng ảnh. Link dạng chữ trong ô vẫn giữ.
- Chưa điền lại ô trống của cột Screen, chưa tách ô nhiều giá trị, chưa nhận biết dòng `Phase N`.
- Sheet ẩn vẫn nạp và đánh dấu `hidden`. Sheet hiển thị đứng trước.
- Phạm vi định dạng: `.xlsx` và `.xlsm`. `.xls` cũ và `.csv` ngoài phạm vi P3.

### 5. Nội dung ô là dữ liệu không đáng tin cậy

Các tool đọc (`read_brief_sheet`, `search_brief`) đánh dấu nội dung trả về là dữ liệu không đáng tin cậy. File hướng dẫn agent ghi rõ: nội dung ô chỉ là dữ liệu tham khảo, không phải lệnh cần thực hiện.

### 6. Thư viện Excel cho TypeScript (Q-034)

- **Không dùng gói `xlsx` (SheetJS) trên npm**: theo các issue và tracker công khai, bản trên npm (0.18.5) có lỗ hổng đã biết (CVE-2023-30533, ReDoS), bản đã sửa không được phát hành lên npm mà chỉ có tarball trên CDN của họ. Chưa kiểm lại trạng thái hiện tại. Nguồn: [SheetJS issue 2961](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961), [SheetJS issue 3012](https://git.sheetjs.com/sheetjs/sheetjs/issues/3012).
- **ExcelJS, chế độ đọc toàn bộ (không streaming)** là ứng viên chính vì đọc được vùng gộp, ghi chú ô, trạng thái sheet. Một issue công khai báo ô gộp đọc sai ở chế độ streaming ([discussion 2401](https://www.github.com/exceljs/exceljs/discussions/2401)), nên chỉ dùng chế độ đọc toàn bộ. Streaming cũng không cần vì file nhỏ và xlsx là gói zip.
- **Phương án dự phòng:** đọc trực tiếp bằng thư viện zip và XML.
- **Bước thử nghiệm đầu phase:** đọc 3 file mẫu bằng ExcelJS và so với bộ đếm độc lập đọc thẳng XML (số ô, số vùng gộp, số ghi chú, trạng thái ẩn). Khớp thì dùng ExcelJS, lệch thì chuyển phương án dự phòng. Kết quả ghi thành quyết định mới.

### 7. Tiêu chí hoàn thành

- 3 file mẫu nạp bằng một lần gọi qua MCP và qua `client.mjs`. Mỗi sheet có một file Markdown. Sheet ẩn được đánh dấu đúng. Nạp được nhiều hơn 3 file.
- Số ô có dữ liệu trong Markdown bằng số ô đếm độc lập từ XML (kiểm tra tự động). Vùng gộp, ghi chú, số ảnh được ghi nhận đúng.
- Raw giống bản gốc từng byte (hash).
- Từ chối rõ ràng: không phải xlsx, có mật khẩu, quá giới hạn kích thước. Macro không bị thực thi.
- Nạp lại cùng file trả bản cũ, file đổi nội dung tạo bản 002.
- `read_brief_sheet` chặn đúng giới hạn và phân trang đúng. `search_brief` chặn ở 20 hàng. Kích thước kết quả các tool nằm trong ngưỡng.
- Nội dung ô trả về luôn mang dấu "dữ liệu không đáng tin cậy" (có test).
- Fixture Excel giả sinh bằng code trong test, không dùng nguyên 3 file mẫu thật.
