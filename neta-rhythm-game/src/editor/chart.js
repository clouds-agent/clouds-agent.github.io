// chart.js - 谱面数据模型 & 序列化

const CHART_VERSION = "1.0.0";

// 默认谱面结构
function createDefaultChart() {
    return {
        version: CHART_VERSION,
        meta: {
            name: "Untitled",
            artist: "",
            composer: "",
            bpm: 180,
            audioFile: null, // base64 encoded audio (optional, for single-file export)
        },
        // Notes 数据: 按轨道分组
        // notes[lane] = [{ time, type, duration?, easing? }]
        notes: [[], [], [], [], [], []], // 0-5 轨
        // SV 数据
        sv: {
            // global SV curve (time-based)
            curves: [], // [{ time, speed, easing, duration }]
        },
        // 轨边亮灭控制
        laneEdges: {
            // 7条边 (0-6)
            // edgeStates[edgeIndex] = [{ time, active, duration, transition }]
            0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [],
        },
        // Camera 数据
        camera: {
            default: 100,
            curves: [], // [{ time, value, easing, duration }]
        },
        // Censor 数据
        censor: {
            curves: [], // [{ time, direction, intensity }]
        },
        // BPM 变化
        bpmChanges: [], // [{ time, bpm }]
    };
}

// 将谱面序列化为 JSON 字符串
function serializeChart(chart) {
    return JSON.stringify(chart, null, 2);
}

// 从 JSON 字符串解析谱面
function deserializeChart(jsonString) {
    try {
        const chart = JSON.parse(jsonString);
        // 校验
        if (!chart.version) throw new Error("缺少 version 字段");
        if (!chart.notes || !Array.isArray(chart.notes)) throw new Error("缺少 notes 字段");
        if (chart.notes.length !== 6) throw new Error("notes 必须是6轨");
        // 补全缺失字段
        if (!chart.meta) chart.meta = createDefaultChart().meta;
        if (!chart.sv) chart.sv = createDefaultChart().sv;
        if (!chart.laneEdges) chart.laneEdges = createDefaultChart().laneEdges;
        if (!chart.camera) chart.camera = createDefaultChart().camera;
        if (!chart.censor) chart.censor = createDefaultChart().censor;
        if (!chart.bpmChanges) chart.bpmChanges = createDefaultChart().bpmChanges;
        return chart;
    } catch (e) {
        throw new Error("谱面解析失败: " + e.message);
    }
}

// 导出为文件下载
function exportChartFile(chart, filename) {
    const json = serializeChart(chart);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `${chart.meta.name || "chart"}.chart.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// 从文件导入
function importChartFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const chart = deserializeChart(reader.result);
                resolve(chart);
            } catch (e) {
                reject(e);
            }
        };
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsText(file);
    });
}

// 保存为单个文件（包含音频 base64）
async function exportChartWithAudio(chart, audioBlob, filename) {
    if (audioBlob) {
        const buffer = await audioBlob.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );
        chart.meta.audioFile = {
            data: base64,
            type: audioBlob.type,
            name: audioBlob.name || "audio",
        };
    }
    exportChartFile(chart, filename);
}

// 计算给定时间点的当前 BPM
function getBPMAtTime(chart, time) {
    let currentBPM = chart.meta.bpm;
    for (const change of chart.bpmChanges) {
        if (change.time <= time) {
            currentBPM = change.bpm;
        }
    }
    return currentBPM;
}

// 计算给定时间点的 SV 倍率
function getSVAtTime(chart, time, lane = null) {
    let currentSV = 1.0;
    const curves = chart.sv.curves;
    for (const curve of curves) {
        if (curve.time <= time) {
            if (lane === null || curve.lane === null || curve.lane === lane) {
                currentSV = curve.speed;
            }
        }
    }
    return currentSV;
}

// 获取音符列表（扁平化，按时间排序）
function getAllNotes(chart) {
    const all = [];
    for (let lane = 0; lane < 6; lane++) {
        for (const note of chart.notes[lane]) {
            all.push({ ...note, lane });
        }
    }
    return all.sort((a, b) => a.time - b.time);
}

// 添加音符
function addNote(chart, lane, time, type, duration = 0) {
    // 检查冲突
    const existing = chart.notes[lane].find(n => Math.abs(n.time - time) < 0.01);
    if (existing) return false; // 已有音符
    chart.notes[lane].push({ time, type, duration: type === "hold" ? duration : 0 });
    chart.notes[lane].sort((a, b) => a.time - b.time);
    return true;
}

// 删除音符
function removeNote(chart, lane, time) {
    const idx = chart.notes[lane].findIndex(n => Math.abs(n.time - time) < 0.02);
    if (idx >= 0) {
        chart.notes[lane].splice(idx, 1);
        return true;
    }
    return false;
}

// 查找最近的音符（用于选择/编辑）
function findNearestNote(chart, lane, time, tolerance = 0.05) {
    for (const note of chart.notes[lane]) {
        if (note.type === "hold") {
            if (Math.abs(note.time - time) < tolerance || 
                (time >= note.time && time <= note.time + note.duration && tolerance > 0.1)) {
                return note;
            }
        } else {
            if (Math.abs(note.time - time) < tolerance) return note;
        }
    }
    return null;
}

// 拍数转秒数
function beatToSeconds(beat, bpm) {
    return (beat / bpm) * 60;
}

// 秒数转拍数
function secondsToBeat(seconds, bpm) {
    return (seconds / 60) * bpm;
}

// 获取网格时间步长
function getSnapStep(bpm, division) {
    const beatDuration = 60 / bpm;
    return beatDuration / division;
}

// 吸附到网格
function snapToGrid(time, bpm, division) {
    const step = getSnapStep(bpm, division);
    return Math.round(time / step) * step;
}
