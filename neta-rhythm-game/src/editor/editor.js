// editor.js - 制谱器主逻辑

// ==================== 全局状态 ====================

let chart = null; // 当前谱面
let currentTool = "tap"; // 当前工具
let isPlaying = false;
let audioContext = null;
let audioBuffer = null;
let audioSource = null;
let playbackStartTime = 0;
let playbackOffset = 0;
let playbackSpeed = 1.0;
let holdDrawStart = null; // 长按绘制起始

// Canvas
let chartCanvas, chartCtx;
let svCanvas, svCtx;
let cameraCanvas, cameraCtx;

// 视口参数
let scrollY = 0; // 滚动位置（秒）
let viewHeight = 10; // 视口高度（秒）
let pixelRatio = window.devicePixelRatio || 1;

// 轨道配置
const LANE_COUNT = 6;
const LANE_COLORS = ["#555", "#888", "#aaa", "#aaa", "#888", "#555"];
const LANE_ACTIVE_COLOR = "#ffd700"; // 金色
const NOTE_COLORS = { tap: "#4fc3f7", hold: "#81c784" };

// ==================== 初始化 ====================

window.addEventListener("DOMContentLoaded", () => {
    initCanvases();
    initUI();
    chart = createDefaultChart();
    resizeCanvases();
    renderChart();
    renderSV();
});

function initCanvases() {
    chartCanvas = document.getElementById("chart-canvas");
    chartCtx = chartCanvas.getContext("2d");
    svCanvas = document.getElementById("sv-canvas");
    svCtx = svCanvas.getContext("2d");
    cameraCanvas = document.getElementById("camera-canvas");
    cameraCtx = cameraCanvas.getContext("2d");
    window.addEventListener("resize", resizeCanvases);
}

function resizeCanvases() {
    const chartArea = document.getElementById("chart-area");
    chartCanvas.width = chartArea.clientWidth * pixelRatio;
    chartCanvas.height = chartArea.clientHeight * pixelRatio;
    chartCanvas.style.width = chartArea.clientWidth + "px";
    chartCanvas.style.height = chartArea.clientHeight + "px";
    chartCtx.scale(pixelRatio, pixelRatio);

    const sidePanel = document.getElementById("side-panel");
    svCanvas.width = sidePanel.clientWidth * pixelRatio;
    svCanvas.height = 200 * pixelRatio;
    svCanvas.style.width = sidePanel.clientWidth + "px";
    svCanvas.style.height = "200px";
    svCtx.scale(pixelRatio, pixelRatio);

    cameraCanvas.width = sidePanel.clientWidth * pixelRatio;
    cameraCanvas.height = 200 * pixelRatio;
    cameraCanvas.style.width = sidePanel.clientWidth + "px";
    cameraCanvas.style.height = "200px";
    cameraCtx.scale(pixelRatio, pixelRatio);

    renderChart();
    renderSV();
    renderCamera();
}

// ==================== UI 事件 ====================

