// API 配置
const API_BASE = 'https://api.talesofai.cn';

// 状态
let isRunning = false; // 是否正在运行
let isPaused = false; // 是否暂停
let likeStats = { total: 0, byTag: {}, startTime: null, lastIncrease: null };
let chartData = { labels: [], total: [], byTag: {} };
let userProfile = null;
let tagPageMap = {}; // 每个标签的当前页码
let tagFinished = {}; // 每个标签是否已完成

// ============ 工具函数 ============

function getToken() {
    const token = localStorage.getItem('neta_token');
    console.log('getToken:', token ? '有 Token，长度' + token.length : '无 Token');
    return token;
}

function saveToken(token) {
    console.log('saveToken:', '保存 Token，长度', token.length);
    localStorage.setItem('neta_token', token);
    console.log('验证读取:', localStorage.getItem('neta_token') ? '成功' : '失败');
}

function clearToken() {
    localStorage.removeItem('neta_token');
    userProfile = null;
    
    // 清空点赞状态
    isRunning = false;
    isPaused = false;
    likeStats = { total: 0, byTag: {}, startTime: null, lastIncrease: null };
    chartData = { labels: [], total: [], byTag: {} };
    tagPageMap = {};
    tagFinished = {};
    
    // 清空日志和图表
    const logEl = document.getElementById('like-log');
    const chartEl = document.getElementById('like-chart');
    const progressEl = document.getElementById('like-progress');
    if (logEl) logEl.innerHTML = '';
    if (chartEl) chartEl.innerHTML = '';
    if (progressEl) progressEl.innerHTML = '';
    
    // 停止 Worker
    if (likeWorker) {
        likeWorker.postMessage({ action: 'stop' });
    }
    
    console.log('已清空点赞状态');
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

// ============ 个人主页 ============

function openProfile() {
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.add('show');
    }
}

function closeProfile() {
    const modal = document.getElementById('profile-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function updateProfileUI() {
    if (!userProfile) {
        console.log('没有用户信息，不更新 UI');
        return;
    }
    
    console.log('更新用户界面:', userProfile);
    
    // 更新右上角头像和用户名
    const headerAvatar = document.getElementById('header-avatar');
    const headerName = document.getElementById('header-name');
    const userProfileBtn = document.getElementById('user-profile');
    
    if (userProfileBtn) {
        userProfileBtn.style.display = 'flex';
    }
    
    if (headerAvatar && userProfile.avatar) {
        headerAvatar.src = userProfile.avatar;
        headerAvatar.style.display = 'block';
    }
    
    if (headerName) {
        headerName.textContent = userProfile.name || '-';
    }
    
    // 更新个人主页悬浮窗
    const avatarImg = document.getElementById('profile-avatar-img');
    if (avatarImg && userProfile.avatar) {
        avatarImg.src = userProfile.avatar;
        avatarImg.style.display = 'block';
    }
    
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = userProfile.name || '-';
    
    const followingEl = document.getElementById('profile-following');
    if (followingEl) followingEl.textContent = userProfile.following || 0;
    
    const followersEl = document.getElementById('profile-followers');
    if (followersEl) followersEl.textContent = userProfile.followers || 0;
    
    const energyEl = document.getElementById('profile-energy');
    if (energyEl) energyEl.textContent = (userProfile.energy !== undefined ? userProfile.energy : '-');
}

async function loadUserProfile() {
    const token = getToken();
    if (!token) {
        console.log('没有 Token，无法加载用户信息');
        return null;
    }
    
    try {
        const res = await fetch(`${API_BASE}/v1/user/`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        
        if (!res.ok) {
            console.error('获取用户信息失败:', res.status);
            return null;
        }
        
        const data = await res.json();
        console.log('用户信息:', data);
        
        userProfile = {
            name: data.nick_name || data.name || '用户',
            avatar: data.avatar_url || '',
            following: data.total_subscribes || 0,
            followers: data.total_fans || 0,
            energy: data.ap_info?.ap || 0
        };
        
        updateProfileUI();
        return userProfile;
    } catch (error) {
        console.error('加载用户信息失败:', error);
        return null;
    }
}

// ============ 导航 ============

function setupNavigation() {
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
}

// ============ 登录/登出 ============

function setupLogin() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userProfileBtn = document.getElementById('user-profile');
    
    console.log('setupLogin 执行，getToken:', getToken());
    
    // 检查是否已登录，已登录则关闭登录窗口
    if (getToken()) {
        console.log('已登录，关闭登录窗口');
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
            loginModal.classList.remove('show');
            console.log('登录窗口已关闭');
        }
        updateProfileUI();
    } else {
        console.log('未登录，保持登录窗口显示');
    }
    
    if (loginBtn) {
        console.log('找到登录按钮，绑定事件');
        loginBtn.addEventListener('click', handleLogin);
    } else {
        console.error('找不到登录按钮！');
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            clearToken();
            closeProfile();
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.add('show');
            }
            document.getElementById('token-input').value = '';
            showStatus('login-status', '', '');
            // 隐藏右上角用户信息
            const userProfileBtn = document.getElementById('user-profile');
            if (userProfileBtn) {
                userProfileBtn.style.display = 'none';
            }
        });
    }
    
    if (userProfileBtn) {
        userProfileBtn.addEventListener('click', () => {
            if (!getToken()) {
                const loginModal = document.getElementById('login-modal');
                if (loginModal) {
                    loginModal.classList.add('show');
                }
                return;
            }
            openProfile();
        });
    }
    
    // 拦截需要登录的功能
    setupLoginInterceptor();
}

function setupLoginInterceptor() {
    // 拦截点赞按钮
    const startBtn = document.getElementById('start-like');
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            if (!getToken()) {
                e.preventDefault();
                const loginModal = document.getElementById('login-modal');
                if (loginModal) {
                    loginModal.classList.add('show');
                }
                alert('请先登录');
            }
        }, true);
    }
}

