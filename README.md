# Signature Cleaner

Web xử lý ảnh chữ ký: xóa nền, điều chỉnh nét mực và xuất SVG hoặc PNG trong suốt. Ảnh được xử lý ngay trong trình duyệt bằng Web Worker, không gửi lên máy chủ.

## Chạy trên máy

Cài **Node.js 20 trở lên** rồi chạy:

```sh
cd web
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run dev
```

Mở **http://127.0.0.1:4173**. Trên Windows, có thể nhấp đúp `start_windows.bat` để cài, build lần đầu và mở trình duyệt. Dừng server bằng `Ctrl+C`.

Sau khi sửa mã nguồn, chạy lại `npm run build` và tải lại trang. Có thể đổi cổng bằng biến môi trường `PORT`.

## Sử dụng

1. Chọn hoặc kéo thả ảnh JPG, PNG, WEBP. Có thể thêm nhiều ảnh cùng lúc.
2. Kiểm tra bản gốc và kết quả. Điều chỉnh màu, độ nhạy, lọc nhiễu hoặc độ mượt rồi chọn **Áp dụng cho tất cả** nếu cần.
3. Tải SVG, PNG, hoặc dùng **Sao chép** để dán PNG trong suốt vào tài liệu.
4. **Lưu tất cả** lưu vào thư mục trên trình duyệt hỗ trợ chọn thư mục; trình duyệt khác tải lần lượt từng file.

Tên và thứ tự ảnh được giữ lại. Tên trùng có hậu tố để tránh ghi đè. Ảnh lỗi được báo riêng và có thể xử lý lại. Kết quả chỉ tồn tại trong phiên làm việc; hãy lưu trước khi đóng hoặc tải lại trang.

**SVG** phù hợp khi cần co giãn trong phần mềm hỗ trợ vector. **PNG** tương thích với các phần mềm chỉ nhận ảnh raster, có các kích thước 600 × 240, 1200 × 480 và 2400 × 960 px. Clipboard dùng PNG, không phải SVG.

## Cấu trúc

```text
web/
  src/
    index.html         Giao diện
    style.css          Kiểu hiển thị và responsive
    app.js             Quản lý ảnh, xem trước, xuất file, clipboard
    engine.js          Tách nền và vector hóa
    worker.js          Xử lý ảnh ngoài luồng giao diện
  scripts/
    build.mjs          Tạo bản build tĩnh
    serve.mjs          Server phát triển cục bộ
  tests/
    engine.test.mjs    Kiểm thử thuật toán
  DEPLOY.md            Hướng dẫn triển khai
```

Không cần backend, cơ sở dữ liệu, GPU hoặc API key. ImageTracerJS 1.2.6 được cố định trong lockfile và đóng gói cục bộ cùng giấy phép Unlicense.

## Kiểm thử và build

```sh
cd web
npm test
npm run build
```

GitHub Actions chạy kiểm thử và build khi push lên `main` hoặc mở pull request. Bộ kiểm thử bao gồm ảnh trắng, alpha, nét nhạt, sắc nền, chấm nhiễu, đường vector, cấu hình đầu ra và tên file trùng.

## Triển khai

Đưa **nội dung `web/dist/`** lên hosting tĩnh có HTTPS. Nếu hosting build từ repository:

| Cấu hình | Giá trị |
|---|---|
| Root directory | `web` |
| Install command | `npm ci --ignore-scripts --no-audit --no-fund` |
| Build command | `npm run build` |
| Output directory | `dist` |

Xem [hướng dẫn triển khai](web/DEPLOY.md) về MIME, CSP, clipboard và quyền chọn thư mục. Workflow kiểm tra không tự triển khai website.

## Giới hạn

- Tối đa 20 MB và 20 triệu pixel mỗi ảnh; tổng dung lượng mỗi phiên tối đa 250 MB.
- Ảnh lớn được giảm còn tối đa 1,2 triệu pixel và cạnh dài 1800 px để phân tích. Nên cắt sát vùng chữ ký để giữ chi tiết.
- Vector hóa ước lượng đường biên từ ảnh gốc. Nét quá nhỏ hoặc đã mất không thể được khôi phục chính xác; cần đối chiếu trước khi sử dụng.
- Dấu mộc, chữ in và nền phức tạp có thể bị giữ lại cùng chữ ký. Công cụ không xác thực người ký.

## Tham khảo

- [ImageTracerJS](https://github.com/jankovicsandras/imagetracerjs)
- [SVG trong Microsoft 365](https://support.microsoft.com/en-gb/office/graphics-visuals/edit-svg-images-in-microsoft-365)
- [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)