function initUI() {
    // 工具切换
    document.querySelectorAll(".tool-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentTool = btn.dataset.tool;
        });
    });

    // 面板切换
    document.querySelectorAll(".panel-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".panel-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".panel-content").forEach(p => p.classList.remove("active"));
            tab.classList.add("active");
            document.getElementById("panel-" + tab.dataset.panel).classList.add("active");
        });
    });

    // 音频上传
    document.getElementById("btn-audio").addEventListener("click", () => {
        document.getElementById("file-audio").click();
    });
    document.getElementById("file-audio").addEventListener("change", handleAudioUpload);

    // 保存
    document.getElementById("btn-save").addEventListener("click", saveChart);

    // 导入
    document.getElementById("btn-load").addEventListener("click", () => {
        document.getElementById("file-chart").click();
    });
    document.getElementById("file-chart").addEventListener("change", handleChartImport);

    // 导出
    document.getElementById("btn-export").addEventListener("click", () => {
        exportChartFile(chart);
    });

    // 播放控制
    document.getElementById("btn-play").addEventListener("click", togglePlayback);
    document.getElementById("btn-stop").addEventListener("click", stopPlayback);
    document.getElementById("btn-rewind").addEventListener("click", () => {
        playbackOffset = 0;
        scrollY = 0;
        updateTimeDisplay();
        renderChart();
    });
    document.getElementById("playback-speed").addEventListener("change", (e) => {
        playbackSpeed = parseFloat(e.target.value);
        if (isPlaying) {
            stopPlayback();
            startPlayback();
        }
    });

    // 时间轴拖拽
    const scrubber = document.getElementById("timeline-scrubber");
    scrubber.addEventListener("input", (e) => {
        const audioLen = getAudioLength();
        playbackOffset = (parseFloat(e.target.value) / 100) * audioLen;
        scrollY = Math.max(0, playbackOffset - 2);
        renderChart();
        updateTimeDisplay();
    });

    // BPM 变化
    document.getElementById("bpm").addEventListener("change", (e) => {
        chart.meta.bpm = parseInt(e.target.value) || 180;
        renderChart();
    });

    // 网格划分
    const snapSelect = document.getElementById("snap-division");
    const customInput = document.getElementById("snap-custom");
    snapSelect.addEventListener("change", () => {
        if (snapSelect.value === "custom") {
            customInput.hidden = false;
        } else {
            customInput.hidden = true;
        }
        renderChart();
    });
    customInput.addEventListener("change", () => renderChart());

    // Censor
    const censorDir = document.getElementById("censor-direction");
    const censorDist = document.getElementById("censor-distance");
    const censorVal = document.getElementById("censor-value");
    censorDir.addEventListener("change", () => renderChart());
    censorDist.addEventListener("input", () => {
        censorVal.textContent = censorDist.value + "%";
        renderChart();
    });

    // Chart Canvas 交互
    chartCanvas.addEventListener("mousedown", onChartMouseDown);
    chartCanvas.addEventListener("mousemove", onChartMouseMove);
    chartCanvas.addEventListener("mouseup", onChartMouseUp);
    chartCanvas.addEventListener("wheel", onChartWheel);
    chartCanvas.addEventListener("contextmenu", e => e.preventDefault());

    // SV Canvas 交互
    svCanvas.addEventListener("mousedown", onSvMouseDown);
    svCanvas.addEventListener("mousemove", onSvMouseMove);

    // Camera Canvas 交互
    cameraCanvas.addEventListener("mousedown", onCameraMouseDown);
    cameraCanvas.addEventListener("mousemove", onCameraMouseMove);
}

// ==================== 音频处理 ====================

async function handleAudioUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const arrayBuffer = await file.arrayBuffer();
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        updateTimeDisplay();
        showStatus(`已加载音频: ${file.name} (${formatTime(getAudioLength())})`);
    } catch (err) {
        showStatus("音频加载失败: " + err.message, "error");
    }
}

function getAudioLength() {
    return audioBuffer ? audioBuffer.duration : 0;
}

