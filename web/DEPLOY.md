# Triển khai Signature Cleaner lên hosting tĩnh

## Bản phát hành

Mã nguồn: `web/src/`. Thư viện duy nhất: ImageTracerJS 1.2.6, được cố định trong `package-lock.json`, giấy phép Unlicense. Build chép thư viện và giấy phép vào `dist/vendor/`; không phụ thuộc CDN khi chạy.

```powershell
cd web
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd test
npm.cmd run build
```

Thiết lập hosting nếu build từ Git:

| Thiết lập | Giá trị |
|---|---|
| Thư mục dự án | `web` |
| Lệnh cài | `npm ci --ignore-scripts --no-audit --no-fund` |
| Lệnh build | `npm run build` |
| Thư mục public | `dist` |
| Runtime backend | Không cần |
| Biến môi trường / API key | Không cần |

Nếu hosting nhận upload file build, đưa **nội dung** `web/dist/` vào thư mục webroot. `index.html` nằm ngay ở gốc. Các đường dẫn dùng dạng tương đối nên cũng chạy được dưới thư mục con. Không cần rewrite SPA; mọi chức năng nằm trên một trang.

## HTTPS và quyền trình duyệt

- Dùng HTTPS trên tên miền thật để Clipboard API hoạt động; localhost là ngữ cảnh được tin cậy khi phát triển.
- File SVG, JavaScript module và CSS cần MIME đúng: `image/svg+xml`, `text/javascript`, `text/css`.
- `_headers` cung cấp cấu hình cho hosting có hỗ trợ file này. Với hosting khác, cấu hình các header tương đương trong bảng điều khiển/server. CSP cơ bản cũng có trong HTML; `frame-ancestors` cần HTTP header.
- Clipboard cần người dùng bấm nút. Nếu bị từ chối, ứng dụng báo rõ và vẫn cho xuất PNG.
- Chọn thư mục qua File System Access API tùy hỗ trợ của trình duyệt. Có phương án tải tuần tự từng ảnh khi API không tồn tại; trình duyệt có thể yêu cầu cho phép nhiều lượt tải.

## Nội dung public

`dist/` chỉ có HTML, CSS, JS, favicon SVG và giấy phép. Không chép `HinhChuKy/`, `artifacts/`, thư mục Python, ảnh mẫu thật hoặc kết quả kiểm thử vào hosting. Nút thử nghiệm tạo nét vẽ minh họa bằng canvas; không dùng chữ ký thật.

Website không gửi ảnh tới backend, không có API upload, không có tài khoản, cơ sở dữ liệu, analytics hoặc thư viện chữ ký lưu trữ. Ảnh được đọc qua File API và xử lý trong Web Worker; mỗi ảnh chỉ có một hàng kết quả. Việc public giao diện không công khai ảnh của người dùng. Khi tab đóng/tải lại, phiên xử lý không được giữ lại.

## Kiểm tra sau khi triển khai

Mở trang bằng Chrome/Edge qua HTTPS, thêm 2–3 ảnh; kiểm tra SVG, PNG và Clipboard. Đổi nền tối để kiểm tra viền trắng; lưu cả lô vào thư mục; thử thêm ảnh trắng hoặc file hỏng để xem thông báo. Thử điện thoại/trình duyệt không hỗ trợ chọn thư mục. Xem Network để bảo đảm không có POST/upload ảnh.

## Giới hạn sản phẩm

SVG là phép ước lượng đường biên mực, không phục hồi nét đã mất và không xác thực người ký. Không phải mọi phần mềm ký số đều nhận SVG; dùng PNG ở kích thước phù hợp nếu cần. Không đặt mô hình tăng độ phân giải/sinh ảnh vào pipeline chữ ký mặc định khi chưa đánh giá hình dạng trên dữ liệu đối chứng.

Tài liệu API: [Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write), [showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).
