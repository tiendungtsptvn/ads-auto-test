# Hướng dẫn tester: verify ads bằng ads-test

Tài liệu này dành cho tester **đã cài xong** tool `ads-test` (folder `ads-test-mcp` và skill `ads-test` trong Claude Code). Tester chỉ cần trò chuyện với Claude bằng tiếng Việt; Claude tự gọi tool.

## 1. Chuẩn bị một lần trên máy

Mở **terminal** (Windows: PowerShell; macOS: Terminal) và chạy lần lượt các lệnh dưới. Đây là việc tester tự làm, **không làm trong chat**.

1. Kiểm tra Node (cần bản 20 trở lên):
   ```
   node --version
   ```
2. Cài `firebase-tools` để tool đọc được Remote Config:
   ```
   npm install -g firebase-tools
   ```
3. Đăng nhập Firebase bằng tài khoản có quyền xem project cần test. Lệnh sẽ mở trình duyệt.
   ```
   firebase login
   ```
   - Câu hỏi "Enable Gemini in Firebase features?": gõ `n` rồi Enter.
   - Câu hỏi "Allow Firebase to collect CLI … usage": gõ `n` rồi Enter.
   - Chọn tài khoản Google trong trình duyệt, bấm cho phép. Terminal hiện `Success! Logged in as …` là xong.
4. Kiểm tra tài khoản đang đăng nhập (khi cần):
   ```
   firebase login:list
   ```
5. Kiểm tra tool chạy được. Sửa đường dẫn cho đúng nơi đặt folder `ads-test-mcp`:
   ```
   node C:\duong-dan\ads-test-mcp\dist\cli.js tools/list
   ```
   Thấy 5 tool `parse_logcat`, `search_logcat`, `read_ad_script`, `verify_ads`, `map_remote_keys` là được.

> Tool **chỉ đọc** Remote Config, không bao giờ sửa key. **Không bao giờ** dán mật khẩu, token hay mã đăng nhập vào chat. Hết phiên đăng nhập thì chạy lại `firebase login` trong terminal.

## 2. Chuẩn bị thông tin cho mỗi lần test

| Thông tin | Lấy ở đâu | Ví dụ |
|---|---|---|
| File logcat | Android Studio, tab Logcat: lọc theo `FOR_TESTER_`, đi hết luồng cần test, rồi lưu log ra file `.txt`. Giữ nguyên định dạng của Android Studio (mỗi dòng có ngày giờ, pid-tid, tag, package, mức log) | `C:\test\drama\logcat-1.0.0.txt` |
| File kịch bản ads | File `.xlsx` hoặc `.xlsm` của đợt test | `C:\test\drama\kich-ban-ads.xlsx` |
| Tên sheet kịch bản | Sheet cần test trong file kịch bản. Tool kiểm **mọi mục phase** trong sheet đó | `Phase 8` |
| File nghiệm thu lib | File nghiệm thu tích hợp lib (nên có): tool dùng để tra key của ad không ghi key trong kịch bản và trích mô tả case đặc biệt | `C:\test\drama\nghiem-thu-lib.xlsx` |
| Firebase project id | Trên URL của Firebase console: `console.firebase.google.com/project/`**`<project id>`**`/...` | `aap884-drama-short` |
| versionName | Version của bản app đang test (Cài đặt → Ứng dụng → app → phiên bản, hoặc hỏi dev). Phải khớp condition tester trên console, ví dụ condition `tester1.0.0` thì versionName là `1.0.0` | `1.0.0` |

**Lấy đường dẫn đầy đủ của file:**
- Windows: chuột phải vào file, chọn **Copy as path** (Windows 10: giữ Shift rồi chuột phải).
- macOS: chuột phải vào file, giữ Option, chọn **Copy … as Pathname**.

Không cần đính kèm file vào chat, chỉ cần đường dẫn. Tên file và thư mục có dấu cách hay tiếng Việt vẫn dùng được, nhưng **không được có dấu nháy đơn `'`**.