function togglePlayback() {
    if (isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (!audioBuffer) {
        showStatus("请先上传音频文件", "warn");
        return;
    }
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.playbackRate.value = playbackSpeed;
    audioSource.connect(audioContext.destination);
    audioSource.start(0, playbackOffset);

    playbackStartTime = audioContext.currentTime - playbackOffset / playbackSpeed;
    isPlaying = true;
    document.getElementById("btn-play").textContent = "⏸";
    updatePlaybackLoop();
}

function pausePlayback() {
    if (audioSource) {
        playbackOffset = (audioContext.currentTime - playbackStartTime) * playbackSpeed;
        audioSource.stop();
        audioSource = null;
    }
    isPlaying = false;
    document.getElementById("btn-play").textContent = "▶";
}

function stopPlayback() {
    if (audioSource) {
        audioSource.stop();
        audioSource = null;
    }
    isPlaying = false;
    playbackOffset = 0;
    scrollY = 0;
    document.getElementById("btn-play").textContent = "▶";
    updateTimeDisplay();
    renderChart();
}

function updatePlaybackLoop() {
    if (!isPlaying) return;

    const currentTime = (audioContext.currentTime - playbackStartTime) * playbackSpeed;
    playbackOffset = currentTime;
    scrollY = Math.max(0, currentTime - 2);

    // 更新时间轴
    const audioLen = getAudioLength();
    const pct = audioLen > 0 ? (currentTime / audioLen) * 100 : 0;
    document.getElementById("timeline-scrubber").value = pct;
    updateTimeDisplay();
    renderChart();

    if (currentTime >= audioLen) {
        stopPlayback();
        return;
    }

    requestAnimationFrame(updatePlaybackLoop);
}

function updateTimeDisplay() {
    const current = playbackOffset;
    const total = getAudioLength();
    document.getElementById("time-display").textContent =
        `${formatTime(current)} / ${formatTime(total)}`;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00.00";
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, "0")}`;
}

// ==================== 谱面渲染 ====================

function getSnapDivision() {
    const sel = document.getElementById("snap-division");
    if (sel.value === "custom") {
        return parseInt(document.getElementById("snap-custom").value) || 4;
    }
    return parseInt(sel.value) || 4;
}

function renderChart() {
    const w = chartCanvas.width / pixelRatio;
    const h = chartCanvas.height / pixelRatio;
    const ctx = chartCtx;

    ctx.clearRect(0, 0, w, h);

    const bpm = chart.meta.bpm;
    const division = getSnapDivision();
    const laneWidth = (w - 80) / LANE_COUNT; // 左侧留80px给时间标签
    const offsetX = 40;

    // 背景
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // 绘制网格（水平 = 时间，垂直 = 轨道）
    const snapStep = getSnapStep(bpm, division);
    const timeStart = scrollY;
    const timeEnd = scrollY + viewHeight;

    // 时间网格线
    ctx.strokeStyle = "#2a2a4a";
    ctx.lineWidth = 1;
    for (let t = Math.ceil(timeStart / snapStep) * snapStep; t <= timeEnd; t += snapStep) {
        const y = timeToY(t, h);
        ctx.beginPath();
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + laneWidth * LANE_COUNT, y);
        ctx.stroke();
    }

    // 小节线（每4拍）
    const beatDuration = 60 / bpm;
    const measureDuration = beatDuration * 4;
    ctx.strokeStyle = "#4a4a6a";
    ctx.lineWidth = 1.5;
    for (let t = Math.ceil(timeStart / measureDuration) * measureDuration; t <= timeEnd; t += measureDuration) {
        const y = timeToY(t, h);
        ctx.beginPath();
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + laneWidth * LANE_COUNT, y);
        ctx.stroke();

        // 小节编号
        ctx.fillStyle = "#888";
        ctx.font = "10px monospace";
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(t / measureDuration) + 1}`, offsetX - 5, y + 3);
    }

    // 绘制轨道
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const x = offsetX + lane * laneWidth;

        // 轨道背景
        ctx.fillStyle = lane >= 1 && lane <= 4 ? "#16213e" : "#0f0f23";
        ctx.fillRect(x, 0, laneWidth, h);

        // 轨道边线（默认 1-4 轨亮，0/5 轨暗）
        const leftEdgeActive = lane === 0 ? false : (lane <= 4);
        const rightEdgeActive = lane >= 1 && lane <= 4;

        drawLaneEdge(ctx, x, 0, h, leftEdgeActive ? "#ffd70066" : "#33333344");
        if (lane === LANE_COUNT - 1) {
            drawLaneEdge(ctx, x + laneWidth, 0, h, rightEdgeActive ? "#ffd70066" : "#33333344");
        }

        // 轨边标签
        ctx.fillStyle = "#666";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(lane, x + laneWidth / 2, 12);
    }

    // 绘制音符
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        for (const note of chart.notes[lane]) {
            if (note.time < timeStart - 1 || note.time > timeEnd + 1) continue;

            const x = offsetX + lane * laneWidth;
            const noteH = Math.max(4, laneWidth * 0.6);

            if (note.type === "hold") {
                const yStart = timeToY(note.time, h);
                const yEnd = timeToY(note.time + note.duration, h);
                const holdH = Math.abs(yStart - yEnd);

                // 长条
                ctx.fillStyle = NOTE_COLORS.hold + "cc";
                ctx.fillRect(x + 2, yEnd, laneWidth - 4, holdH);
                ctx.strokeStyle = "#81c784";
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 2, yEnd, laneWidth - 4, holdH);

                // 头
                ctx.fillStyle = "#81c784";
                ctx.fillRect(x + 2, yStart - 2, laneWidth - 4, noteH);
            } else {
                const y = timeToY(note.time, h);
                ctx.fillStyle = NOTE_COLORS.tap;
                ctx.fillRect(x + 2, y - noteH / 2, laneWidth - 4, noteH);
            }
        }
    }

    // 判定线区域（当前播放位置）
    if (isPlaying && audioBuffer) {
        const playY = timeToY(playbackOffset, h);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(offsetX, playY);
        ctx.lineTo(offsetX + laneWidth * LANE_COUNT, playY);
        ctx.stroke();
    }

    // 时间标尺（顶部）
    ctx.fillStyle = "#0d0d1a";
    ctx.fillRect(0, 0, w, 20);
    for (let t = Math.ceil(timeStart / snapStep) * snapStep; t <= timeEnd; t += snapStep) {
        const y = 20;
        const x = timeToX(t, h, offsetX, laneWidth);
        ctx.fillStyle = "#666";
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(formatTime(t), offsetX + laneWidth * 2.5, 14);
        break; // 简化显示
    }

    // Censor 效果
    renderCensor(ctx, w, h);
}

