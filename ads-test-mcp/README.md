# ads-test-mcp

MCP server local (stdio, TypeScript) hỗ trợ tester kiểm tra ads Android. Thiết kế đầy đủ ở [../docs/plan/mvp.md](../docs/plan/mvp.md), quyết định ở [../docs/plan/decisions.md](../docs/plan/decisions.md).

**Trạng thái: M1 (đọc logcat), M2 (đọc kịch bản ads), M3 (verify) và M4 (key bật/tắt từ Firebase).** Có 5 tool: `parse_logcat`, `search_logcat`, `read_ad_script`, `verify_ads`, `map_remote_keys`. M4 chưa kiểm chứng trên Windows và trên bộ file của app thuộc project thật (Q-074); phần so giá trị log với console bị bỏ (D-101). Mọi tool đều gọi được cả qua MCP lẫn qua `cli.js` (D-080), và `cli.js` đi qua đúng server MCP (D-082).

Hướng dẫn từng bước cho tester (chuẩn bị, thông tin cần đưa, cách duyệt bảng mapping, đọc kết quả, lỗi thường gặp): [HUONG-DAN-TESTER.md](HUONG-DAN-TESTER.md).

## Tool

| Tool | Đầu vào | Trả về |
|---|---|---|
| `parse_logcat` | `log_path`, `ad_offset?`, `ad_limit?` (mặc định 15, tối đa 100), `include_config?`, `config_filter?` | Package, version lib, khoảng thời gian, số entry, bảng ad theo ad unit id (loại, load, ok, fail, show, lỗi gần nhất), tóm tắt Remote Config, cảnh báo (tối đa 5) |
| `read_ad_script` | `xlsx_path`, `sheet?`, `phase?`, `offset?`, `limit?` (mặc định 10, tối đa 50) | Danh sách ad của một sheet kịch bản (`.xlsx`, `.xlsm`): dòng, mục phase, screen điền lại, Ads name, resource, key, loại, ad id, cờ HF, ghép cặp, case đặc biệt; đếm tổng; cảnh báo (tối đa 8 mỗi lần) |
| `verify_ads` | `log_path`, `xlsx_path`, `sheet?`, `acceptance_path?`, `acceptance_sheet?`, `out_dir?`, `firebase_project_id?`, `version?`, `key_overrides?` | Đối chiếu log với một sheet kịch bản (mọi mục phase): đúng ID, đủ ad, đúng loại, rule HF, fail không show, load một lần, key false không request. Ghi `ads-report-<thời gian>.md` (không ghi đè) và trả: đếm OK, FAIL, CẦN XEM, ad thừa, tối đa 20 dòng FAIL kèm vị trí trong kịch bản, đường dẫn report |
| `map_remote_keys` | `xlsx_path`, `firebase_project_id`, `version`, `sheet?`, `acceptance_path?`, `acceptance_sheet?`, `key_overrides?`, `out_dir?` | Bảng mapping key remote của từng ad (kịch bản, file nghiệm thu, rồi suy theo tên) kèm giá trị trên Firebase theo condition `Tester_<version>` (không có thì default). Ghi `key-map-<thời gian>.md`, trả tối đa 80 dòng. Tester duyệt trước khi verify (D-098, D-105) |
| `search_logcat` | `log_path`, `tag?`, `text?`, `ad_id?`, `limit?` (mặc định 10, tối đa 30), `cursor?` | Entry khớp (cắt khoảng 300 ký tự), `total_matched`, `next_cursor` |

- Server **stateless**: mỗi lần gọi tự mang `log_path`, không có "session hiện tại".
- Kết quả trả `structuredContent` theo `outputSchema` kèm 2 đến 3 dòng văn bản. Lỗi nghiệp vụ trả `isError: true`, nội dung bắt đầu bằng `Lỗi:`.
- `parse_logcat`, `search_logcat`, `read_ad_script` chỉ đọc file. `verify_ads` đọc log, kịch bản và (tùy chọn) file nghiệm thu rồi chỉ ghi thêm **một file report mới** vào `out_dir` (mặc định là thư mục chứa file log), không bao giờ ghi đè hay sửa file nào; annotation `readOnlyHint: false`, `destructiveHint: false`. `map_remote_keys` cũng chỉ ghi thêm một report mới (mặc định cạnh file kịch bản).
- **Firebase (M4, D-093):** đọc bằng lệnh `firebase remoteconfig:get --json` của `firebase-tools` (cài `npm install -g firebase-tools`, tester tự `firebase login` trong terminal). Tool không đọc, không lưu, không truyền token. Lệnh con duy nhất được gọi là `remoteconfig:get`, tham số cố định, project id được kiểm định dạng, không qua shell; có test quét mã nguồn chứng minh không có lệnh ghi. Trên Windows tool chạy file JS của `firebase-tools` cạnh `firebase.cmd` bằng chính Node, không gọi `.cmd` qua shell.
- Có `firebase_project_id` và `version` thì trạng thái bật/tắt của `verify_ads` lấy từ console (D-097), log chỉ dùng cho load, show, thứ tự (D-101). Không có thì lấy từ log như M3 và report ghi rõ.
- File Excel: đọc bằng ExcelJS (D-081) sau một bước kiểm tra zip riêng (từ chối file mật khẩu hoặc `.xls` cũ, giới hạn kích thước sau giải nén, giới hạn 2.000.000 ô). Nội dung ô là dữ liệu không đáng tin cậy, được cắt độ dài khi trả ra.
- Giá trị trông giống secret (key có từ `token`, `secret`, `password`, `pin`, `otp`, `api key`) bị che thành `***`.