## 3. Các bước verify

### Bước 1: Mở Claude Code và yêu cầu verify

Mở Claude Code ở thư mục bất kỳ, gõ `/ads-test` hoặc nói thẳng yêu cầu. Nên đưa đủ thông tin trong một tin nhắn:

```
/ads-test verify ads
- log: C:\test\drama\logcat-1.0.0.txt
- kịch bản: C:\test\drama\kich-ban-ads.xlsx, sheet "Phase 8"
- nghiệm thu: C:\test\drama\nghiem-thu-lib.xlsx
- Firebase project: aap884-drama-short
- version: 1.0.0
```

Thiếu thông tin nào thì Claude sẽ hỏi lại. Theo mặc định, Claude luôn hỏi project id và version vì trạng thái bật/tắt ad lấy từ Firebase.

### Bước 2: Duyệt bảng mapping key

Claude đọc kịch bản và Firebase rồi hiện **bảng mapping key**. Mỗi dòng kịch bản có:
- key remote bật/tắt của ad;
- nguồn của key: `kịch bản`, `file nghiệm thu`, `suy theo tên`, `tester sửa`, `case đặc biệt`;
- giá trị trên console, kèm nguồn: condition tester (ví dụ `tester1.0.0`) hoặc `chỉ có default (prod)`;
- ghi chú.

Bảng đầy đủ được lưu ở file `key-map-<thời gian>.md`, nằm cạnh file kịch bản.

**Cần xem kỹ các dòng có ghi chú:**

| Ghi chú | Tester làm gì |
|---|---|
| `suy theo tên, tester xác nhận` | Kiểm key có đúng của ad đó không |
| `chỉ gần giống (khớp …%)` | Rất dễ sai, kiểm kỹ |
| `nhiều key gần giống ngang nhau (…)` | Chọn một key trong danh sách |
| `không tìm được key` | Báo key đúng nếu biết. Không có thì để nguyên; các kiểm tra cần key sẽ là NA |
| `không có trên console` | Kiểm lại tên key, hoặc key chưa được tạo trên console |
| `test thủ công (D-099)` | Key là số, chữ hoặc JSON. Tool không tự kiểm, tester test tay |

**Sửa bằng lời trong chat**, ví dụ:
- `dòng 12 dùng key fo_banner_splash`
- `dòng 30 có 2 key: fo_native_full_scr1, fo_native_full_scr2`
- `dòng 52 không có key riêng, dùng fo_inter_splash`

Claude cập nhật rồi hiện lại bảng. Khi bảng đúng thì trả lời **"Đồng ý bảng mapping"**. Claude chỉ verify sau khi tester đồng ý.

### Bước 3: Đọc kết quả verify

Claude báo:
- số ad **OK**, **FAIL**, **CẦN XEM**, và số ad có trong log nhưng không có trong sheet;
- các dòng FAIL, kèm vị trí trong kịch bản (dòng, mục phase);
- đường dẫn report `ads-report-<thời gian>.md`, nằm cùng thư mục với file log.

Mở report bằng trình xem Markdown bất kỳ (VS Code, Typora, ...). Report gồm các mục:
- tổng hợp;
- FAIL;
- CẦN XEM;
- case đặc biệt;
- timeline cặp HF;
- ad thừa;
- cảnh báo dòng log lẻ;
- **mapping key remote**;
- ghi chú;
- bảng từng ad.

**Report chỉ là bằng chứng. Kết luận đạt hay không đạt do tester quyết định.**

## 4. Cách hiểu kết quả

**Trạng thái bật/tắt của ad lấy từ Firebase console**, theo condition tester hoặc default. Log chỉ dùng để xem ad nào được load, show và theo thứ tự nào. Ad có key = `true` thì phải được load/show; key = `false` thì không được load, không được show.

