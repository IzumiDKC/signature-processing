import { DEFAULTS, outputStem } from './engine.js';

const $ = selector => document.querySelector(selector);
const state = { items: [], busy: false, saving: false, cancel: false, worker: null, rejectJob: null, page: 0, filter: 'all', background: 'checker', inspect: null };
const PAGE_SIZE = 12;
let sequence = 0, toastTimer;
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function options() {
  const [width, height] = $('#size').value.split(',').map(Number);
  return { ...DEFAULTS, width, height, padding: Math.round(width / 50), sensitivity: Number($('#sensitivity').value), minArea: Number($('#minArea').value), smoothing: Number($('#smoothing').value) / 100, color: $('[name="color"]:checked').value };
}
const signature = value => JSON.stringify(value);
const current = item => item.status === 'ready' && item.optionsKey === signature(options());

function toast(message, duration = 6500) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration);
}

function setBusy(value) {
  state.busy = value; document.body.classList.toggle('busy', value);
  for (const control of $('#options').elements) control.disabled = value;
  $('#file-input').disabled = value;
  $('#reset').disabled = value;
  $('#demo').disabled = value;
  $('#batch-progress').hidden = !value;
  render();
}

function releaseResult(item) {
  for (const key of ['svgUrl', 'pngUrl', 'jpgUrl']) if (item[key]) { URL.revokeObjectURL(item[key]); item[key] = null; }
  item.result = null; item.png = null; item.jpg = null;
}

async function addFiles(files) {
  if (state.busy || state.saving) { toast('Vui lòng đợi xử lý xong trước khi thêm ảnh.'); return; }
  const added = [], used = new Set(state.items.map(item => item.stem.toLowerCase()));
  let totalBytes = state.items.reduce((sum, item) => sum + item.file.size, 0);
  for (const file of files) {
    const item = { id: ++sequence, file, name: file.name, stem: outputStem(file.name, used), status: 'queued', error: '', sourceUrl: null, result: null };
    totalBytes += file.size;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) item.error = 'Định dạng không hỗ trợ. Vui lòng chọn ảnh JPG, PNG hoặc WEBP.';
    else if (file.size > 20 * 1024 * 1024) item.error = 'Ảnh vượt 20 MB. Hãy chọn ảnh nhỏ hơn.';
    else if (totalBytes > 250 * 1024 * 1024) item.error = 'Tổng dung lượng vượt 250 MB. Hãy lưu kết quả và xử lý các ảnh còn lại trong lần tiếp theo.';
    if (item.error) { item.status = 'error'; item.inputError = true; }
    state.items.push(item); added.push(item);
  }
  state.filter = 'all'; state.page = Math.floor(Math.max(0, state.items.length - added.length) / PAGE_SIZE);
  render();
  await runBatch(added.filter(item => !item.inputError));
}

async function decode(file) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v);
  const jpg = header[0] === 255 && header[1] === 216;
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!png && !jpg && !webp) throw new Error('Không đọc được ảnh. File hỏng hoặc nội dung không đúng JPG/PNG/WEBP.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Không đọc được ảnh. Hãy thử lại bằng file gốc.'); }
  const sourceWidth = bitmap.width, sourceHeight = bitmap.height;
  if (sourceWidth * sourceHeight > 20_000_000) { bitmap.close(); throw new Error('Ảnh vượt 20 triệu pixel. Hãy cắt vùng chữ ký trước.'); }
  const ratio = Math.min(1, Math.sqrt(1_200_000 / (sourceWidth * sourceHeight)), 1800 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const rgba = context.getImageData(0, 0, width, height).data.buffer;
  canvas.width = canvas.height = 1;
  return { rgba, width, height, sourceWidth, sourceHeight, reduced: ratio < 1 };
}

