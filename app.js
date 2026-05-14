// API 配置
const API_BASE = 'https://api.talesofai.cn';

// 状态
let isLiking = false;
let isPaused = false;
let likeStats = { total: 0, byTag: {}, startTime: null, lastIncrease: null };
let likeTimer = null;
let chartData = { labels: [], total: [], byTag: {} };

// ============ 工具函数 ============

function getToken() {
    return localStorage.getItem('neta_token');
}

function saveToken(token) {
    localStorage.setItem('neta_token', token);
}

function clearToken() {
    localStorage.removeItem('neta_token');
}

function getSavedTags() {
    const tags = localStorage.getItem('saved_tags');
    return tags ? JSON.parse(tags) : [];
}

function saveTags(tags) {
    localStorage.setItem('saved_tags', JSON.stringify(tags));
}

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.className = `status ${type}`;
    }
}

function checkToken() {
    if (!getToken()) {
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById('token').classList.add('active');
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.querySelector('[href="#token"]').classList.add('active');
    }
}

// ============ 导航 ============

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.target.getAttribute('href').substring(1);
        
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        e.target.classList.add('active');
        
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(target).classList.add('active');
    });
});

// ============ Token 管理 ============

document.getElementById('save-token').addEventListener('click', () => {
    const token = document.getElementById('token-input').value.trim();
    if (token) {
        saveToken(token);
        showStatus('token-status', '已保存', 'success');
        document.getElementById('token-input').value = '';
        setTimeout(() => {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById('like').classList.add('active');
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            document.querySelector('[href="#like"]').classList.add('active');
        }, 500);
    }
});

document.getElementById('clear-token').addEventListener('click', () => {
    clearToken();
    showStatus('token-status', '已清除', 'success');
});

// ============ 标签搜索联想 ============

let searchDebounce = null;
document.getElementById('tag-search').addEventListener('input', (e) => {
    const keyword = e.target.value.trim();
    clearTimeout(searchDebounce);
    
    if (keyword.length < 1) {
        document.getElementById('tag-suggestions').classList.remove('show');
        return;
    }
    
    searchDebounce = setTimeout(() => searchTags(keyword, 'tag'), 300);
});