function closeLoginModal() {
    console.log('closeLoginModal 被调用');
    const loginModal = document.getElementById('login-modal');
    if (loginModal) {
        loginModal.classList.remove('show');
        console.log('登录窗口已关闭');
    }
}

// 暴露到全局作用域
window.closeLoginModal = closeLoginModal;

// 记录登录到 Cloudflare Workers
async function logLogin(userInfo) {
    const WORKER_URL = 'https://neta-login-logger.478098075.workers.dev';
    const LOGGER_TOKEN = 'token_clouds199263';
    
    try {
        await fetch(WORKER_URL, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + LOGGER_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uuid: userInfo.uuid,
                nick_name: userInfo.nick_name || userInfo.name,
                user_agent: navigator.userAgent
            })
        });
        console.log('登录记录成功');
    } catch (error) {
        console.error('登录记录失败:', error);
    }
}

async function handleLogin() {
    console.log('handleLogin 被调用');
    const tokenInput = document.getElementById('token-input');
    if (!tokenInput) {
        console.error('找不到 token-input 元素');
        return;
    }
    
    const token = tokenInput.value.trim();
    if (!token) {
        showStatus('login-status', '请输入 Token', 'error');
        console.log('登录失败：Token 为空');
        return;
    }
    
    console.log('尝试登录，Token 长度:', token.length);
    
    try {
        const res = await fetch(`${API_BASE}/v1/user/`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        
        console.log('API 响应状态:', res.status);
        
        if (!res.ok) {
            let errorText = `HTTP ${res.status}`;
            try {
                const errorData = await res.json();
                errorText = errorData.message || errorData.detail || errorText;
            } catch (e) {}
            showStatus('login-status', `登录失败：${errorText}`, 'error');
            return;
        }
        
        const data = await res.json();
        console.log('登录成功，用户数据:', data);
        
        if (!data.id || !data.uuid) {
            showStatus('login-status', 'Token 验证失败：数据不完整', 'error');
            return;
        }
        
        saveToken(token);
        showStatus('login-status', '登录成功', 'success');
        
        // 设置用户信息
        userProfile = {
            name: data.nick_name || data.name || '用户',
            avatar: data.avatar_url || '',
            following: data.total_subscribes || 0,
            followers: data.total_fans || 0,
            energy: data.ap_info?.ap || 0,
            uuid: data.uuid
        };
        
        console.log('用户信息:', userProfile);
        updateProfileUI();
        
        // 记录登录（异步，不阻塞）
        logLogin(userProfile).catch(e => console.error('登录记录失败:', e));
        
        // 关闭登录窗口
        setTimeout(() => {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('show');
            }
        }, 500);
    } catch (error) {
        console.error('登录失败:', error);
        showStatus('login-status', '登录失败：' + error.message, 'error');
    }
}

// ============ 标签搜索联想 ============

async function searchTags(keyword) {
    const token = getToken();
    if (!token) {
        console.log('搜索标签：没有 Token');
        return;
    }
    
    const suggestionsEl = document.getElementById('tag-suggestions');
    if (!suggestionsEl) return;
    
    console.log('搜索标签:', keyword);
    suggestionsEl.innerHTML = '';
    
    try {
        const all = [];
        
        // 搜索活动标签
        try {
            const activitiesRes = await fetch(`${API_BASE}/v1/activities`, {
                headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
            });
            console.log('活动 API 状态:', activitiesRes.status);
            if (activitiesRes.ok) {
                const activities = await activitiesRes.json();
                console.log('活动数量:', activities.length);
                const matched = activities
                    .filter(a => a.tag_name && a.tag_name.includes(keyword))
                    .map(a => ({
                        name: a.tag_name,
                        type: 'activity',
                        popularity: a.popularity || 0,
                        posts: a.participants_count || 0
                    }));
                console.log('匹配的活动:', matched.length);
                all.push(...matched);
            }
        } catch (e) {
            console.error('活动搜索失败:', e);
        }
        
        // 搜索空间标签（宽松匹配：只要包含搜索词中的任意字）
        try {
            const spacesRes = await fetch(`${API_BASE}/v1/configs/config?namespace=space&key=topic_tags_config`, {
                headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
            });
            console.log('空间 API 状态:', spacesRes.status);
            if (spacesRes.ok) {
                const spacesData = await spacesRes.json();
                const spacesConfig = JSON.parse(spacesData.value || '{}');
                console.log('空间配置项数:', Object.keys(spacesConfig).length);
                
                // 宽松匹配：标签名包含搜索词，或搜索词的每个字都出现在标签名中
                const matched = Object.entries(spacesConfig)
                    .filter(([name]) => {
                        // 精确包含
                        if (name.includes(keyword)) return true;
                        // 宽松匹配：搜索词的每个字都出现在标签名中（如"捏捏"匹配"捏 Ta 学院"）
                        if (keyword.length >= 2) {
                            const allCharsMatch = keyword.split('').every(char => name.includes(char));
                            if (allCharsMatch) return true;
                        }
                        return false;
                    })
                    .map(([name, config]) => ({
                        name: name,
                        type: 'space',
                        popularity: 0,
                        posts: 0,
                        description: config.description
                    }));
                console.log('匹配的空间:', matched.length);
                all.push(...matched);
            }
        } catch (e) {
            console.error('空间搜索失败:', e);
        }
        
        // 按热度排序，取前 10 个
        all.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        const top10 = all.slice(0, 10);
        
        console.log('最终结果:', top10.length, '个');
        
        if (top10.length === 0) {
            suggestionsEl.classList.remove('show');
            return;
        }
        
        top10.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div class="suggestion-name">${item.name}</div>
                <div class="suggestion-meta">
                    ${item.type === 'activity' ? '🔥 活动' : '📍 空间'}
                    ${item.popularity ? `· 热度：${item.popularity.toLocaleString()}` : ''}
                    ${item.posts ? `· 帖子：${item.posts.toLocaleString()}` : ''}
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
function setupClickOutside() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box')) {
            document.querySelectorAll('.suggestions').forEach(s => s.classList.remove('show'));
        }
    });
}

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