function workerJob(payload) {
  if (!state.worker) state.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const worker = state.worker;
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', failed); state.rejectJob = null; };
    const message = event => { if (event.data.id !== payload.id) return; clean(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
    const failed = () => { clean(); worker.terminate(); state.worker = null; reject(new Error('Bộ xử lý gặp lỗi. Thử ảnh nhỏ hơn hoặc tải lại trang.')); };
    const timer = setTimeout(() => { clean(); worker.terminate(); state.worker = null; reject(new Error('Ảnh xử lý quá lâu. Hãy cắt sát vùng chữ ký và thử lại.')); }, 45000);
    state.rejectJob = () => { clean(); reject(new Error('Đã dừng. Nhấn “Áp dụng cho tất cả” để xử lý lại.')); };
    worker.addEventListener('message', message); worker.addEventListener('error', failed);
    worker.postMessage(payload, [payload.rgba]);
  });
}

async function rasterize(svg, width, height) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    canvas.width = canvas.height = 1;
    if (!blob) throw new Error('Không xuất được PNG. Thử kích thước nhỏ hơn.');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

// JPG has no alpha channel: flatten the transparent PNG onto white, generated lazily and cached.
async function ensureJpg(item) {
  if (item.jpg) return item.jpg;
  const bitmap = await createImageBitmap(item.png);
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  canvas.width = canvas.height = 1;
  if (!blob) throw new Error('Không xuất được JPG. Thử kích thước nhỏ hơn.');
  item.jpg = blob; item.jpgUrl = URL.createObjectURL(blob);
  return blob;
}

async function runBatch(items) {
  if (state.busy || state.saving || !items.length) return;
  state.cancel = false;
  const opts = options(), key = signature(opts);
  setBusy(true);
  $('#progress').max = items.length; $('#progress').value = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (state.cancel) {
      releaseResult(item); item.status = 'error'; item.error = 'Đã dừng xử lý. Bạn có thể thử lại.';
      continue;
    }
    releaseResult(item); item.status = 'processing'; item.error = '';
    $('#progress-label').textContent = `Đang xử lý ${i + 1}/${items.length} · ${item.name}`;
    render();
    try {
      const decoded = await decode(item.file);
      if (state.cancel) throw new Error('Đã dừng xử lý.');
      if (!item.sourceUrl) item.sourceUrl = URL.createObjectURL(item.file);
      item.sourceWidth = decoded.sourceWidth; item.sourceHeight = decoded.sourceHeight;
      const result = await workerJob({ id: item.id, rgba: decoded.rgba, width: decoded.width, height: decoded.height, options: opts });
      if (state.cancel) throw new Error('Đã dừng xử lý.');
      if (decoded.reduced) result.warnings.push('Ảnh lớn được thu nhỏ khi phân tích. Cắt sát vùng ký để giữ nhiều chi tiết hơn.');
      item.png = await rasterize(result.svg, opts.width, opts.height);
      item.pngUrl = URL.createObjectURL(item.png);
      item.svgUrl = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      item.result = result; item.optionsKey = key; item.options = opts; item.status = 'ready';
    } catch (error) { item.status = 'error'; item.error = error.message; releaseResult(item); }
    $('#progress').value = i + 1; render();
  }
  state.worker?.terminate(); state.worker = null; state.rejectJob = null;
  setBusy(false);
  const ready = state.items.filter(current).length, errors = state.items.filter(item => item.status === 'error').length;
  toast(`Đã xử lý ${ready} ảnh.${errors ? ` ${errors} ảnh cần thử lại.` : ''}`);
}