async function searchTags(keyword, type) {
    const token = getToken();
    if (!token) return;
    
    const suggestionsEl = document.getElementById(type === 'tag' ? 'tag-suggestions' : 'uuid-suggestions');
    suggestionsEl.innerHTML = '';
    
    try {
        // 搜索活动标签
        const activitiesRes = await fetch(`${API_BASE}/v1/activities`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const activities = await activitiesRes.json();
        const matchedActivities = activities
            .filter(a => a.tag_name && a.tag_name.includes(keyword))
            .slice(0, 5)
            .map(a => ({
                name: a.tag_name,
                type: 'activity',
                popularity: a.popularity,
                posts: a.participants_count || 0,
                uuid: a.uuid
            }));
        
        // 搜索空间标签
        const spacesRes = await fetch(`${API_BASE}/v1/configs/config?namespace=space&key=topic_tags_config`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const spacesData = await spacesRes.json();
        const spacesConfig = JSON.parse(spacesData.value || '{}');
        const matchedSpaces = Object.entries(spacesConfig)
            .filter(([name]) => name.includes(keyword))
            .slice(0, 5)
            .map(([name, config]) => ({
                name: name,
                type: 'space',
                popularity: 0,
                posts: 0,
                description: config.description
            }));
        
        const all = [...matchedActivities, ...matchedSpaces].slice(0, 10);
        
        if (all.length === 0) {
            suggestionsEl.classList.remove('show');
            return;
        }
        
        all.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div class="suggestion-name">${item.name}</div>
                <div class="suggestion-meta">
                    ${item.type === 'activity' ? '🔥 活动' : '📍 空间'}
                    ${item.popularity ? `· 热度：${item.popularity.toLocaleString()}` : ''}
                </div>
            `;
            div.addEventListener('click', () => addTag(item));
            suggestionsEl.appendChild(div);
        });
        
        suggestionsEl.classList.add('show');
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

// 点击外部关闭建议
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
        document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('show'));
    }
});

// ============ 标签管理 ============

function addTag(tag) {
    const tags = getSavedTags();
    if (tags.some(t => t.name === tag.name)) return;
    
    tags.push(tag);
    saveTags(tags);
    renderTags();
    document.getElementById('tag-search').value = '';
    document.getElementById('tag-suggestions').classList.remove('show');
}

function removeTag(name) {
    const tags = getSavedTags().filter(t => t.name !== name);
    saveTags(tags);
    renderTags();
}

function renderTags() {
    const tags = getSavedTags();
    const container = document.getElementById('selected-tags');
    container.innerHTML = tags.map(tag => `
        <div class="tag-item">
            <span>${tag.name}</span>
            <span class="tag-info">${tag.type === 'activity' ? '🔥' : '📍'} ${tag.popularity ? tag.popularity.toLocaleString() : ''}</span>
            <button onclick="removeTag('${tag.name}')">×</button>
        </div>
    `).join('');
}

// ============ 点赞功能 ============

document.getElementById('start-like').addEventListener('click', () => {
    const tags = getSavedTags();
    if (tags.length === 0) {
        alert('请先选择标签');
        return;
    }
    
    if (!getToken()) {
        alert('请先保存 Token');
        return;
    }
    
    isLiking = true;
    isPaused = false;
    likeStats = {
        total: 0,
        byTag: {},
        startTime: Date.now(),
        lastIncrease: Date.now()
    };
    tags.forEach(tag => {
        likeStats.byTag[tag.name] = 0;
        chartData.byTag[tag.name] = [];
    });
    chartData = { labels: [], total: [], byTag: {} };
    
    document.getElementById('start-like').disabled = true;
    document.getElementById('pause-like').disabled = false;
    document.getElementById('like-log').innerHTML = '';
    
    log('开始点赞');
    startLikeLoop(tags);
});

document.getElementById('pause-like').addEventListener('click', () => {
    isPaused = !isPaused;
    document.getElementById('pause-like').textContent = isPaused ? '继续' : '暂停';
    log(isPaused ? '已暂停' : '继续点赞');
});

async function startLikeLoop(tags) {
    while (isLiking && !isPaused) {
        for (const tag of tags) {
            if (!isLiking || isPaused) break;
            
            try {
                const stories = await getStories(tag.name);
                if (stories.length === 0) {
                    log(`#${tag.name} 没有更多作品`, 'error');
                    continue;
                }
                
                for (const story of stories.slice(0, 5)) {
                    if (!isLiking || isPaused) break;
                    
                    const success = await likeStory(story.uuid);
                    if (success) {
                        likeStats.total++;
                        likeStats.byTag[tag.name]++;
                        likeStats.lastIncrease = Date.now();
                        log(`✓ ${tag.name}: ${story.title || '无题'}`, 'success');
                    } else {
                        log(`✗ ${tag.name}: 点赞失败`, 'error');
                    }
                    
                    updateProgress();
                    await new Promise(r => setTimeout(r, 300));
                }
            } catch (error) {
                log(`#${tag.name}: ${error.message}`, 'error');
            }
        }
        
        // 检查是否 1 分钟无增长
        if (Date.now() - likeStats.lastIncrease > 60000) {
            isLiking = false;
            log('⚠️ 1 分钟无增长，已停止', 'error');
            log('可能原因：', 'error');
            log('1. 所有作品都已点过赞');
            log('2. API 调用失败（检查 Token 是否过期）');
            log('3. 请求超时');
            log('');
            log('解决方案：');
            log('1. 更换标签');
            log('2. 重新获取 Token');
            log('3. 稍后再试');
            break;
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    document.getElementById('start-like').disabled = false;
    document.getElementById('pause-like').disabled = true;
    document.getElementById('pause-like').textContent = '暂停';
}

async function getStories(hashtag, page = 0, size = 20) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/v1/hashtag/${encodeURIComponent(hashtag)}/stories?page_index=${page}&page_size=${size}`, {
        headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
    });
    if (!res.ok) throw new Error('获取作品失败');
    const data = await res.json();
    return data.list || [];
}

async function likeStory(uuid) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/v1/interactive/like`, {
        method: 'POST',
        headers: {
            'x-token': token,
            'x-platform': 'nieta-app/web',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ target_type: 'story', target_uuid: uuid })
    });
    return res.ok;
}

function log(message, type = '') {
    const logEl = document.getElementById('like-log');
    const time = new Date().toLocaleTimeString('zh-CN');
    logEl.innerHTML += `<div class="log-item ${type}">[${time}] ${message}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
}

function updateProgress() {
    const elapsed = Math.floor((Date.now() - likeStats.startTime) / 1000);
    const tags = getSavedTags();
    
    let html = `<div class="progress-item"><span>总赞数</span><span>${likeStats.total}</span></div>`;
    html += `<div class="progress-item"><span>运行时间</span><span>${elapsed}s</span></div>`;
    
    tags.forEach(tag => {
        html += `<div class="progress-item"><span>#${tag.name}</span><span>${likeStats.byTag[tag.name] || 0}</span></div>`;
    });
    
    document.getElementById('like-progress').innerHTML = html;
    
    // 更新图表数据
    if (elapsed % 5 === 0) {
        chartData.labels.push(elapsed);
        chartData.total.push(likeStats.total);
        tags.forEach(tag => {
            if (!chartData.byTag[tag.name]) chartData.byTag[tag.name] = [];
            chartData.byTag[tag.name].push(likeStats.byTag[tag.name] || 0);
        });
        renderChart();
    }
}