function drawLaneEdge(ctx, x, y, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
}

function renderCensor(ctx, w, h) {
    const dir = document.getElementById("censor-direction")?.value || "none";
    const intensity = parseInt(document.getElementById("censor-distance")?.value || 0);
    if (dir === "none" || intensity === 0) return;

    const grad = ctx.createLinearGradient(0, 0, 0, h * intensity / 100);
    grad.addColorStop(0, "rgba(0,0,0,0.8)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    if (dir === "top") {
        ctx.fillRect(0, 0, w, h * intensity / 100);
    }
}

function timeToY(time, canvasHeight) {
    // 时间向下流动：上方 = 未来（大时间），下方 = 过去（小时间）
    const progress = (time - scrollY) / viewHeight;
    return canvasHeight - (progress * canvasHeight);
}

function yToTime(y, canvasHeight) {
    const progress = (canvasHeight - y) / canvasHeight;
    return scrollY + progress * viewHeight;
}

function timeToX(time, h, offsetX, laneWidth) {
    return offsetX; // simplified
}

// ==================== 鼠标交互 ====================

function onChartMouseDown(e) {
    const rect = chartCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const laneWidth = (chartCanvas.width / pixelRatio - 80) / LANE_COUNT;
    const offsetX = 40;
    const lane = Math.floor((x - offsetX) / laneWidth);
    if (lane < 0 || lane >= LANE_COUNT) return;

    const time = yToTime(y, chartCanvas.height / pixelRatio);
    const snapTime = snapToGrid(time, chart.meta.bpm, getSnapDivision());

    if (currentTool === "tap") {
        if (findNearestNote(chart, lane, snapTime)) {
            // 已存在则删除
            removeNote(chart, lane, snapTime);
        } else {
            addNote(chart, lane, snapTime, "tap");
        }
        renderChart();
    } else if (currentTool === "hold") {
        holdDrawStart = { lane, time: snapTime };
    } else if (currentTool === "erase") {
        if (removeNote(chart, lane, snapTime)) {
            renderChart();
        }
    }
}

function onChartMouseMove(e) {
    // 长按绘制预览
    if (currentTool === "hold" && holdDrawStart) {
        const rect = chartCanvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const time = yToTime(y, chartCanvas.height / pixelRatio);
        const snapTime = snapToGrid(time, chart.meta.bpm, getSnapDivision());
        // 可以加预览高亮
    }
}