function card(item, index) {
  const ready = current(item), stale = item.status === 'ready' && !ready;
  const badgeClass = stale ? 'queued' : item.status === 'ready' && item.result.warnings.length ? 'review' : item.status;
  const label = stale ? 'Chưa áp dụng' : { ready: item.result?.warnings.length ? 'Cần đối chiếu' : 'Hoàn tất', error: 'Cần thử lại', queued: 'Đang chờ', processing: 'Đang xử lý' }[item.status];
  const placeholder = item.status === 'processing' ? '<span class="spinner" aria-label="Đang xử lý"></span>' : `<span class="placeholder">${item.status === 'error' ? 'Chưa có kết quả' : 'Đang chờ'}</span>`;
  const note = item.error || (stale ? 'Nhấn “Áp dụng cho tất cả” để cập nhật kết quả.' : item.result?.warnings[0] || '');
  return `<article class="result-card" data-id="${item.id}" data-status="${item.status}">
    <div class="card-head"><span class="card-number">${String(index + 1).padStart(2, '0')}</span><h3 title="${escape(item.name)}">${escape(item.name)}</h3><span class="status-badge ${badgeClass}">${label}</span></div>
    <div class="card-compare"><div class="preview-pane"><div class="preview-label">Ảnh gốc</div><div class="preview-image white">${item.sourceUrl ? `<img src="${item.sourceUrl}" alt="Ảnh gốc ${escape(item.name)}" loading="lazy">` : placeholder}</div></div><div class="preview-pane"><div class="preview-label">Kết quả <span>SVG</span></div><div class="preview-image ${state.background}">${item.svgUrl ? `<img src="${item.svgUrl}" alt="Kết quả ${escape(item.name)}" loading="lazy">` : placeholder}</div></div></div>
    <div class="card-detail"><span>${item.options ? `${item.options.width} × ${item.options.height} px` : 'Chờ xuất ảnh'}</span><button class="text-button" data-action="inspect" ${!item.result || state.busy ? 'disabled' : ''}>Xem lớn & đối chiếu ↗</button></div>
    ${note ? `<p class="card-note ${item.error ? 'error-text' : ''}" title="${escape(note)}">${escape(note)}</p>` : ''}
    <div class="card-actions"><button class="button secondary" data-action="svg" ${!ready || state.busy || state.saving ? 'disabled' : ''}>↓ SVG</button><button class="button secondary" data-action="png" ${!ready || state.busy || state.saving ? 'disabled' : ''}>↓ PNG</button><button class="button secondary" data-action="jpg" ${!ready || state.busy || state.saving ? 'disabled' : ''}>↓ JPG</button>${item.status === 'error' ? `<button class="button secondary copy" data-action="retry" ${state.busy || state.saving || item.inputError ? 'disabled' : ''}>Thử lại</button>` : `<button class="button secondary copy" data-action="copy" ${!ready || state.busy || state.saving ? 'disabled' : ''}>Sao chép</button>`}</div>
  </article>`;
}

function render() {
  for (const control of $('#options').elements) control.disabled = state.busy || state.saving;
  $('#reset').disabled = state.busy || state.saving;
  $('#file-input').disabled = state.busy || state.saving;
  $('#demo').disabled = state.busy || state.saving;
  const ready = state.items.filter(current).length, errors = state.items.filter(item => item.status === 'error').length;
  const stale = state.items.filter(item => item.status === 'ready' && !current(item)).length;
  $('#total-count').textContent = state.items.length;
  $('#total-count').hidden = !state.items.length;
  $('#summary').textContent = state.items.length ? `${ready} ảnh đã xử lý${errors ? ` · ${errors} cần thử lại` : ''}${stale ? ` · ${stale} chưa cập nhật` : ''}` : '';
  $('#summary').hidden = !state.items.length;
  $('#batch-actions').hidden = !state.items.length;
  $('#empty-state').hidden = !!state.items.length;
  $('#view-toolbar').hidden = !state.items.length;
  $('#save-all').disabled = state.busy || state.saving || !ready;
  $('#clear-all').disabled = state.busy || state.saving || !state.items.length;
  $('#process-all').disabled = state.busy || state.saving || !state.items.some(item => !item.inputError);
  $('#batch-format').disabled = state.busy || state.saving;
  $('#settings-note').textContent = stale ? 'Áp dụng lại để cập nhật kết quả.' : '';
  $('#settings-note').hidden = !stale;
  $('#batch-help').hidden = !ready;
  $('#batch-help').textContent = 'showDirectoryPicker' in window && window.isSecureContext
    ? 'Chọn “Lưu tất cả” để lưu ảnh vào một thư mục.'
    : 'Trình duyệt có thể yêu cầu cho phép tải nhiều file khi lưu tất cả.';
  const filtered = state.items.map((item, index) => ({ item, index })).filter(({ item }) => state.filter === 'all' || item.status === state.filter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  $('#results').innerHTML = filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).map(({ item, index }) => card(item, index)).join('') || (state.items.length ? '<p class="filter-empty">Không có ảnh ở trạng thái này.</p>' : '');
  $('#pagination').hidden = pages <= 1;
  $('#page-label').textContent = `Trang ${state.page + 1} / ${pages} · ${filtered.length} kết quả`;
  $('#prev').disabled = state.page === 0; $('#next').disabled = state.page >= pages - 1;
  document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
  document.querySelectorAll('[data-bg]').forEach(button => button.classList.toggle('active', button.dataset.bg === state.background));
}