// 手动添加标签（支持任意标签名）
function addTagManual(tagName) {
    const name = tagName.trim().replace(/^#/, ''); // 去掉 # 前缀
    if (!name) return;
    
    addTag({
        name: name,
        type: 'custom',
        popularity: 0,
        posts: 0
    });
}

function setupTagSearch() {
    const tagSearch = document.getElementById('tag-search');
    const addTagBtn = document.getElementById('add-tag-btn');
    
    if (!tagSearch) return;
    
    let tagDebounce = null;
    
    // 回车添加标签
    tagSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const keyword = tagSearch.value.trim();
            if (keyword) {
                addTagManual(keyword);
            }
        }
    });
    
    // 点击添加按钮
    if (addTagBtn) {
        addTagBtn.addEventListener('click', () => {
            const keyword = tagSearch.value.trim();
            if (keyword) {
                addTagManual(keyword);
            }
        });
    }
    
    // 输入时搜索联想
    tagSearch.addEventListener('input', (e) => {
        const keyword = e.target.value.trim();
        clearTimeout(tagDebounce);
        
        if (keyword.length < 1) {
            document.getElementById('tag-suggestions').classList.remove('show');
            return;
        }
        
        tagDebounce = setTimeout(() => searchTags(keyword), 300);
    });
}

function removeTag(name) {
    const tags = getSavedTags().filter(t => t.name !== name);
    saveTags(tags);
    renderTags();
}

function renderTags() {
    const tags = getSavedTags();
    const container = document.getElementById('selected-tags');
    if (!container) return;
    
    container.innerHTML = tags.map(tag => {
        const currentPage = tagPageMap[tag.name] || 0;
        const canEdit = isPaused && isRunning;
        return `
            <div class="tag-item">
                <span>${tag.name}</span>
                <span class="tag-info">${tag.type === 'activity' ? '🔥' : tag.type === 'space' ? '📍' : '🏷️'} ${tag.popularity ? tag.popularity.toLocaleString() : ''}</span>
                <span class="tag-page">第 <input type="number" class="page-input" data-tag="${tag.name}" value="${currentPage}" min="0" ${canEdit ? '' : 'disabled'} /> 页</span>
                <button onclick="removeTag('${tag.name}')">×</button>
            </div>
        `;
    }).join('');
    
    // 绑定页码输入框事件
    if (isPaused && isRunning) {
        document.querySelectorAll('.page-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const tagName = e.target.dataset.tag;
                const newPage = parseInt(e.target.value) || 0;
                tagPageMap[tagName] = newPage;
                
                // 通知 Worker
                if (likeWorker) {
                    likeWorker.postMessage({
                        action: 'updatePage',
                        payload: { tag: tagName, page: newPage }
                    });
                }
                
                log(`标签 #${tagName} 起始页改为第 ${newPage} 页`, 'success');
            });
        });
    }
}

// ============ 点赞功能 ============

// Worker 相关
let likeWorker = null;

function initWorker() {
    if (window.Worker) {
        likeWorker = new Worker('like-worker.js');
        likeWorker.onmessage = handleWorkerMessage;
        console.log('Worker 已初始化');
    } else {
        console.log('浏览器不支持 Worker，使用传统模式');
    }
}

function handleWorkerMessage(e) {
    const { type, message, level, stats, currentPage, tag, page } = e.data;
    
    switch (type) {
        case 'log':
            log(message, level);
            break;
        case 'progress':
            likeStats = stats;
            updateProgress(currentPage);
            break;
        case 'paused':
            log('已暂停', 'error');
            break;
        case 'resumed':
            log('继续点赞', 'success');
            break;
        case 'stopped':
            log('已终止', 'error');
            resetUI();
            break;
        case 'finished':
            likeStats = stats;
            log('所有标签已完成', 'success');
            resetUI();
            break;
        case 'pageUpdated':
            log(`标签 #${tag} 起始页改为第 ${page} 页`, 'success');
            break;
    }
}

function resetUI() {
    isRunning = false;
    isPaused = false;
    const startBtn = document.getElementById('start-like');
    const pauseBtn = document.getElementById('pause-like');
    if (startBtn) {
        startBtn.textContent = '开始';
        startBtn.disabled = false;
    }
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.textContent = '暂停';
    }
    renderTags();
}

function setupLikeButtons() {
    const startBtn = document.getElementById('start-like');
    const pauseBtn = document.getElementById('pause-like');
    
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (isRunning) {
                // 正在运行，点击是"终止"
                stopLiking();
            } else {
                // 未运行，点击是"开始"
                startLiking();
            }
        });
    }
    
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (!isRunning) return;
            
            isPaused = !isPaused;
            pauseBtn.textContent = isPaused ? '继续' : '暂停';
            
            if (likeWorker) {
                likeWorker.postMessage({
                    action: isPaused ? 'pause' : 'resume'
                });
            }
            
            if (isPaused) {
                log('已暂停', 'error');
                renderTags(); // 暂停时重新渲染，启用页码编辑
            } else {
                log('继续点赞', 'success');
                renderTags(); // 继续时重新渲染，禁用页码编辑
            }
        });
    }
}