function onChartMouseUp(e) {
    if (currentTool === "hold" && holdDrawStart) {
        const rect = chartCanvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const time = yToTime(y, chartCanvas.height / pixelRatio);
        const snapTime = snapToGrid(time, chart.meta.bpm, getSnapDivision());

        const duration = Math.abs(snapTime - holdDrawStart.time);
        if (duration > 0.01) {
            const startTime = Math.min(holdDrawStart.time, snapTime);
            addNote(chart, holdDrawStart.lane, startTime, "hold", duration);
        }
        holdDrawStart = null;
        renderChart();
    }
}

function onChartWheel(e) {
    e.preventDefault();
    scrollY += e.deltaY * 0.005;
    if (scrollY < 0) scrollY = 0;
    renderChart();
}

// ==================== SV 渲染 ====================

function renderSV() {
    if (!svCanvas || !svCtx) return;
    const w = svCanvas.width / pixelRatio;
    const h = svCanvas.height / pixelRatio;
    const ctx = svCtx;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // 基准线 1.0x
    const baseY = h * 0.5;
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(w, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#666";
    ctx.font = "10px monospace";
    ctx.fillText("1.0x", 5, baseY - 3);
    ctx.fillText("2.0x", 5, 15);
    ctx.fillText("0.5x", 5, h - 5);

    // 绘制 SV 曲线
    ctx.strokeStyle = "#4fc3f7";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (const curve of chart.sv.curves) {
        const x = (curve.time / Math.max(getAudioLength(), 60)) * w;
        const y = baseY - (curve.speed - 1) * (h * 0.4);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 控制点
    for (const curve of chart.sv.curves) {
        const x = (curve.time / Math.max(getAudioLength(), 60)) * w;
        const y = baseY - (curve.speed - 1) * (h * 0.4);
        ctx.fillStyle = "#4fc3f7";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

function onSvMouseDown(e) {
    // TODO: 添加 SV 控制点
}

function onSvMouseMove(e) {
    // TODO: 拖动 SV 控制点
}

// ==================== Camera 渲染 ====================

function renderCamera() {
    if (!cameraCanvas || !cameraCtx) return;
    const w = cameraCanvas.width / pixelRatio;
    const h = cameraCanvas.height / pixelRatio;
    const ctx = cameraCtx;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    const defVal = chart.camera.default;
    const baseY = h * 0.5;

    ctx.strokeStyle = "#444";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(w, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#666";
    ctx.font = "10px monospace";
    ctx.fillText(`${defVal}`, 5, baseY - 3);

    // Camera 曲线
    ctx.strokeStyle = "#ce93d8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (const curve of chart.camera.curves) {
        const x = (curve.time / Math.max(getAudioLength(), 60)) * w;
        const y = baseY - (curve.value - defVal) / defVal * (h * 0.3);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function onCameraMouseDown(e) {
    // TODO: 添加 Camera 控制点
}

function onCameraMouseMove(e) {
    // TODO: 拖动 Camera 控制点
}

// ==================== 保存/导入 ====================

function saveChart() {
    chart.meta.name = document.getElementById("song-name").value || "Untitled";
    chart.meta.artist = document.getElementById("song-artist").value;
    chart.meta.bpm = parseInt(document.getElementById("bpm").value) || 180;

    const json = serializeChart(chart);
    localStorage.setItem("chart-autosave", json);
    showStatus("谱面已保存（本地缓存）");
}

async function handleChartImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        chart = await importChartFile(file);
        document.getElementById("song-name").value = chart.meta.name || "";
        document.getElementById("song-artist").value = chart.meta.artist || "";
        document.getElementById("bpm").value = chart.meta.bpm || 180;
        renderChart();
        renderSV();
        renderCamera();
        showStatus(`已导入谱面: ${chart.meta.name}`);
    } catch (err) {
        showStatus("导入失败: " + err.message, "error");
    }
}

// ==================== 工具函数 ====================

function showStatus(msg, type = "info") {
    // 简单的状态提示
    console.log(`[${type}] ${msg}`);
    // TODO: 可以改成页面内 toast
}

// 自动保存（每30秒）
setInterval(() => {
    if (chart) {
        chart.meta.name = document.getElementById("song-name").value || "Untitled";
        const json = serializeChart(chart);
        localStorage.setItem("chart-autosave", json);
    }
}, 30000);