async function download(item, format) {
  if (!current(item)) { toast('Hãy áp dụng lại thiết lập trước khi xuất ảnh.'); return; }
  if (format === 'jpg') { try { await ensureJpg(item); } catch (error) { toast(error.message); return; } }
  const a = document.createElement('a'); a.href = { svg: item.svgUrl, png: item.pngUrl, jpg: item.jpgUrl }[format];
  a.download = `${item.stem}.${format}`; document.body.append(a); a.click(); a.remove();
}

async function copy(item) {
  if (!current(item)) return;
  if (!window.isSecureContext || !navigator.clipboard?.write || !window.ClipboardItem) { toast('Trình duyệt chưa hỗ trợ sao chép ảnh ở địa chỉ này. Hãy tải PNG hoặc mở trang qua HTTPS.'); return; }
  try {
    // PNG is already generated: writing starts within the user's click gesture.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': item.png })]);
    toast('Đã sao chép PNG. Nhấn Ctrl+V để dán vào tài liệu.');
  } catch { toast('Không được cấp quyền sao chép. Hãy cho phép clipboard hoặc dùng nút xuất PNG.'); }
}

async function unusedFile(directory, filename) {
  const dot = filename.lastIndexOf('.'), stem = filename.slice(0, dot), ext = filename.slice(dot);
  let candidate = filename, suffix = 2;
  while (true) {
    try { await directory.getFileHandle(candidate); candidate = `${stem}__${suffix++}${ext}`; }
    catch (error) { if (error.name === 'NotFoundError') return directory.getFileHandle(candidate, { create: true }); throw error; }
  }
}

