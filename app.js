// API 配置
const API_BASE = 'https://api.talesofai.cn';

// 工具函数
function getToken() {
    return localStorage.getItem('neta_token');
}

function saveToken(token) {
    localStorage.setItem('neta_token', token);
}

function clearToken() {
    localStorage.removeItem('neta_token');
}

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = `status ${type}`;
}

// 导航
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = e.target.getAttribute('href').substring(1);
        
        // 切换导航状态
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        e.target.classList.add('active');
        
        // 切换区块
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(target).classList.add('active');
    });
});

// Token 管理
document.getElementById('save-token').addEventListener('click', () => {
    const token = document.getElementById('token-input').value.trim();
    if (token) {
        saveToken(token);
        showStatus('token-status', '✅ Token 已保存！', 'success');
        document.getElementById('token-input').value = '';
    } else {
        showStatus('token-status', '❌ 请输入 Token', 'error');
    }
});

document.getElementById('clear-token').addEventListener('click', () => {
    clearToken();
    showStatus('token-status', '✅ Token 已清除', 'success');
});

// 检查 Token 状态
function checkTokenStatus() {
    const token = getToken();
    if (token) {
        showStatus('token-status', '✅ Token 已保存', 'success');
    }
}

// 点赞功能
let isLiking = false;
let likeAbort = false;

async function likeStory(storyId) {
    const token = getToken();
    if (!token) {
        log('❌ 请先保存 Token', 'error');
        return false;
    }
    
    try {
        const response = await fetch(`${API_BASE}/v1/interactive/like`, {
            method: 'POST',
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_type: 'story',
                target_uuid: storyId
            })
        });
        
        if (response.ok) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error('点赞失败:', error);
        return false;
    }
}

async function getHashtagStories(hashtag, pageIndex = 0, pageSize = 20) {
    const token = getToken();
    if (!token) {
        return [];
    }
    
    try {
        const response = await fetch(
            `${API_BASE}/v1/hashtag/${encodeURIComponent(hashtag)}/stories?page_index=${pageIndex}&page_size=${pageSize}`,
            {
                headers: {
                    'x-token': token,
                    'x-platform': 'nieta-app/web'
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            return data.list || [];
        }
        return [];
    } catch (error) {
        console.error('获取作品失败:', error);
        return [];
    }
}

function log(message, type = 'info') {
    const logEl = document.getElementById('like-log');
    const time = new Date().toLocaleTimeString('zh-CN');
    const color = type === 'error' ? '#ff6b6b' : '#00ff88';
    logEl.innerHTML += `<div style="color: ${color}">[${time}] ${message}</div>`;
    logEl.scrollTop = logEl.scrollHeight;
}

document.getElementById('start-like').addEventListener('click', async () => {
    const hashtag = document.getElementById('like-hashtag').value.trim();
    const count = parseInt(document.getElementById('like-count').value);
    
    if (!hashtag) {
        alert('请输入标签名称');
        return;
    }
    
    if (!getToken()) {
        alert('请先保存 Token');
        return;
    }
    
    isLiking = true;
    likeAbort = false;
    document.getElementById('like-log').innerHTML = '';
    log(`🚀 开始点赞 #${hashtag}，目标：${count}个`);
    
    let liked = 0;
    let page = 0;
    const pageSize = 20;
    
    while (isLiking && !likeAbort && liked < count) {
        const stories = await getHashtagStories(hashtag, page, pageSize);
        
        if (stories.length === 0) {
            log('⚠️ 没有更多作品了');
            break;
        }
        
        for (const story of stories) {
            if (likeAbort || liked >= count) break;
            
            const success = await likeStory(story.uuid);
            if (success) {
                liked++;
                log(`✅ ${liked}/${count} - ${story.title || '无题'}`);
            } else {
                log(`❌ 点赞失败 - ${story.title || '无题'}`, 'error');
            }
            
            // 避免请求过快
            await new Promise(r => setTimeout(r, 300));
        }
        
        page++;
        
        // 更新进度
        const progress = (liked / count) * 100;
        document.getElementById('like-progress').innerHTML = `
            <div style="margin-bottom: 0.5rem">进度：${liked}/${count} (${progress.toFixed(1)}%)</div>
            <div class="progress-bar" style="width: ${progress}%"></div>
        `;
    }
    
    isLiking = false;
    if (!likeAbort) {
        log(`🎉 完成！共点赞 ${liked} 个`);
    }
});

document.getElementById('stop-like').addEventListener('click', () => {
    likeAbort = true;
    log('⏹️ 已停止点赞');
});

// 标签按钮
document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('like-hashtag').value = btn.dataset.hashtag;
    });
});