function startLiking() {
    const tags = getSavedTags();
    if (tags.length === 0) {
        alert('请先选择标签');
        return;
    }
    
    const token = getToken();
    if (!token) {
        alert('请先登录');
        return;
    }
    
    isRunning = true;
    isPaused = false;
    likeStats = {
        total: 0,
        byTag: {},
        startTime: Date.now(),
        lastIncrease: Date.now()
    };
    tagPageMap = {};
    tagFinished = {};
    tags.forEach(tag => {
        likeStats.byTag[tag.name] = 0;
        tagFinished[tag.name] = false;
    });
    chartData = { labels: [], total: [], byTag: {} };
    tags.forEach(tag => {
        chartData.byTag[tag.name] = [];
    });
    
    const startBtn = document.getElementById('start-like');
    const pauseBtn = document.getElementById('pause-like');
    if (startBtn) {
        startBtn.textContent = '终止';
        startBtn.disabled = false;
    }
    if (pauseBtn) pauseBtn.disabled = false;
    
    const logEl = document.getElementById('like-log');
    if (logEl) logEl.innerHTML = '';
    
    log('开始点赞', 'success');
    
    // 使用 Worker 运行
    if (likeWorker) {
        likeWorker.postMessage({
            action: 'start',
            payload: {
                token: token,
                tags: tags,
                tagPageMap: {},
                tagFinished: {},
                likeStats: likeStats
            }
        });
    } else {
        // 降级：传统模式
        startLikeLoop(tags);
    }
}

function stopLiking() {
    isRunning = false;
    isPaused = false;
    
    if (likeWorker) {
        likeWorker.postMessage({ action: 'stop' });
    }
    
    const startBtn = document.getElementById('start-like');
    const pauseBtn = document.getElementById('pause-like');
    if (startBtn) {
        startBtn.textContent = '开始';
        startBtn.disabled = false;
    }
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.textContent = '暂停';
    }
    
    log('已终止', 'error');
}

async function startLikeLoop(tags) {
    // 初始化页码
    tags.forEach(tag => {
        if (tagPageMap[tag.name] === undefined) {
            tagPageMap[tag.name] = 0;
        }
    });
    
    while (isRunning) {
        // 暂停时等待
        if (isPaused) {
            await new Promise(r => setTimeout(r, 500));
            continue;
        }
        
        for (const tag of tags) {
            if (!isRunning) break;
            if (isPaused) break;
            
            // 如果这个标签已经完成，跳过
            if (tagFinished[tag.name]) continue;
            
            try {
                const currentPage = tagPageMap[tag.name] || 0;
                const stories = await getStories(tag.name, currentPage, 10);
                
                // 添加延迟，避免 API 限流
                await new Promise(r => setTimeout(r, 200));
                
                if (stories.length === 0) {
                    // 当前页没有作品，标记这个标签完成
                    tagFinished[tag.name] = true;
                    log(`#${tag.name} 已遍历完所有作品（第 ${currentPage} 页）`, 'error');
                    
                    // 检查是否所有标签都完成了
                    const allFinished = tags.every(t => tagFinished[t.name]);
                    if (allFinished) {
                        isRunning = false;
                        log('所有标签已完成', 'success');
                        stopLiking();
                        return;
                    }
                    continue;
                }
                
                let successCount = 0;
                for (const story of stories) {
                    if (!isRunning) break;
                    if (isPaused) break;
                    
                    const result = await likeStory(story.storyId);
                    if (result.success) {
                        likeStats.total++;
                        likeStats.byTag[tag.name]++;
                        likeStats.lastIncrease = Date.now();
                        log(`✓ ${tag.name}: ${story.title || '无题'}`, 'success');
                        successCount++;
                    } else {
                        log(`✗ ${tag.name}: ${result.error}`, 'error');
                    }
                    
                    updateProgress();
                    await new Promise(r => setTimeout(r, 200));
                }
                
                // 无论成功失败，都翻到下一页
                tagPageMap[tag.name] = currentPage + 1;
                log(`#${tag.name} 第${currentPage + 1}页处理完成，翻到第${currentPage + 2}页`);
            } catch (error) {
                log(`#${tag.name}: ${error.message}`, 'error');
            }
        }
        
        // 检查是否所有标签都 1 分钟无增长
        const unfinishedTags = tags.filter(t => !tagFinished[t.name]);
        if (unfinishedTags.length === 0) {
            // 所有标签都完成了
            isRunning = false;
            log('所有标签已完成', 'success');
            stopLiking();
            break;
        }
        
        if (Date.now() - likeStats.lastIncrease > 60000) {
            isRunning = false;
            log('⚠️ 1 分钟无增长，已停止', 'error');
            log('请检查：Token 是否有效、标签是否有新作品', 'error');
            stopLiking();
            break;
        }
        
        await new Promise(r => setTimeout(r, 1000));
    }
    
    // 真正结束时重置按钮
    isRunning = false;
    const startBtn = document.getElementById('start-like');
    const pauseBtn = document.getElementById('pause-like');
    if (startBtn) {
        startBtn.textContent = '开始';
        startBtn.disabled = false;
    }
    if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.textContent = '暂停';
    }
}

async function getStories(hashtag, page = 0, size = 10) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/v1/hashtag/${encodeURIComponent(hashtag)}/stories?page_index=${page}&page_size=${size}`, {
        headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
    });
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const list = data.list || [];
    console.log('获取作品:', hashtag, '页码', page, '返回', list.length, '个');
    // 返回 storyId 字段
    return list.map(item => ({
        storyId: item.storyId,
        title: item.name,
        likeCount: item.likeCount,
        user_nick_name: item.user_nick_name
    }));
}

async function likeStory(uuid) {
    const token = getToken();
    if (!token) {
        return { success: false, error: '未登录' };
    }
    
    if (!uuid) {
        return { success: false, error: '作品 ID 为空' };
    }
    
    console.log('点赞故事:', uuid);
    
    try {
        const res = await fetch(`${API_BASE}/v1/story/story-like`, {
            method: 'PUT',
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ storyId: uuid, is_cancel: false })
        });
        
        console.log('点赞响应状态:', res.status);
        
        if (res.ok) {
            return { success: true };
        }
        
        // 获取详细错误
        let errorText = `HTTP ${res.status}`;
        try {
            const errorData = await res.json();
            errorText = errorData.message || errorData.detail || errorText;
            console.log('点赞错误详情:', errorText);
        } catch (e) {
            console.log('无法解析错误响应');
        }
        
        return { success: false, error: errorText, status: res.status };
    } catch (error) {
        console.error('点赞异常:', error);
        return { success: false, error: error.message || '网络错误' };
    }
}

function log(message, type = '') {
    const logEl = document.getElementById('like-log');
    if (!logEl) return;
    const time = new Date().toLocaleTimeString('zh-CN');
    logEl.innerHTML += `<div class="log-item ${type}">[${time}] ${message}</div>`;
    
    // 限制只显示最新 100 条，避免卡顿
    const items = logEl.querySelectorAll('.log-item');
    if (items.length > 100) {
        items[0].remove();
    }
    
    logEl.scrollTop = logEl.scrollHeight;
}

function updateProgress() {
    const elapsed = Math.floor((Date.now() - likeStats.startTime) / 1000);
    const tags = getSavedTags();
    
    const progressEl = document.getElementById('like-progress');
    if (!progressEl) return;
    
    let html = `<div class="progress-item"><span>总赞数</span><span>${likeStats.total}</span></div>`;
    html += `<div class="progress-item"><span>运行时间</span><span>${elapsed}s</span></div>`;
    
    tags.forEach(tag => {
        html += `<div class="progress-item"><span>#${tag.name}</span><span>${likeStats.byTag[tag.name] || 0}</span></div>`;
    });
    
    progressEl.innerHTML = html;
    
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
    if (!chartEl) return;
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