## Phiên bản MCP (D-079)

Server nói song song hai thế hệ trên cùng một tiến trình stdio:

| Thế hệ | Cách client mở đầu | Hành vi |
|---|---|---|
| Modern `2026-07-28` | Request có `_meta` với `io.modelcontextprotocol/protocolVersion` và `.../clientCapabilities`; có thể gọi `server/discover` trước | Stateless, không cần `initialize`. Result có `resultType: "complete"` và `_meta.serverInfo`; `server/discover` và `tools/list` có thêm `ttlMs`, `cacheScope` |
| Legacy `2025-11-25` trở xuống | `initialize` rồi các request không có `_meta` modern | Qua SDK như cũ, result không thêm trường nào |

- Thiếu trường bắt buộc của `_meta` trả `-32602`. Version lạ trả `-32022` kèm `data.supported` và `data.requested`.
- SDK 1.29.0 chưa hỗ trợ `2026-07-28` nên phần modern nằm ở `src/protocol.ts` (logic thuần) và `src/dual-era-transport.ts` (bọc transport của SDK). Bỏ lớp bọc khi SDK hỗ trợ native.
- Chưa có: `subscriptions/listen`, multi round-trip (`input_required`), `logLevel`, extension. Danh sách tool tĩnh nên `server/discover` không khai `listChanged`.
- Chưa kiểm chứng trong Claude Desktop, Claude Code, Codex (còn mở ở Q-031).

## Khác với bản nháp trong mvp.md

- `verify_ads`: kiểm tra không làm được (ví dụ không tìm được key, key không có trên console) là `NA` kèm lý do, không tính vào OK, FAIL, CẦN XEM. Dòng có resource mà không ghi key thì tra key trong file nghiệm thu (D-083). Rule HF áp dụng khi ít nhất một key của cặp bật; key `false` thì ID không được load và không được show (D-085). Request chỉ tính từ dòng `starting load`, dòng ok/fail lẻ được cảnh báo (D-086). Một ad có thể có nhiều key (bật nếu có một key bật, D-090); trạng thái key gộp theo ID vì nhiều ad có thể chung một ID (D-088). Case đặc biệt luôn CẦN XEM. Chi tiết ở mục "Ghi chú triển khai M3" của `mvp.md`.
- `read_ad_script` phân trang (`offset`, `limit`) và có thêm `phase`; `counts` luôn tính cả sheet. Rule: D-064 (nhận diện HF), D-067 (loại ad), D-069 và D-074 (ghép cặp), D-071 (kiểm mọi phase), D-072 (dùng Ads name thay resource và key), D-075 và D-077 (case đặc biệt trong `src/data/special-cases.json`). Dòng `Note:` được đọc như dòng bình thường (D-084). Cảnh báo thêm `resource_multi_id` và `duplicate_key` khi kịch bản trái quan hệ của D-088 và D-090.
- `parse_logcat` chỉ trả **tóm tắt** Remote Config (số snapshot, số key, key đổi giá trị). Giá trị key chỉ có khi `include_config: true`, nên lọc bằng `config_filter`, để kết quả mặc định giữ quanh 3 KB (D-046).
- Bảng ad phân trang bằng `ad_offset` và `ad_limit` vì log thật có khoảng 30 ad id.
- Log in CONFIG nhiều lần khi app khởi động lại: mỗi lần là một snapshot, giá trị trả về lấy từ lần cuối.

## Cấu trúc

```
src/core/      logcat.ts (parser), ad-events.ts, config.ts, summary.ts, api.ts, validate.ts, mask.ts, errors.ts
               xlsx.ts (ExcelJS), zip.ts (kiểm tra zip), ad-script.ts, script-tool.ts, special-cases.ts
               verify.ts (đối chiếu), acceptance.ts (trích file nghiệm thu), report.ts, verify-tool.ts
src/data/      special-cases.json (case đặc biệt, dev bổ sung dần)
src/server.ts  đăng ký tool MCP
src/protocol.ts, src/dual-era-transport.ts  tương thích MCP 2026-07-28 và handshake cũ
src/index.ts   điểm vào stdio
src/cli.ts     MCP client thật (D-082), --direct gọi thẳng core
src/mcp-client.ts  client legacy (SDK) và modern (JSON-RPC thô) cho cli.ts
skills/ads-test/SKILL.md
tests/         node --test, fixture sinh bằng code (fixtures.mjs)
```

`core/` không import MCP SDK. Server MCP và `cli.js` cùng gọi `core/api.ts` (D-058).