// 角色查询
document.getElementById('search-char').addEventListener('click', async () => {
    const name = document.getElementById('char-name').value.trim();
    if (!name) {
        alert('请输入角色名称');
        return;
    }
    
    const token = getToken();
    if (!token) {
        alert('请先保存 Token');
        return;
    }
    
    const resultEl = document.getElementById('char-result');
    resultEl.textContent = '🔍 查询中...';
    
    try {
        const response = await fetch(
            `${API_BASE}/v2/travel/parent-search?keywords=${encodeURIComponent(name)}&page_index=0&page_size=10&parent_type=oc`,
            {
                headers: {
                    'x-token': token,
                    'x-platform': 'nieta-app/web'
                }
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            if (data.list && data.list.length > 0) {
                const chars = data.list.map(c => 
                    `🎭 ${c.name}\n   UUID: \`${c.uuid}\`\n   类型：${c.type}`
                ).join('\n\n');
                resultEl.innerHTML = `<pre>${chars}</pre>`;
            } else {
                resultEl.textContent = '❌ 未找到角色';
            }
        } else {
            resultEl.textContent = '❌ 查询失败';
        }
    } catch (error) {
        resultEl.textContent = '❌ 查询出错：' + error.message;
    }
});

// 标签生成器
document.getElementById('generate-tag').addEventListener('click', () => {
    const role = document.getElementById('tag-role').value.trim();
    const quality = document.getElementById('tag-quality').value.trim();
    const style = document.getElementById('tag-style').value.trim();
    const content = document.getElementById('tag-content').value.trim();
    
    const parts = [];
    if (role) parts.push(role);
    if (quality) parts.push(quality);
    if (style) parts.push(style);
    if (content) parts.push(content);
    
    const result = parts.join('，');
    document.getElementById('tag-result').innerHTML = `<pre>${result}</pre>`;
    
    // 复制到剪贴板
    navigator.clipboard.writeText(result).then(() => {
        alert('✅ 已复制到剪贴板');
    });
});

// 活动热度排行
document.getElementById('load-activities').addEventListener('click', async () => {
    const token = getToken();
    if (!token) {
        alert('请先保存 Token');
        return;
    }
    
    const listEl = document.getElementById('activities-list');
    listEl.textContent = '🔍 加载中...';
    
    try {
        const response = await fetch(`${API_BASE}/v1/activities`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const sorted = data.sort((a, b) => b.popularity - a.popularity);
            
            const html = sorted.slice(0, 20).map((item, i) => `
                <div class="list-item">
                    <div>
                        <strong>${i + 1}. ${item.title}</strong>
                        <div style="color: #888; font-size: 0.9rem">${item.tag_name}</div>
                    </div>
                    <div style="color: #667eea; font-weight: bold">
                        🔥 ${item.popularity.toLocaleString()}
                    </div>
                </div>
            `).join('');
            
            listEl.innerHTML = html;
        } else {
            listEl.textContent = '❌ 加载失败';
        }
    } catch (error) {
        listEl.textContent = '❌ 加载出错：' + error.message;
    }
});

// 初始化
checkTokenStatus();

console.log('🍵 云茗的茶馆 已启动');