| Kiểm tra | FAIL khi |
|---|---|
| Đúng ID | ID trong kịch bản khác ID app in ra trong log |
| Đủ ad | Ad có key `true` mà không thấy trong log |
| Đúng loại | Loại ad trong kịch bản khác loại trong log |
| HF trước | Cả hai key bật mà ad thường load trước HF, hoặc load khi HF đã load thành công hay chưa có kết quả. Một bên tắt mà bên tắt vẫn load hoặc show |
| Fail thì không show | Load fail rồi vẫn show khi chưa load lại thành công |
| Load một lần trước show | Load hai lần liên tiếp mà chưa show hoặc fail ở giữa |
| Key false thì không load, không show | Key `false` mà ID vẫn được load hoặc show |

- **CẦN XEM:** tool chưa đủ căn cứ để kết luận, tester tự xem. Gồm:
  - case đặc biệt (MIX, Ad resume, Native Preparing, Logic tăng impression);
  - ad có key cần test thủ công;
  - ad có trong log nhưng không có trong sheet.
- **NA:** kiểm tra không làm được, ví dụ thiếu key hoặc ad không có trong log. NA không tính vào OK, FAIL hay CẦN XEM.
- **Các ca có thể báo nhầm đã biết** (vẫn tính FAIL, tester verify lại bằng tay theo timeline trong report):
  - load lại do preload hoặc reload;
  - HF fail ngay trước khi log kết thúc;
  - ad thường được dùng lại cho màn khác.
- Report ghi version template Remote Config và thời điểm cập nhật (giờ UTC). Nếu config bị sửa sau lúc test, kết quả có thể khác.

## 5. Yêu cầu khác có thể gõ

| Muốn | Gõ ví dụ |
|---|---|
| Chỉ xem bảng mapping key | `/ads-test lập bảng key remote cho kịch bản C:\...\kb.xlsx sheet "Phase 8", nghiệm thu C:\...\nt.xlsx, project aap884-drama-short, version 1.0.0` |
| Tóm tắt log | `/ads-test đọc log C:\...\logcat.txt` |
| Soi một ad trong log | `/ads-test tìm ad id ca-app-pub-xxx/yyy trong log C:\...\logcat.txt` |
| Xem các ad load fail | `/ads-test trong log C:\...\logcat.txt ad nào load fail, lỗi gì` |
| Đọc danh sách ad của kịch bản | `/ads-test đọc kịch bản C:\...\kb.xlsx sheet "Phase 8", liệt kê cặp HF và chỗ thiếu key` |
| Verify không dùng Firebase (chỉ khi thật sự cần) | `/ads-test verify ... không dùng Firebase` (trạng thái key lấy từ log, report ghi rõ "chưa đối chiếu console") |
| Ghi report vào thư mục khác | thêm `ghi report vào C:\test\reports` |

## 6. Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| `không tìm thấy firebase-tools trên máy` | Chạy `npm install -g firebase-tools` trong terminal, rồi `firebase login` |
| `chưa đăng nhập Firebase hoặc phiên đăng nhập đã hết hạn` | Chạy `firebase login` trong terminal |
| `không đọc được Remote Config của project …` | Project id sai, hoặc tài khoản đang đăng nhập không có quyền. Kiểm project id trên URL console và tài khoản bằng `firebase login:list` |
| `template không có condition Tester_…` | versionName sai, hoặc console chưa có condition tester của version này. Lỗi có kèm danh sách condition đang có |
| `không kết nối được tới Firebase` | Kiểm tra mạng hoặc VPN |
| File kịch bản có nhiều sheet | Claude hỏi chọn sheet: trả lời tên sheet |
| `… phải là đường dẫn tuyệt đối` | Dùng **Copy as path** để lấy đường dẫn đầy đủ |
| `Operation not permitted` | File nằm trong thư mục bị chặn: chép file sang thư mục khác, ví dụ `C:\test\` |
| Log báo sai định dạng | Lưu lại log từ Android Studio theo định dạng mặc định, đã lọc `FOR_TESTER_` |
| `Không ghi được report` | Chọn thư mục khác có quyền ghi (`ghi report vào …`) |