## Chạy thử

Cần Node 20 trở lên (chạy test cần Node 21 trở lên vì dùng glob của `node --test`). `npm install` kéo `exceljs` và các gói phụ của nó từ registry nội bộ của công ty, nên cần chạy ở máy có truy cập registry (VPN). Máy chỉ chạy tool thì copy nguyên thư mục đã có `node_modules` và `dist/`.

```bash
npm install
npm test
```

Đăng ký vào Claude Code:

```bash
claude mcp add ads-test -- node /đường/dẫn/tuyệt/đối/tới/ads-test-mcp/dist/index.js
```

## Gọi qua skill và CLI (khi host chặn MCP, D-080, D-082)

Claude Code của tester chặn cài MCP tùy chỉnh, nên skill `ads-test` gọi `dist/cli.js` qua Bash. `cli.js` là một **MCP client thật** theo mô hình `test-client.mjs` của grooming-mcp: mỗi lệnh spawn server `dist/index.js` qua stdio, bắt tay MCP, gọi tool rồi đóng server.

```bash
node dist/cli.js tools/list
node dist/cli.js call parse_logcat '{"log_path":"/đường/dẫn/tới/logcat.txt"}'
node dist/cli.js call search_logcat '{"log_path":"/đường/dẫn/tới/logcat.txt","tag":"LOAD_FAILURE","limit":5}'
node dist/cli.js call read_ad_script '{"xlsx_path":"/đường/dẫn/tới/kich-ban.xlsx","sheet":"Phase 8"}'
node dist/cli.js call verify_ads '{"log_path":"/đường/dẫn/tới/logcat.txt","xlsx_path":"/đường/dẫn/tới/kich-ban.xlsx","sheet":"Phase 8","out_dir":"/đường/dẫn/thư-mục-report"}'
node dist/cli.js keys --xlsx /đường/dẫn/kich-ban.xlsx --project aap884-drama-short --version 1.0.0 --acceptance /đường/dẫn/nghiem-thu.xlsx
node dist/cli.js verify --log /đường/dẫn/logcat.txt --xlsx /đường/dẫn/kich-ban.xlsx --project aap884-drama-short --version 1.0.0 --overrides '{"12":["fo_banner_splash"]}'
node dist/cli.js discover                       # server/discover theo spec 2026-07-28
printf '%s\n' '{"command":"tools/list"}' | node dist/cli.js session   # nhiều lệnh trong một tiến trình
```

| Tùy chọn | Ý nghĩa |
|---|---|
| (mặc định) | Handshake `initialize` qua SDK `Client`, giống `test-client.mjs` của grooming-mcp |
| `--protocol modern` | Theo spec 2026-07-28: không handshake, mỗi request tự mang `_meta`; `discover` luôn dùng modern |
| `--direct` | Gọi thẳng `core`, không qua server MCP. Chỉ là dự phòng khi không spawn được tiến trình con |
| `--raw` | In nguyên kết quả MCP (`content`, `structuredContent`, `isError`, và `resultType` ở modern) |
| `--summary` | Chỉ in phần tóm tắt dạng chữ |

- Kết quả in JSON ra stdout (`structuredContent`). Lỗi in ra stderr, bắt đầu bằng `Lỗi:`, thoát mã 1. Ba chế độ (MCP legacy, MCP modern, `--direct`) cho kết quả giống hệt nhau (có test); đi qua MCP chậm hơn khoảng 190 ms mỗi lệnh.
- `session`: mỗi dòng stdin là `{"command":"call","name":"...","arguments":{...}}` (hoặc `tools/list`, `discover`, `prompts/list`, `resources/list`), mỗi dòng stdout là `{"ok":true,"result":...}` hoặc `{"ok":false,"error":"Lỗi: ..."}`.
- `prompts/list` và `resources/list` trả mảng rỗng vì server chỉ có tool (D-057). Đặt `ADS_TEST_DEBUG=1` để xem log của server.
- Skill nằm ở `skills/ads-test/SKILL.md` và có một bản copy ở `~/.claude/skills/ads-test/SKILL.md`. **Sửa bản trong project rồi copy lại** để hai bản luôn giống nhau:

```bash
cp skills/ads-test/SKILL.md ~/.claude/skills/ads-test/SKILL.md
```

- Skill hard-code đường dẫn `BASE` tới `dist/cli.js` của máy này; máy khác thì sửa `BASE` trong skill.
- Dạng cờ để dùng tay: `node dist/cli.js parse --log <path>`, `node dist/cli.js search --log <path> --tag LOAD_AD`, `node dist/cli.js script --xlsx <path> --sheet <tên> --phase "Phase 2"`, `node dist/cli.js verify --log <path> --xlsx <path> [--sheet <tên>] [--acceptance <path>] [--out-dir <thư mục>]`.

## Lưu ý

- Không commit file log mẫu, file Excel thật, report sinh ra hay credential (xem `.gitignore`).
- `dist/` cần được build và commit trước khi phát hành để clone hoặc copy folder là chạy được (D-062).