async function saveAll() {
  const eligible = state.items.filter(current), format = $('#batch-format').value;
  if (!eligible.length || state.busy || state.saving) return;
  state.saving = true; render();
  let saved = 0;
  try {
    if ('showDirectoryPicker' in window && window.isSecureContext) {
      const parent = await window.showDirectoryPicker({ mode: 'readwrite', id: 'signature-cleaner-output' });
      // Each explicit export uses a new subfolder and also checks every filename.
      const name = `signatures_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const directory = await parent.getDirectoryHandle(name, { create: true });
      for (const item of eligible) {
        const file = await unusedFile(directory, `${item.stem}.${format}`);
        const writable = await file.createWritable();
        await writable.write(format === 'svg' ? new Blob([item.result.svg], { type: 'image/svg+xml' }) : format === 'jpg' ? await ensureJpg(item) : item.png);
        await writable.close(); saved++;
      }
      toast(`Đã lưu ${saved}/${state.items.length} ảnh.${state.items.length > saved ? ` ${state.items.length - saved} ảnh cần xử lý lại trước khi lưu.` : ''}`, 10000);
    } else {
      for (const item of eligible) { await download(item, format); saved++; await new Promise(resolve => setTimeout(resolve, 220)); }
      toast(`Đã gửi ${saved}/${state.items.length} ảnh tới trình tải xuống. Cho phép tải nhiều file nếu trình duyệt hỏi; kiểm tra số file đã nhận.`, 10000);
    }
  } catch (error) {
    if (error.name === 'AbortError') toast('Đã hủy lưu ảnh.');
    else toast(`Đã lưu ${saved}/${state.items.length} ảnh. Không thể lưu tiếp: ${error.message}. Các kết quả vẫn còn để xuất lại.`, 10000);
  } finally { state.saving = false; render(); }
}

function inspect(item) {
  if (!item.result) return;
  state.inspect = item;
  $('#inspect-name').textContent = item.name;
  $('#original-size').textContent = `${item.sourceWidth} × ${item.sourceHeight} px`;
  $('#inspect-original').src = item.sourceUrl;
  $('#inspect-result').src = item.svgUrl;
  $('#inspect-board').className = `inspect-board ${state.background}`;
  $('#zoom').value = '1'; $('#inspect-result').style.width = ''; $('#inspect-result').style.height = '';
  $('#inspect-notes').textContent = item.result.warnings.join(' ') || 'Đối chiếu nét nhỏ, chấm và vòng với bản gốc trước khi dùng.';
  for (const id of ['inspect-svg', 'inspect-png', 'inspect-jpg', 'inspect-copy']) $('#' + id).disabled = !current(item);
  $('#inspect-dialog').showModal();
}

$('#file-input').addEventListener('change', event => { const files = [...event.target.files]; event.target.value = ''; addFiles(files); });
$('#drop-zone').addEventListener('dragover', event => { event.preventDefault(); $('#drop-zone').classList.add('dragover'); });
$('#drop-zone').addEventListener('dragleave', () => $('#drop-zone').classList.remove('dragover'));
$('#drop-zone').addEventListener('drop', event => { event.preventDefault(); $('#drop-zone').classList.remove('dragover'); addFiles([...event.dataTransfer.files]); });
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
$('#options').addEventListener('submit', event => event.preventDefault());
$('#options').addEventListener('input', () => {
  $('#sensitivity-value').textContent = $('#sensitivity').value;
  $('#minArea-value').textContent = `${$('#minArea').value} px`;
  $('#smoothing-value').textContent = `${$('#smoothing').value}%`; render();
});
$('#reset').addEventListener('click', () => { $('#options').reset(); $('#options').dispatchEvent(new Event('input')); });
$('#process-all').addEventListener('click', () => runBatch(state.items.filter(item => !item.inputError)));
$('#cancel').addEventListener('click', () => { state.cancel = true; state.rejectJob?.(); state.worker?.terminate(); state.worker = null; });
$('#clear-all').addEventListener('click', () => {
  for (const item of state.items) { releaseResult(item); if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl); }
  state.items = []; state.page = 0; state.inspect = null; render();
});
$('#save-all').addEventListener('click', saveAll);
$('#results').addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const item = state.items.find(row => row.id === Number(button.closest('[data-id]').dataset.id));
  if (!item) return;
  if (button.dataset.action === 'inspect') inspect(item);
  else if (button.dataset.action === 'copy') copy(item);
  else if (button.dataset.action === 'retry') runBatch([item]);
  else download(item, button.dataset.action);
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.page = 0; render(); }));
document.querySelectorAll('[data-bg]').forEach(button => button.addEventListener('click', () => { state.background = button.dataset.bg; render(); }));
$('#prev').addEventListener('click', () => { state.page--; render(); });
$('#next').addEventListener('click', () => { state.page++; render(); });
$('#close-inspect').addEventListener('click', () => $('#inspect-dialog').close());
$('#inspect-svg').addEventListener('click', () => download(state.inspect, 'svg'));
$('#inspect-png').addEventListener('click', () => download(state.inspect, 'png'));
$('#inspect-jpg').addEventListener('click', () => download(state.inspect, 'jpg'));
$('#inspect-copy').addEventListener('click', () => copy(state.inspect));
$('#zoom').addEventListener('change', () => {
  const zoom = Number($('#zoom').value);
  $('#inspect-board').classList.toggle('zoomed', zoom > 1);
  $('#inspect-result').style.width = zoom > 1 ? `${500 * zoom}px` : '';
  $('#inspect-result').style.height = zoom > 1 ? `${500 * zoom * state.inspect.options.height / state.inspect.options.width}px` : '';
});
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#demo').addEventListener('click', async () => {
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 140;
  const c = canvas.getContext('2d'); c.fillStyle = '#f7f6f0'; c.fillRect(0, 0, 300, 140);
  c.strokeStyle = '#456494'; c.lineWidth = 2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(35, 98); c.bezierCurveTo(75, 35, 90, 15, 81, 52); c.lineTo(62, 111); c.bezierCurveTo(117, 45, 125, 35, 113, 82); c.bezierCurveTo(150, 53, 135, 101, 185, 64); c.bezierCurveTo(165, 96, 222, 76, 258, 68); c.stroke();
  c.beginPath(); c.moveTo(64, 119); c.lineTo(250, 97); c.stroke();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  await addFiles([new File([blob], 'net-ve-minh-hoa.png', { type: 'image/png' })]);
});

render();
