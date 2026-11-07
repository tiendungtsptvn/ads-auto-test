# Bối cảnh

Nội dung do user cung cấp, chưa diễn giải thêm.

## Bối cảnh

Một tester muốn tự động hóa một số bước trong quy trình làm việc hàng ngày liên quan đến việc test quảng cáo (ads) trên ứng dụng Android.

## Công việc hàng ngày hiện tại

1. Tải app về thiết bị Android.
2. Cắm cáp kết nối với máy tính để đọc logcat.
3. Kiểm tra danh sách quảng cáo xuất hiện:
   - đúng và đủ chưa;
   - đúng thứ tự chưa;
   - đúng loại chưa (thông tin thể hiện theo ad id trên log) theo yêu cầu.
4. Kiểm tra UI: vị trí xuất hiện quảng cáo và các behaviour liên quan.
5. Setup ads trên Firebase.
6. Đi các luồng tính năng để kiểm tra các bộ ads theo đúng màn hình.

## Ràng buộc

- Tester **không có source code** của app.
- Firebase hiện dùng gói **Spark** (miễn phí).
- Tester có vai trò **Editor** trên các Firebase project (có quyền ghi, không chỉ đọc).

## Hướng đi ban đầu

Đã chốt, chi tiết xem [decisions.md](decisions.md):

- Nguồn dữ liệu đầu vào: D-001.
- Cách đọc logcat: D-002.
- Remote Config: D-003, D-004.
- Đề bài: D-005.
- Trình tự giữa thu thập dữ liệu và xử lý: D-006.
- Cửa vào cho tester (MCP trong agent app, tester dùng được agent app): D-038 đến D-044.
- Hướng hiện tại: MVP "verify trước" với 3 mốc, Remote Config lấy từ log: D-051 đến D-059, thiết kế ở [mvp.md](mvp.md).

## Mục tiêu của kế hoạch

- Xác định rõ yêu cầu và chia phase thực hiện.
- Sau mỗi phase, tự động hóa được ít nhất một bước trong quy trình trên, để có sản phẩm dùng được nhanh.
- Chọn hình thái sản phẩm đầu ra (app/tool, MCP trên AI agent, hay kết hợp) và mức độ dùng giải pháp bên thứ 3. Đã chốt: MCP server cùng skill trong agent app (D-038, D-057).