function renderChart() {
    const chartEl = document.getElementById('like-chart');
    if (chartData.labels.length < 2) {
        chartEl.innerHTML = '<div style="color:#86868b;text-align:center;padding:2rem">数据收集中...</div>';
        return;
    }
    
    const maxVal = Math.max(...chartData.total);
    const height = 150;
    const width = chartEl.clientWidth || 300;
    
    let svg = `<svg width="100%" height="${height + 40}" viewBox="0 0 ${width} ${height + 40}">`;
    
    // 坐标轴
    svg += `<line x1="30" y1="10" x2="30" y2="${height + 10}" stroke="#e5e5e5" />`;
    svg += `<line x1="30" y1="${height + 10}" x2="${width - 10}" y2="${height + 10}" stroke="#e5e5e5" />`;
    
    // 绘制总数线
    const points = chartData.total.map((val, i) => {
        const x = 30 + (i / (chartData.total.length - 1)) * (width - 40);
        const y = height + 10 - (val / maxVal) * height;
        return `${x},${y}`;
    }).join(' ');
    
    svg += `<polyline points="${points}" fill="none" stroke="#0071e3" stroke-width="2" />`;
    
    // 标注
    svg += `<text x="10" y="20" font-size="10" fill="#86868b">${maxVal}</text>`;
    svg += `<text x="10" y="${height + 10}" font-size="10" fill="#86868b">0</text>`;
    
    svg += '</svg>';
    chartEl.innerHTML = svg;
}

// ============ 热度排行 ============

document.getElementById('load-ranking').addEventListener('click', async () => {
    const token = getToken();
    if (!token) {
        alert('请先保存 Token');
        return;
    }
    
    const listEl = document.getElementById('ranking-list');
    listEl.textContent = '加载中...';
    
    try {
        // 获取活动
        const activitiesRes = await fetch(`${API_BASE}/v1/activities`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const activities = await activitiesRes.json();
        
        // 获取空间
        const spacesRes = await fetch(`${API_BASE}/v1/configs/config?namespace=space&key=topic_tags_config`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const spacesData = await spacesRes.json();
        const spacesConfig = JSON.parse(spacesData.value || '{}');
        const spaces = Object.entries(spacesConfig).map(([name, config]) => ({
            tag_name: name,
            popularity: 0,
            participants_count: 0,
            type: 'space'
        }));
        
        // 合并排序
        const all = [
            ...activities.map(a => ({ ...a, type: 'activity' })),
            ...spaces
        ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        
        const top20 = all.slice(0, 20);
        
        listEl.innerHTML = top20.map((item, i) => `
            <div class="ranking-item">
                <div class="ranking-info">
                    <div class="ranking-name" onclick="addTag({name:'${item.tag_name}',type:'${item.type}',popularity:${item.popularity || 0}})">${i + 1}. ${item.tag_name}</div>
                    <div class="ranking-meta">
                        ${item.type === 'activity' ? '🔥 活动' : '📍 空间'}
                        ${item.popularity ? `· 热度：${item.popularity.toLocaleString()}` : ''}
                    </div>
                </div>
                <div class="ranking-hot">${item.popularity ? '🔥 ' + item.popularity.toLocaleString() : '-'}</div>
                <button class="ranking-add" onclick="addTag({name:'${item.tag_name}',type:'${item.type}',popularity:${item.popularity || 0}})">+</button>
            </div>
        `).join('');
    } catch (error) {
        listEl.textContent = '加载失败：' + error.message;
    }
});

// ============ UUID 查询 ============

let uuidDebounce = null;
document.getElementById('uuid-search').addEventListener('input', (e) => {
    const keyword = e.target.value.trim();
    clearTimeout(uuidDebounce);
    
    if (keyword.length < 1) {
        document.getElementById('uuid-suggestions').classList.remove('show');
        return;
    }
    
    uuidDebounce = setTimeout(() => searchUUID(keyword), 300);
});

async function searchUUID(keyword) {
    const token = getToken();
    if (!token) return;
    
    const suggestionsEl = document.getElementById('uuid-suggestions');
    suggestionsEl.innerHTML = '';
    
    try {
        // 搜索角色
        const charRes = await fetch(`${API_BASE}/v2/travel/parent-search?keywords=${encodeURIComponent(keyword)}&page_index=0&page_size=10&parent_type=oc`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const charData = await charRes.json();
        const chars = (charData.list || []).map(c => ({ ...c, searchType: '角色' }));
        
        // 搜索元素
        const elemRes = await fetch(`${API_BASE}/v2/travel/parent-search?keywords=${encodeURIComponent(keyword)}&page_index=0&page_size=10&parent_type=elementum`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        const elemData = await elemRes.json();
        const elems = (elemData.list || []).map(e => ({ ...e, searchType: '元素' }));
        
        const all = [...chars, ...elems].slice(0, 10);
        
        if (all.length === 0) {
            suggestionsEl.classList.remove('show');
            return;
        }
        
        all.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div class="suggestion-name">${item.name}</div>
                <div class="suggestion-meta">${item.searchType} · ${item.uuid}</div>
            `;
            div.addEventListener('click', () => {
                document.getElementById('uuid-result').innerHTML = `
                    <div><strong>名称:</strong> ${item.name}</div>
                    <div><strong>类型:</strong> ${item.searchType}</div>
                    <div><strong>UUID:</strong> <code>${item.uuid}</code></div>
                `;
                suggestionsEl.classList.remove('show');
            });
            suggestionsEl.appendChild(div);
        });
        
        suggestionsEl.classList.add('show');
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

// ============ 初始化 ============

renderTags();
checkToken();

console.log('Neta Tools loaded');