function setupRanking() {
    const loadBtn = document.getElementById('load-ranking');
    if (loadBtn) {
        loadBtn.addEventListener('click', loadRanking);
    }
}

async function loadRanking() {
    const token = getToken();
    if (!token) {
        alert('请先登录');
        return;
    }
    
    const listEl = document.getElementById('ranking-list');
    if (!listEl) return;
    
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
        
        // 获取每个空间的帖子数量作为热度
        const spacesWithPosts = await Promise.all(
            Object.entries(spacesConfig).map(async ([name, config]) => {
                try {
                    const res = await fetch(`${API_BASE}/v1/hashtag/${encodeURIComponent(name)}/stories?page_index=0&page_size=1`, {
                        headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const total = data.total || 0;
                        return {
                            tag_name: name,
                            popularity: total,
                            participants_count: total,
                            type: 'space',
                            description: config.description
                        };
                    }
                } catch (e) {
                    console.error('获取空间热度失败:', name, e);
                }
                return {
                    tag_name: name,
                    popularity: 0,
                    participants_count: 0,
                    type: 'space',
                    description: config.description
                };
            })
        );
        
        // 合并排序
        const all = [
            ...activities.map(a => ({ ...a, type: 'activity' })),
            ...spacesWithPosts
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
}

// ============ UUID 查询 ============

let uuidDebounce = null;
function setupUUIDSearch() {
    const uuidSearch = document.getElementById('uuid-search');
    if (!uuidSearch) return;
    
    console.log('UUID 搜索初始化完成');
    
    uuidSearch.addEventListener('input', (e) => {
        const keyword = e.target.value.trim();
        clearTimeout(uuidDebounce);
        
        console.log('UUID 搜索输入:', keyword);
        
        if (keyword.length < 1) {
            document.getElementById('uuid-suggestions').classList.remove('show');
            return;
        }
        
        // 100ms 就开始搜索，更快响应
        uuidDebounce = setTimeout(() => {
            console.log('开始 UUID 搜索:', keyword);
            searchUUID(keyword);
        }, 100);
    });
}

async function searchUUID(keyword) {
    const token = getToken();
    if (!token) {
        console.log('UUID 搜索：没有 Token');
        return;
    }
    
    const suggestionsEl = document.getElementById('uuid-suggestions');
    if (!suggestionsEl) {
        console.log('UUID 搜索：suggestions 元素不存在');
        return;
    }
    
    console.log('开始搜索 UUID:', keyword);
    suggestionsEl.innerHTML = '';
    
    if (keyword.length < 1) {
        suggestionsEl.classList.remove('show');
        return;
    }
    
    try {
        const all = [];
        
        // 搜索角色（20 个）
        try {
            const charUrl = `${API_BASE}/v2/travel/parent-search?keywords=${encodeURIComponent(keyword)}&page_index=0&page_size=20&parent_type=oc&sort_scheme=exact`;
            console.log('角色搜索 URL:', charUrl);
            const charRes = await fetch(charUrl, {
                headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
            });
            console.log('角色 API 状态:', charRes.status);
            if (charRes.ok) {
                const charData = await charRes.json();
                console.log('角色搜索结果:', charData.list?.length || 0);
                const chars = (charData.list || []).map(c => ({ ...c, searchType: '角色' }));
                all.push(...chars);
            }
        } catch (e) {
            console.error('角色搜索失败:', e);
        }
        
        // 搜索元素（20 个）
        try {
            const elemUrl = `${API_BASE}/v2/travel/parent-search?keywords=${encodeURIComponent(keyword)}&page_index=0&page_size=20&parent_type=elementum&sort_scheme=exact`;
            console.log('元素搜索 URL:', elemUrl);
            const elemRes = await fetch(elemUrl, {
                headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
            });
            console.log('元素 API 状态:', elemRes.status);
            if (elemRes.ok) {
                const elemData = await elemRes.json();
                console.log('元素搜索结果:', elemData.list?.length || 0);
                const elems = (elemData.list || []).map(e => ({ ...e, searchType: '元素' }));
                all.push(...elems);
            }
        } catch (e) {
            console.error('元素搜索失败:', e);
        }
        
        // 按热度排序（如果有 popularity 字段）
        all.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        const top20 = all.slice(0, 20);
        
        console.log('UUID 搜索最终结果:', top20.length, '个');
        
        if (top20.length === 0) {
            suggestionsEl.classList.remove('show');
            return;
        }
        
        top20.forEach(item => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerHTML = `
                <div class="suggestion-name">${item.name}</div>
                <div class="suggestion-meta">${item.searchType} · ${item.uuid}</div>
            `;
            div.addEventListener('click', () => {
                const resultEl = document.getElementById('uuid-result');
                if (resultEl) {
                    resultEl.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                            <div><strong>名称:</strong> ${item.name}</div>
                            <button class="btn-copy-uuid" data-uuid="${item.uuid}">复制</button>
                        </div>
                        <div><strong>类型:</strong> ${item.searchType}</div>
                        <div><strong>UUID:</strong> <code>${item.uuid}</code></div>
                    `;
                    
                    // 绑定复制按钮
                    const copyBtn = resultEl.querySelector('.btn-copy-uuid');
                    if (copyBtn) {
                        copyBtn.addEventListener('click', async () => {
                            try {
                                await navigator.clipboard.writeText(item.uuid);
                                copyBtn.textContent = '✓ 已复制';
                                setTimeout(() => copyBtn.textContent = '复制', 2000);
                            } catch (e) {
                                copyBtn.textContent = '复制失败';
                            }
                        });
                    }
                }
                suggestionsEl.classList.remove('show');
            });
            suggestionsEl.appendChild(div);
        });
        
        suggestionsEl.classList.add('show');
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

// ============ 热门标签 ============

async function loadHotTags() {
    const token = getToken();
    if (!token) return;
    
    const container = document.getElementById('hot-tags');
    if (!container) return;
    
    try {
        // 从活动列表获取热门标签
        const activitiesRes = await fetch(`${API_BASE}/v1/activities`, {
            headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
        });
        
        if (!activitiesRes.ok) return;
        
        const activities = await activitiesRes.json();
        
        // 按热度排序，取前 15 个
        const hotTags = activities
            .filter(a => a.popularity && a.popularity > 10000)
            .sort((a, b) => b.popularity - a.popularity)
            .slice(0, 15);
        
        // 添加常用用户标签
        const commonTags = [
            { name: '捏捏', popularity: 999999 },
            { name: '捏捏茶馆', popularity: 888888 },
            { name: 'OC', popularity: 777777 },
            { name: '原创', popularity: 666666 }
        ];
        
        const allTags = [...commonTags, ...hotTags.map(a => ({ name: a.tag_name, popularity: a.popularity }))];
        
        container.innerHTML = allTags.map(tag => `
            <div class="hot-tag-item" data-name="${tag.name}">
                <span class="fire">🔥</span>
                <span>${tag.name}</span>
            </div>
        `).join('');
        
        // 绑定点击事件
        container.querySelectorAll('.hot-tag-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.getAttribute('data-name');
                addTagManual(name);
            });
        });
    } catch (error) {
        console.error('加载热门标签失败:', error);
    }
}

// ============ 签到 ============

function setupCheckin() {
    const checkinBtn = document.getElementById('checkin-btn');
    const autoCheckinToggle = document.getElementById('auto-checkin-toggle');
    
    if (checkinBtn) {
        checkinBtn.addEventListener('click', async () => {
            const token = getToken();
            if (!token) {
                showStatus('checkin-status', '请先登录', 'error');
                return;
            }
            
            checkinBtn.disabled = true;
            checkinBtn.textContent = '签到中...';
            
            try {
                const res = await fetch(`${API_BASE}/v1/checkin/manual`, {
                    method: 'POST',
                    headers: {
                        'x-token': token,
                        'x-platform': 'nieta-app/web'
                    }
                });
                
                if (res.ok) {
                    showStatus('checkin-status', '✓ 签到成功', 'success');
                } else {
                    const data = await res.json();
                    showStatus('checkin-status', '签到失败：' + (data.message || '未知错误'), 'error');
                }
            } catch (error) {
                showStatus('checkin-status', '签到失败：' + error.message, 'error');
            } finally {
                checkinBtn.disabled = false;
                checkinBtn.textContent = '签到';
            }
        });
    }
    
    // 定时签到开关
    if (autoCheckinToggle) {
        // 加载保存的状态
        const saved = localStorage.getItem('auto_checkin');
        if (saved === 'true') {
            autoCheckinToggle.checked = true;
        }
        
        autoCheckinToggle.addEventListener('change', async () => {
            const enabled = autoCheckinToggle.checked;
            localStorage.setItem('auto_checkin', enabled);
            
            if (enabled) {
                // 开启定时签到 - 需要配置 GitHub Actions
                const token = getToken();
                if (!token) {
                    alert('请先登录');
                    autoCheckinToggle.checked = false;
                    return;
                }
                
                // 提示用户去配置
                const confirmed = confirm(
                    '开启定时签到需要配置 GitHub Actions。\n\n' +
                    '是否跳转到配置页面？'
                );
                
                if (confirmed) {
                    // 创建/更新 workflow 文件
                    await setupGitHubActions(token);
                } else {
                    autoCheckinToggle.checked = false;
                    localStorage.setItem('auto_checkin', 'false');
                }
            } else {
                // 关闭定时签到
                showStatus('checkin-status', '已关闭定时签到', 'success');
            }
        });
    }
}

async function setupGitHubActions(token) {
    const repo = 'clouds-agent/clouds-agent.github.io';
    
    // 检查 workflow 是否存在
    try {
        // 这里需要调用 GitHub API 来创建/更新 workflow
        // 由于需要额外的 GitHub Token，我们改为指导用户手动配置
        
        const workflowContent = `name: 每日签到

on:
  schedule:
    # 每天 0:01 中国时区 (UTC 16:01)
    - cron: '1 16 * * *'
  workflow_dispatch:

jobs:
  checkin:
    runs-on: ubuntu-latest
    steps:
      - name: 签到
        run: |
          curl -X POST "https://api.talesofai.cn/v1/checkin/manual" \\
            -H "x-token: \${{ secrets.NETA_TOKEN }}" \\
            -H "x-platform: nieta-app/web"
`;
        
        // 显示配置说明
        alert(
            '请按以下步骤配置定时签到：\n\n' +
            '1. 打开仓库：https://github.com/' + repo + '/settings/secrets/actions\n' +
            '2. 点击 "New repository secret"\n' +
            '3. 添加 Secret：\n' +
            '   Name: NETA_TOKEN\n' +
            '   Value: 你的 Token（已自动复制）\n\n' +
            '4. 打开：https://github.com/' + repo + '/actions/new-workflow\n' +
            '5. 选择 "set up a workflow yourself"\n' +
            '6. 粘贴以下内容：\n\n' + workflowContent +
            '\n7. 点击 "Commit changes"\n\n' +
            '配置完成后，每天 0:01 会自动签到！'
        );
        
        // 复制 Token 到剪贴板
        try {
            await navigator.clipboard.writeText(token);
        } catch (e) {
            console.log('无法自动复制 Token，请手动复制');
        }
        
    } catch (error) {
        console.error('配置失败:', error);
        alert('配置失败：' + error.message);
    }
}

// ============ 数据统计 ============

let currentStatsType = 'fans'; // 当前统计类型：fans, like, inherit
let statsChart = null; // Chart.js 实例

// 按日期分组统计
function groupByDate(list, dateField = 'ctime') {
    const stats = {};
    list.forEach(item => {
        const date = item[dateField].split(' ')[0]; // "2026-05-16"
        if (!stats[date]) stats[date] = 0;
        stats[date]++;
    });
    return stats;
}

// 获取指定天数的数据
function filterByRange(list, days, dateField = 'ctime') {
    if (days === 'all') return list;
    
    // API 返回的是中国时间字符串 "2026-05-15 21:07:43"
    // 我们直接按字符串比较日期部分（YYYY-MM-DD）
    const now = new Date();
    // 获取当前中国时间的日期字符串
    const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayStr = chinaNow.toISOString().split('T')[0]; // "2026-05-16"
    
    const cutoffDays = parseInt(days);
    const cutoffDate = new Date(chinaNow);
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
    cutoffDate.setHours(0, 0, 0, 0);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]; // "2026-05-15"
    
    return list.filter(item => {
        // 直接比较日期字符串 "2026-05-15" >= "2026-05-15"
        const itemDateStr = item[dateField].split(' ')[0]; // "2026-05-15"
        return itemDateStr >= cutoffStr;
    });
}

// 加载统计数据
// 加载统计数据（优化：按时间范围提前停止）
async function loadStatsData(type, days) {
    const token = getToken();
    if (!token) {
        alert('请先登录');
        return null;
    }
    
    let section;
    if (type === 'fans') section = 'SEC_SUBSCRIBE';
    else if (type === 'like') section = 'SEC_LIKE';
    else if (type === 'inherit') section = 'SEC_INTERACTS';
    
    // 计算截止日期（用于提前停止）- 使用中国时间
    let cutoffDate = null;
    let cutoffStr = null;
    if (days !== 'all') {
        const now = new Date();
        const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000); // UTC+8
        cutoffDate = new Date(chinaNow);
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
        cutoffDate.setHours(0, 0, 0, 0);
        cutoffStr = cutoffDate.toISOString().split('T')[0]; // "2026-05-15"
        console.log(`截止日期字符串：${cutoffStr}`);
    }
    
    try {
        const allData = [];
        let pageIndex = 1;
        let hasMore = true;
        let apiTotal = 0;
        
        console.log(`开始加载 ${type} 数据，section=${section}, days=${days}`);
        if (cutoffDate) {
            console.log(`截止日期：${cutoffDate.toISOString()}`);
        }
        
        while (hasMore && pageIndex <= 500) {
            const url = `${API_BASE}/v1/message/message-list?section=${section}&page_index=${pageIndex}&page_size=100`;
            
            const res = await fetch(url, {
                headers: {
                    'x-token': token,
                    'x-platform': 'nieta-app/web',
                    'x-app-bundle-version': '6.11.5',
                    'x-nieta-app-version': '6.11.5',
                    'x-teen-mode': '0',
                    'device-id': '7545220721081910273'
                }
            });
            
            if (!res.ok) {
                console.error(`请求失败：${res.status}`);
                break;
            }
            
            const data = await res.json();
            
            if (pageIndex === 1) {
                apiTotal = data.total || 0;
                console.log(`API 返回总数：${apiTotal}`);
            }
            
            if (!data.list || data.list.length === 0) {
                hasMore = false;
                break;
            }
            
            // 过滤数据
            let filtered = data.list;
            if (type === 'inherit') {
                filtered = filtered.filter(item => item.action_type === 'inherit');
            }
            
            allData.push(...filtered);
            
            // 检查最后一条数据的时间
            if (filtered.length > 0) {
                const lastItem = filtered[filtered.length - 1];
                const lastDateStr = lastItem.ctime.split(' ')[0]; // "2026-05-15"
                console.log(`第 ${pageIndex} 页最后一条：${lastItem.ctime}`);
                
                // 如果早于截止日期，停止获取（字符串比较）
                if (cutoffStr && lastDateStr < cutoffStr) {
                    console.log(`已到达截止日期，停止获取`);
                    hasMore = false;
                }
            }
            
            // 如果获取的数据少于 page_size，说明是最后一页
            if (data.list.length < 100) {
                hasMore = false;
            }
            
            pageIndex++;
            
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.log(`总共获取 ${allData.length} 条数据`);
        
        // 按时间倒序排序（确保最新数据在前面）
        allData.sort((a, b) => {
            return b.ctime.localeCompare(a.ctime);
        });
        
        // 调试：打印第一条和最后一条数据的时间
        if (allData.length > 0) {
            console.log(`最新数据时间：${allData[0].ctime}`);
            console.log(`最旧数据时间：${allData[allData.length - 1].ctime}`);
        }
        
        // 按时间范围过滤
        const filteredData = filterByRange(allData, days);
        console.log(`过滤后剩余 ${filteredData.length} 条数据`);
        console.log(`时间范围：最近${days === 'all' ? '全部' : days + '天'}, cutoffStr=${cutoffStr}`);
        
        // 如果过滤后为 0，显示警告
        if (allData.length > 0 && filteredData.length === 0) {
            console.warn(`⚠️ 所有数据都被过滤掉了！最新数据是${allData[0].ctime.split(' ')[0]}，早于截止日期${cutoffStr}`);
        }
        
        return {
            total: filteredData.length,
            allTotal: apiTotal,
            list: filteredData,
            byDate: groupByDate(filteredData)
        };
    } catch (error) {
        console.error('加载统计数据失败:', error);
        return null;
    }
}

// 渲染统计图表（Chart.js 折线图）
function renderStatsChart(stats, type) {
    const ctx = document.getElementById('stats-chart');
    if (!ctx || !stats || !stats.byDate) return;
    
    // 销毁旧图表
    if (statsChart) {
        statsChart.destroy();
    }
    
    const dates = Object.keys(stats.byDate).sort();
    const values = dates.map(d => stats.byDate[d]);
    
    // 颜色配置
    const colors = {
        fans: { border: '#667eea', bg: 'rgba(102, 126, 234, 0.1)' },
        like: { border: '#f5576c', bg: 'rgba(245, 87, 108, 0.1)' },
        inherit: { border: '#00f2fe', bg: 'rgba(0, 242, 254, 0.1)' }
    };
    
    const color = colors[type] || colors.fans;
    
    statsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates.map(d => d.slice(5)), // "05-16"
            datasets: [{
                label: type === 'fans' ? '新增粉丝' : (type === 'like' ? '获赞数' : '捏同款数'),
                data: values,
                borderColor: color.border,
                backgroundColor: color.bg,
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 5,
                pointHoverRadius: 10,
                pointBackgroundColor: color.border,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointHitRadius: 30 // 增大点击范围
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: window.devicePixelRatio || 1,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `数量：${context.parsed.y}`;
                        },
                        title: function(items) {
                            const index = items[0].dataIndex;
                            const fullDate = dates[index];
                            return fullDate;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: '#86868b',
                        font: { size: 12 }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        color: '#86868b',
                        font: { size: 11 },
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8
                    },
                    grid: {
                        display: false
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// 渲染统计摘要
function renderStatsSummary(stats, type) {
    const summaryEl = document.getElementById('stats-summary');
    if (!summaryEl || !stats) return;
    
    const typeLabel = type === 'fans' ? '粉丝' : (type === 'like' ? '点赞' : '捏同款');
    const classPrefix = type === 'fans' ? '' : (type === 'like' ? 'like' : 'inherit');
    
    // 计算日均
    const dateCount = Object.keys(stats.byDate).length || 1;
    const avgPerDay = (stats.total / dateCount).toFixed(1);
    
    summaryEl.innerHTML = `
        <div class="stat-card ${classPrefix}">
            <div class="stat-value">${stats.total}</div>
            <div class="stat-label">总计${typeLabel}</div>
        </div>
        <div class="stat-card ${classPrefix}">
            <div class="stat-value">${avgPerDay}</div>
            <div class="stat-label">日均${typeLabel}</div>
        </div>
        <div class="stat-card ${classPrefix}">
            <div class="stat-value">${stats.allTotal}</div>
            <div class="stat-label">历史总量</div>
        </div>
    `;
}

// 更新时间选项
function updateRangeOptions(type) {
    const select = document.getElementById('stats-range');
    if (!select) return;
    
    // 隐藏所有选项
    select.querySelectorAll('option').forEach(opt => {
        opt.style.display = 'none';
        opt.selected = false;
    });
    
    // 显示对应类型的选项
    const showOptions = select.querySelectorAll(`option[data-for="${type}"]`);
    showOptions.forEach((opt, index) => {
        opt.style.display = 'block';
        if (index === 0) opt.selected = true; // 默认选第一个
    });
}

// 更新统计 UI
async function updateStatsUI() {
    const rangeSelect = document.getElementById('stats-range');
    const range = rangeSelect?.value || '7';
    const days = range === 'all' ? 'all' : parseInt(range);
    
    const loadBtn = document.getElementById('load-stats');
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '加载中...';
    }
    
    const stats = await loadStatsData(currentStatsType, days);
    
    if (stats) {
        renderStatsSummary(stats, currentStatsType);
        renderStatsChart(stats, currentStatsType);
    }
    
    if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = '加载数据';
    }
}

function setupStats() {
    // 切换统计类型
    document.querySelectorAll('.stats-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentStatsType = tab.dataset.type;
            updateRangeOptions(currentStatsType);
            // 只切换选项，不自动加载数据
            // 清空图表和摘要，提示用户点击加载
            if (statsChart) {
                statsChart.destroy();
                statsChart = null;
            }
            document.getElementById('stats-summary').innerHTML = '';
            document.getElementById('stats-chart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#86868b;">点击"加载数据"按钮获取统计</div>';
        });
    });
    
    // 加载数据按钮
    const loadBtn = document.getElementById('load-stats');
    if (loadBtn) {
        loadBtn.addEventListener('click', () => updateStatsUI());
    }
}

// ============ 初始化 ============

function init() {
    console.log('初始化应用...');
    
    // 设置 UI 组件
    setupNavigation();
    setupLogin();
    setupTagSearch();
    setupClickOutside();
    setupLikeButtons();
    setupRanking();
    setupUUIDSearch();
    setupCheckin();
    setupStats();
    loadHotTags();
    
    // 渲染已保存的标签
    renderTags();
    
    // 检查登录状态
    const token = getToken();
    if (token) {
        console.log('发现已保存的 Token，加载用户信息...');
        loadUserProfile().then(() => {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('show');
            }
        });
    } else {
        console.log('未登录，显示登录窗口');
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
            loginModal.classList.add('show');
        }
    }
    
    console.log('初始化完成');
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
