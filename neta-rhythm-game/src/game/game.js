// game.js - 游戏预览/游玩核心

const GAME = {
    LANE_COUNT: 6,
    DEFAULT_CAMERA: 100,
    JUDGMENT_Y_RATIO: 0.85, // 判定线在画面中的位置（85% 高度处）
    NOTE_HEIGHT_RATIO: 0.06, // 音符高度占画面比例

    // 状态
    chart: null,
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    audioContext: null,
    audioSource: null,
    audioBuffer: null,
    isPlaying: false,
    startTime: 0,
    currentTime: 0,
    speed: 1.0,
    baseScrollSpeed: 400, // 像素/秒（音符下落基础速度）
    animationId: null,

    // 输入
    keys: {},
    touched: {},

    // 渲染参数
    camera: 100,
    censor: { direction: "none", intensity: 0 },
    laneGlow: {}, // 轨道发光状态

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.resize();
        window.addEventListener("resize", () => this.resize());
    },

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);
    },

    async loadChart(chartData, audioBuffer) {
        this.chart = chartData;
        this.audioBuffer = audioBuffer;
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    },

    play() {
        if (!this.audioBuffer) return;
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        this.audioSource = this.audioContext.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;
        this.audioSource.playbackRate.value = this.speed;
        this.audioSource.connect(this.audioContext.destination);
        this.audioSource.start();

        this.startTime = this.audioContext.currentTime;
        this.isPlaying = true;
        this.gameLoop();
    },

    stop() {
        this.isPlaying = false;
        if (this.audioSource) {
            this.audioSource.stop();
            this.audioSource = null;
        }
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
    },

    gameLoop() {
        if (!this.isPlaying) return;

        this.currentTime = (this.audioContext.currentTime - this.startTime) * this.speed;
        this.update();
        this.render();

        this.animationId = requestAnimationFrame(() => this.gameLoop());
    },

    update() {
        // 更新 Camera
        this.updateCamera();
        // 更新 Censor
        this.updateCensor();
        // 更新轨边发光
        this.updateLaneGlow();
    },

    updateCamera() {
        let cam = this.chart.camera.default || this.DEFAULT_CAMERA;
        for (const curve of this.chart.camera.curves) {
            if (curve.time <= this.currentTime) {
                cam = curve.value;
            }
        }
        this.camera = cam;
    },

    updateCensor() {
        let dir = "none";
        let intensity = 0;
        for (const curve of this.chart.censor.curves) {
            if (curve.time <= this.currentTime) {
                dir = curve.direction;
                intensity = curve.intensity;
            }
        }
        this.censor = { direction: dir, intensity };
    },

    updateLaneGlow() {
        // 检查当前时间附近哪些轨道有音符
        const glow = {};
        const lookAhead = 2; // 秒
        for (let lane = 0; lane < this.LANE_COUNT; lane++) {
            const hasNote = this.chart.notes[lane].some(
                n => n.time >= this.currentTime && n.time <= this.currentTime + lookAhead
            );
            glow[lane] = hasNote;
        }
        this.laneGlow = glow;
    },

    render() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // 清空
        ctx.fillStyle = "#0d0d1a";
        ctx.fillRect(0, 0, w, h);

        // Camera 缩放
        const scale = this.DEFAULT_CAMERA / this.camera;
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        ctx.translate(-w / 2, -h / 2);

        const laneWidth = (w * 0.6) / this.LANE_COUNT;
        const startX = w * 0.2;
        const judgmentY = h * this.JUDGMENT_Y_RATIO;
        const scrollPixelsPerSec = this.baseScrollSpeed * this.getCurrentSV();

        // 绘制轨道
        for (let lane = 0; lane < this.LANE_COUNT; lane++) {
            const x = startX + lane * laneWidth;

            // 轨道背景
            ctx.fillStyle = lane >= 1 && lane <= 4 ? "#16213e" : "#0a0a18";
            ctx.fillRect(x, 0, laneWidth, h);

            // 轨道边线
            const edgeColor = this.laneGlow[lane] ? "rgba(255, 215, 0, 0.6)" : "#333";
            const rightEdgeColor = this.laneGlow[lane + 1] !== undefined
                ? (this.laneGlow[lane + 1] ? "rgba(255, 215, 0, 0.6)" : "#333")
                : "#333";

            // 左边线
            ctx.strokeStyle = edgeColor;
            ctx.lineWidth = this.laneGlow[lane] ? 3 : 1;
            if (this.laneGlow[lane]) {
                ctx.shadowColor = "#ffd700";
                ctx.shadowBlur = 8;
            }
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // 右边线
            if (lane === this.LANE_COUNT - 1) {
                ctx.strokeStyle = rightEdgeColor;
                ctx.lineWidth = rightEdgeColor.includes("255, 215, 0") ? 3 : 1;
                if (rightEdgeColor.includes("255, 215, 0")) {
                    ctx.shadowColor = "#ffd700";
                    ctx.shadowBlur = 8;
                }
                ctx.beginPath();
                ctx.moveTo(x + laneWidth, 0);
                ctx.lineTo(x + laneWidth, h);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        }

        // 判定线
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, judgmentY);
        ctx.lineTo(startX + laneWidth * this.LANE_COUNT, judgmentY);
        ctx.stroke();

        // 音符
        const noteH = h * this.NOTE_HEIGHT_RATIO;
        for (let lane = 0; lane < this.LANE_COUNT; lane++) {
            for (const note of this.chart.notes[lane]) {
                const timeDiff = note.time - this.currentTime;
                const sv = this.getCurrentSVForNote(lane, note.time);
                const y = judgmentY - timeDiff * scrollPixelsPerSec * sv;

                // 超出屏幕的跳过
                if (y < -noteH * 2 || y > h + noteH * 2) continue;

                const x = startX + lane * laneWidth;

                if (note.type === "hold") {
                    const endY = judgmentY - (note.time + note.duration - this.currentTime) * scrollPixelsPerSec * sv;
                    const holdTop = Math.min(y, endY);
                    const holdH = Math.abs(y - endY);

                    ctx.fillStyle = "rgba(129, 199, 132, 0.8)";
                    ctx.fillRect(x + 2, holdTop, laneWidth - 4, holdH);
                    ctx.strokeStyle = "#81c784";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 2, holdTop, laneWidth - 4, holdH);
                } else {
                    ctx.fillStyle = "#4fc3f7";
                    ctx.fillRect(x + 2, y - noteH / 2, laneWidth - 4, noteH);
                }
            }
        }

        ctx.restore();

        // Censor 效果（不受 Camera 影响）
        this.renderCensor(ctx, w, h);
    },

    renderCensor(ctx, w, h) {
        if (this.censor.direction === "none" || this.censor.intensity === 0) return;

        const alpha = this.censor.intensity / 100;
        const dir = this.censor.direction;

        ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.9})`;

        if (dir === "top") {
            ctx.fillRect(0, 0, w, h * 0.4 * alpha);
        } else if (dir === "sides") {
            ctx.fillRect(0, 0, w * 0.15 * alpha, h);
            ctx.fillRect(w * (1 - 0.15 * alpha), 0, w * 0.15 * alpha, h);
        } else if (dir === "all") {
            ctx.fillRect(0, 0, w, h * 0.2 * alpha);
            ctx.fillRect(0, h * (1 - 0.2 * alpha), w, h * 0.2 * alpha);
            ctx.fillRect(0, 0, w * 0.1 * alpha, h);
            ctx.fillRect(w * (1 - 0.1 * alpha), 0, w * 0.1 * alpha, h);
        }
    },

    getCurrentSV() {
        let sv = 1.0;
        for (const curve of this.chart.sv.curves) {
            if (curve.time <= this.currentTime && curve.lane === null) {
                sv = curve.speed;
            }
        }
        return sv;
    },

    getCurrentSVForNote(lane, noteTime) {
        let sv = 1.0;
        for (const curve of this.chart.sv.curves) {
            if (curve.time <= noteTime && (curve.lane === null || curve.lane === lane)) {
                sv = curve.speed;
            }
        }
        return sv;
    },
};

// 导出
window.Game = GAME;
