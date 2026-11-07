# Bàn giao phiên làm việc (2026-11-07)

Bản tóm tắt ngắn để mở chat session mới làm tiếp. Nguồn sự thật vẫn là [README.md](README.md), [mvp.md](mvp.md), [decisions.md](decisions.md), [open-questions.md](open-questions.md). Đọc README trước, rồi file này.

## Mục tiêu

MCP server local cho tester kiểm ads Android: đọc logcat, đọc kịch bản ads (xlsx), đối chiếu và ghi report. Phải gọi được qua **cả MCP lẫn `cli.js`** vì Claude Code của tester chặn MCP tùy chỉnh (D-080, D-082). Code ở `ads-test-mcp/`, file mẫu thật ở `docs/` (không commit, không dùng làm fixture; fixture sinh bằng code).

## Trạng thái

| Mốc | Việc | Trạng thái |
|---|---|---|
| M1 | `parse_logcat`, `search_logcat` | Xong |
| M2 | `read_ad_script` (ExcelJS, D-081) | Xong |
| M3 | `verify_ads` + report `ads-report-*.md` | Xong; Q-050 đến Q-055 đã chốt và cài (D-083 đến D-091). Chờ tester so tay ít nhất 10 ad |
| M4 | `compare_remote_config`, `auth login google` | **Chưa làm** |
| Gói MCPB | Cài một click trên Claude Desktop (Q-038) | Chưa làm (sau M3, D-078) |

Đã có: server nói song song MCP 2026-07-28 và handshake cũ (D-079); `cli.js` là MCP client thật như `test-client.mjs` của grooming-mcp, có `session`, `discover`, `--protocol modern`, `--direct` (D-082); skill `ads-test` ở `ads-test-mcp/skills/ads-test/SKILL.md`, bản copy ở `~/.claude/skills/ads-test/` (giống hệt). Kiểm tra lần cuối (2026-11-07): build sạch, **230 test pass** (khoảng 22 giây).

## Chạy và kiểm tra nhanh

```bash
cd /Users/dungnt11/PersonalProjects/ads_auto_test/ads-test-mcp
npm test                                   # build + toàn bộ test (cần Node 21 trở lên vì glob của node --test)
node dist/cli.js tools/list                # 4 tool, đi qua server MCP thật
node dist/cli.js verify --log <log> --xlsx <kịch bản> [--sheet S] [--acceptance <nghiệm thu>] [--out-dir <thư mục>]
cp skills/ads-test/SKILL.md ~/.claude/skills/ads-test/SKILL.md   # đồng bộ skill (xem bẫy bên dưới)
```

Kết quả `verify_ads` trên file mẫu: không có file nghiệm thu thì 46 ad, OK 20, FAIL 20, CẦN XEM 6; có file nghiệm thu (`--acceptance`) thì OK 21, FAIL 19, CẦN XEM 6 (tra được key cho 4 resource, D-083). Một dòng fail lẻ được cảnh báo (dòng log 757). Trước D-083, kết quả khớp bộ đọc Python độc lập trên 42 ad × 3 kiểm tra.

## Việc tiếp theo (thứ tự đề xuất)

1. **Rule đối chiếu M3 đã chốt hết** (D-063 đến D-077, D-083 đến D-091). Quan hệ dữ liệu dùng xuyên suốt: một ad có thể có nhiều key (N-1, D-090), nhiều ad có thể chung một ID, một ad không có nhiều ID (D-088). Gặp tình huống mới thì báo CẦN XEM và ghi câu hỏi, không tự đặt rule.
2. **Kiểm chứng ngoài máy dev** (cần user): thử `/ads-test` trong phiên Claude Code thật; thử MCP trong Claude Desktop và Codex (phần còn mở của Q-031); thử trên Windows; để tester so tay ít nhất 10 ad (tiêu chí hoàn thành M3).
3. **Bảo mật dependency** (cần bên bảo mật SSI): Q-049, còn 10 gói lỗ hổng (chuỗi `archiver` của ExcelJS, `uuid`, `zod`), đã phân tích là phía ghi file hoặc không có mảng ở schema nên khó bị khai thác; chờ xác nhận chấp nhận rủi ro dư. Tùy chọn: nâng `@modelcontextprotocol/sdk` tối thiểu lên `^1.32.2` rồi `npm install` để lock đồng bộ.
4. **M4** (theo `mvp.md`, mục "M4"): thử hướng A (`firebase-tools`) và B (REST) trên một project Spark thật với tài khoản Editor (Q-023, cần user); chọn cách giữ token trong keychain bằng lệnh hệ điều hành, không dùng module native (Q-032); `auth login google` chạy ở terminal ngoài chat (D-044); `compare_remote_config` theo condition `Tester_<version>` (thiếu condition thì lỗi, key chỉ có default thì CẦN XEM); cấp key ad in-app cho `verify_ads` để bỏ các kiểm tra NA; chỉ đọc, có test chứng minh không có đường ghi và không lộ token. Tool mới phải gọi được qua `cli.js`, có test parity MCP với `TOOLS`, cập nhật skill rồi copy.
5. **Gói MCPB** (Q-038) và phát hành cho tester: copy nguyên thư mục có `node_modules` và `dist/`; thử cài trên macOS và Windows.

## Môi trường và bẫy đã gặp

- **Registry nội bộ** `jfrog.ssi.com.vn` cần VPN FortiClient; `npm install` ở máy không có VPN sẽ timeout. Sandbox của Claude không tới được; lệnh `npm install` và `npm audit fix` đã được user tự chạy ở terminal.
- **Sandbox:** ghi vào `~/.claude/skills/` bị chặn, phải chạy lệnh `cp` ngoài sandbox (có hỏi quyền). `pgrep` bị chặn nên kiểm tiến trình mồ côi bằng pid (`process.kill(pid, 0)`). `rm -rf` với biến bị từ chối; dùng `rm` đúng đường dẫn.
- **zsh** không tách từ biến không có dấu nháy (`$m` chứa hai từ là một đối số); dùng vòng lặp riêng từng tùy chọn.
- **Sửa file bằng Python:** `str.replace` không báo lỗi khi không khớp (đã từng làm skill lỗi thời mà không biết); luôn kiểm `old in s` trước.
- **Ghi report:** `verify_ads` mặc định ghi cạnh file log; khi thử nhớ dọn file `ads-report-*.md` (đã ignore trong `.gitignore` của project).
- **Giữ nhất quán:** trả lời tiếng Việt ngắn gọn, không emoji; không đoán rule chưa chốt (báo CẦN XEM và ghi câu hỏi); không quyết thay bên bảo mật; không để token trong chat, log, file.
- **Chưa là git repo**; `dist/` đã build (D-062 yêu cầu commit khi phát hành).
