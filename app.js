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

// 用户点赞相关状态
let selectedUsers = []; // 已选中的用户列表 [{uuid, name, avatar, followers, storyCount}]
let userPageMap = {}; // 每个用户的当前页码
let userFinished = {}; // 每个用户是否已完成
let userSearchDebounce = null; // 搜索防抖定时器
let currentUserConfirm = null; // 当前待确认的用户信息
let previousProfileData = null; // 上次用户数据（用于对比变化）

// 超时设置
let timeoutDuration = 1; // 无增长停止时间（分钟），0 表示无截止
let timeoutScope = 'all'; // 应用范围：'all', 'except-users', 'except-tags'

// 点赞速度
let likeSpeed = 200; // 默认 200ms

// 日志标志
let tagsFinishedLogged = false; // 标签完成日志是否已打印
let usersFinishedLogged = false; // 用户完成日志是否已打印

// 图库相关状态
let galleryPageIndex = 0;
let galleryTotal = 0;
let galleryLoading = false;

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

// ============ 用户搜索 ============

async function searchUsers(keyword) {
    if (!keyword || keyword.trim().length === 0) {
        return [];
    }
    
    const token = getToken();
    if (!token) {
        return [];
    }
    
    try {
        const res = await fetch(`${API_BASE}/v1/user/search?keywords=${encodeURIComponent(keyword.trim())}&page_index=0&page_size=50`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });
        
        if (!res.ok) {
            console.error('搜索用户失败:', res.status);
            return [];
        }
        
        const data = await res.json();
        return data.list || [];
    } catch (error) {
        console.error('搜索用户异常:', error);
        return [];
    }
}

// 获取用户详细信息（准确的粉丝数）
async function getUserDetail(uuid) {
    const token = getToken();
    if (!token) {
        return null;
    }
    
    try {
        const res = await fetch(`${API_BASE}/v1/user/?uuid=${encodeURIComponent(uuid)}`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });
        
        if (!res.ok) {
            console.error('获取用户详情失败:', res.status);
            return null;
        }
        
        const data = await res.json();
        return data;
    } catch (error) {
        console.error('获取用户详情异常:', error);
        return null;
    }
}

function showUserSuggestions(users) {
    const container = document.getElementById('user-suggestions');
    if (!container) return;
    
    if (users.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    
    // 只显示头像和昵称，不显示粉丝数（搜索 API 的数据不准确）
    container.innerHTML = users.map(user => `
        <div class="suggestion-item" data-uuid="${user.uuid}">
            <img src="${user.avatar_url || ''}" alt="${user.nick_name}" class="suggestion-avatar" />
            <div class="suggestion-info">
                <div class="suggestion-name">${user.nick_name || '未知'}</div>
            </div>
        </div>
    `).join('');
    
    container.style.display = 'block';
    
    // 绑定点击事件，弹窗确认
    container.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            const uuid = item.dataset.uuid;
            const user = users.find(u => u.uuid === uuid);
            if (user) {
                showUserConfirmModal(user);
                container.style.display = 'none';
                document.getElementById('user-search').value = '';
            }
        });
    });
}

function initUserSearch() {
    const input = document.getElementById('user-search');
    if (!input) return;
    
    input.addEventListener('input', () => {
        const keyword = input.value.trim();
        
        // 清除之前的定时器
        if (userSearchDebounce) {
            clearTimeout(userSearchDebounce);
        }
        
        // 防抖 300ms
        userSearchDebounce = setTimeout(async () => {
            const users = await searchUsers(keyword);
            showUserSuggestions(users);
        }, 300);
    });
    
    // 点击外部关闭建议框
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#user-suggestions') && !e.target.closest('#user-search')) {
            const container = document.getElementById('user-suggestions');
            if (container) container.style.display = 'none';
        }
    });
}

// ============ 用户确认模态框 ============

async function showUserConfirmModal(user) {
    currentUserConfirm = user;
    
    // 获取详细用户信息（准确的粉丝数）
    const detail = await getUserDetail(user.uuid);
    const followers = detail ? (detail.total_fans || 0) : 0;
    // story_count 是 null，要用 total_collections
    const stories = detail ? (detail.total_collections || 0) : 0;
    
    const modal = document.getElementById('user-confirm-modal');
    const avatar = document.getElementById('confirm-avatar');
    const name = document.getElementById('confirm-name');
    const followersEl = document.getElementById('confirm-followers');
    const storiesEl = document.getElementById('confirm-stories');
    
    if (avatar) avatar.src = user.avatar_url || '';
    if (name) name.textContent = user.nick_name || '未知';
    if (followersEl) followersEl.textContent = followers;
    if (storiesEl) storiesEl.textContent = stories;
    
    if (modal) modal.classList.add('show');
}

function closeUserConfirmModal() {
    const modal = document.getElementById('user-confirm-modal');
    if (modal) modal.classList.remove('show');
    currentUserConfirm = null;
}

function initUserConfirm() {
    const addBtn = document.getElementById('confirm-add-user');
    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            if (currentUserConfirm) {
                await addUserToQueue(currentUserConfirm);
                closeUserConfirmModal();
            }
        });
    }
}

// ============ 用户任务队列 ============

async function addUserToQueue(user) {
    // 检查是否已存在
    if (selectedUsers.some(u => u.uuid === user.uuid)) {
        log(`用户 ${user.nick_name} 已在队列中`, 'error');
        return;
    }
    
    // 获取详细用户信息（准确的粉丝数）
    const detail = await getUserDetail(user.uuid);
    const followers = detail ? (detail.total_fans || 0) : (user.subscriber_count || 0);
    // story_count 是 null，要用 total_collections
    const storyCount = detail ? (detail.total_collections || 0) : (user.story_count || 0);
    
    selectedUsers.push({
        uuid: user.uuid,
        name: user.nick_name,
        avatar: user.avatar_url,
        followers: followers,
        storyCount: storyCount
    });
    
    userPageMap[user.uuid] = 0;
    userFinished[user.uuid] = false;
    
    renderUserQueue();
    log(`已添加用户：${user.nick_name}（${storyCount} 作品，${followers} 粉丝）`, 'success');
}

function removeUserFromQueue(uuid) {
    selectedUsers = selectedUsers.filter(u => u.uuid !== uuid);
    delete userPageMap[uuid];
    delete userFinished[uuid];
    renderUserQueue();
    log(`已移除用户`, 'info');
}

function renderUserQueue() {
    const container = document.getElementById('selected-users');
    if (!container) return;
    
    if (selectedUsers.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无用户，搜索后点击添加</div>';
        return;
    }
    
    container.innerHTML = selectedUsers.map(user => `
        <div class="user-queue-item">
            <img src="${user.avatar || ''}" alt="${user.name}" class="user-queue-avatar" />
            <div class="user-queue-info">
                <div class="user-queue-name">${user.name}</div>
                <div class="user-queue-meta">${user.followers || 0} 粉丝 · ${user.storyCount || 0} 作品</div>
            </div>
            <button class="user-queue-remove" data-uuid="${user.uuid}">×</button>
        </div>
    `).join('');
    
    // 绑定移除事件
    container.querySelectorAll('.user-queue-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const uuid = btn.dataset.uuid;
            removeUserFromQueue(uuid);
        });
    });
}

// ============ 获取用户作品 ============

async function getUserStories(uuid, page = 0, size = 20) {
    const token = getToken();
    if (!token) {
        return [];
    }
    
    try {
        const res = await fetch(`${API_BASE}/v2/story/user-stories?uuid=${encodeURIComponent(uuid)}&page_index=${page}&page_size=${size}`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });
        
        if (!res.ok) {
            console.error('获取用户作品失败:', res.status);
            return [];
        }
        
        const data = await res.json();
        const list = data.list || [];
        console.log('获取用户作品:', uuid, '页码', page, '返回', list.length, '个');
        // 返回 storyId 和 title 字段
        return list.map(item => ({
            storyId: item.storyId,
            title: item.name,
            likeCount: item.likeCount,
            sameStyleCount: item.sameStyleCount
        }));
    } catch (error) {
        console.error('获取用户作品异常:', error);
        return [];
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
    
    const likesEl = document.getElementById('profile-likes');
    if (likesEl) likesEl.textContent = userProfile.likes || 0;
    
    const sameStyleEl = document.getElementById('profile-same-style');
    if (sameStyleEl) sameStyleEl.textContent = userProfile.sameStyle || 0;
    
    // 显示数据变化提示
    if (previousProfileData) {
        showStatDelta('profile-following', userProfile.following, previousProfileData.following);
        showStatDelta('profile-followers', userProfile.followers, previousProfileData.followers);
        showStatDelta('profile-energy', userProfile.energy, previousProfileData.energy);
        showStatDelta('profile-likes', userProfile.likes, previousProfileData.likes);
        showStatDelta('profile-same-style', userProfile.sameStyle, previousProfileData.sameStyle);
    }
    
    // 保存当前数据用于下次对比
    previousProfileData = { ...userProfile };
}

function showStatDelta(elementId, newValue, oldValue) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    // 移除旧的 delta
    const oldDelta = el.querySelector('.stat-delta');
    if (oldDelta) oldDelta.remove();
    
    // 计算变化
    const newNum = Number(newValue) || 0;
    const oldNum = Number(oldValue) || 0;
    const delta = newNum - oldNum;
    
    if (delta === 0) return;
    
    // 创建 delta 元素
    const deltaEl = document.createElement('div');
    deltaEl.className = `stat-delta ${delta > 0 ? 'positive' : 'negative'} show`;
    deltaEl.textContent = delta > 0 ? `+${delta}` : delta;
    
    // 插入到数值前面
    el.insertBefore(deltaEl, el.firstChild);
    
    // 5 秒后移除
    setTimeout(() => {
        if (deltaEl.parentNode) {
            deltaEl.remove();
        }
    }, 5000);
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
        
        // 保存旧数据用于对比
        const oldProfile = userProfile ? { ...userProfile } : null;
        
        userProfile = {
            name: data.nick_name || data.name || '用户',
            avatar: data.avatar_url || '',
            following: data.total_subscribes || 0,
            followers: data.total_fans || 0,
            energy: data.ap_info?.ap || 0,
            likes: data.total_likes || 0,
            sameStyle: data.total_same_style || 0
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
    
    // 点赞速度滑块
    const likeSpeedSlider = document.getElementById('like-speed');
    const likeSpeedValue = document.getElementById('like-speed-value');
    
    if (likeSpeedSlider && likeSpeedValue) {
        // 从 localStorage 加载保存的速度
        const saved = localStorage.getItem('like_speed');
        if (saved) {
            likeSpeed = parseInt(saved, 10);
            likeSpeedSlider.value = likeSpeed;
            likeSpeedValue.textContent = likeSpeed + 'ms';
        }
        
        likeSpeedSlider.addEventListener('input', (e) => {
            likeSpeed = parseInt(e.target.value, 10);
            likeSpeedValue.textContent = likeSpeed + 'ms';
            localStorage.setItem('like_speed', likeSpeed);
        });
    }
    
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
    const token = getToken();
    if (!token) {
        alert('请先登录');
        return;
    }
    
    const tags = getSavedTags();
    const users = selectedUsers;
    
    if (tags.length === 0 && users.length === 0) {
        alert('请先添加标签或用户');
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
    
    // 初始化标签
    tagPageMap = {};
    tagFinished = {};
    tags.forEach(tag => {
        likeStats.byTag[tag.name] = 0;
        tagFinished[tag.name] = false;
    });
    
    // 初始化用户
    userPageMap = {};
    userFinished = {};
    users.forEach(user => {
        likeStats.byTag[user.uuid] = 0;
        userFinished[user.uuid] = false;
        userPageMap[user.uuid] = 0;
    });
    
    // 重置日志标志
    tagsFinishedLogged = false;
    usersFinishedLogged = false;
    
    chartData = { labels: [], total: [], byTag: {} };
    tags.forEach(tag => {
        chartData.byTag[tag.name] = [];
    });
    users.forEach(user => {
        chartData.byTag[user.uuid] = [];
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
    
    // 启动标签点赞（Worker）
    if (tags.length > 0) {
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
            startLikeLoop(tags);
        }
    }
    
    // 启动用户点赞
    if (users.length > 0) {
        startUserLikeLoop(users);
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
                    log(`#${tag.name} 已遍历完所有作品（第 ${currentPage} 页）`, 'info');
                    
                    // 不在这里检查完成，让外层循环检查
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
                    await new Promise(r => setTimeout(r, likeSpeed));
                }
                
                // 无论成功失败，都翻到下一页
                tagPageMap[tag.name] = currentPage + 1;
                log(`#${tag.name} 第${currentPage + 1}页处理完成，翻到第${currentPage + 2}页`);
            } catch (error) {
                log(`#${tag.name}: ${error.message}`, 'error');
            }
        }
        
        // 检查是否所有标签都完成了
        const unfinishedTagsCheck = tags.filter(t => !tagFinished[t.name]);
        if (unfinishedTagsCheck.length === 0 && tags.length > 0) {
            // 所有标签都完成了，检查用户
            const unfinishedUsers = selectedUsers.filter(u => !userFinished[u.uuid]);
            if (unfinishedUsers.length === 0) {
                // 所有任务都完成了
                isRunning = false;
                log('所有任务已完成', 'success');
                stopLiking();
                break;
            } else {
                // 还有用户在跑
                if (!tagsFinishedLogged) {
                    // except-users 模式下，显示深蓝色日志
                    if (timeoutScope === 'except-users') {
                        log('标签进程结束，用户进程继续', 'warning');
                    } else {
                        log('所有标签已完成，等待用户进程...', 'info');
                    }
                    tagsFinishedLogged = true;
                }
                // except-users 模式下，标签循环可以退出了，让用户循环继续
                if (timeoutScope === 'except-users') {
                    return; // 直接返回，不执行函数末尾的重置代码
                }
            }
        } else {
            // 还有标签在跑，重置标志
            tagsFinishedLogged = false;
        }
        
        // 检查超时（根据设置）- 只针对标签
        const timeoutMs = timeoutDuration * 60 * 1000;
        const noGrowthTime = Date.now() - likeStats.lastIncrease;
        
        if (timeoutDuration > 0 && noGrowthTime > timeoutMs) {
            if (timeoutScope === 'all') {
                // 整体：标签超时就停止整个进程
                isRunning = false;
                log(`⚠️ ${timeoutDuration}分钟无增长，已停止`, 'error');
                stopLiking();
                break;
            } else if (timeoutScope === 'except-users') {
                // 除用户：标签超时就停止标签，但用户继续跑
                log(`⚠️ 标签 ${timeoutDuration}分钟无增长，停止标签进程，用户继续`, 'error');
                // 标记所有标签完成
                tags.forEach(t => tagFinished[t.name] = true);
                // 检查用户是否也完成了
                const unfinishedUsers = selectedUsers.filter(u => !userFinished[u.uuid]);
                if (unfinishedUsers.length === 0) {
                    // 用户也完成了，停止整个进程
                    isRunning = false;
                    log('所有任务已完成', 'success');
                    stopLiking();
                    break;
                }
                // 用户还在跑，直接返回，让用户循环继续
                log('标签进程结束，用户进程继续', 'warning');
                return;
            }
            // except-tags: 标签不检查超时，继续跑
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

async function startUserLikeLoop(users) {
    // 初始化页码
    users.forEach(user => {
        if (userPageMap[user.uuid] === undefined) {
            userPageMap[user.uuid] = 0;
        }
    });
    
    while (isRunning) {
        // 暂停时等待
        if (isPaused) {
            await new Promise(r => setTimeout(r, 500));
            continue;
        }
        
        for (const user of users) {
            if (!isRunning) break;
            if (isPaused) break;
            
            // 如果这个用户已经完成，跳过
            if (userFinished[user.uuid]) continue;
            
            try {
                const currentPage = userPageMap[user.uuid] || 0;
                const stories = await getUserStories(user.uuid, currentPage, 20);
                
                // 添加延迟，避免 API 限流
                await new Promise(r => setTimeout(r, 300));
                
                if (stories.length === 0) {
                    // 当前页没有作品，标记这个用户完成
                    userFinished[user.uuid] = true;
                    log(`@${user.name} 已遍历完所有作品（第 ${currentPage} 页）`, 'info');
                    
                    // 不在这里检查完成，让外层循环检查
                    continue;
                }
                
                let successCount = 0;
                for (const story of stories) {
                    if (!isRunning) break;
                    if (isPaused) break;
                    
                    const result = await likeStory(story.storyId);
                    if (result.success) {
                        likeStats.total++;
                        likeStats.byTag[user.uuid]++;
                        likeStats.lastIncrease = Date.now();
                        const storyTitle = story.name || story.title || '无题';
                        log(`✓ @${user.name}: ${storyTitle}`, 'success');
                        successCount++;
                    } else {
                        log(`✗ @${user.name}: ${result.error}`, 'error');
                    }
                    
                    updateProgress();
                    await new Promise(r => setTimeout(r, likeSpeed));
                }
                
                // 检查是否是最后一页（返回数量 < 20）
                if (stories.length < 20) {
                    // 最后一页了，标记完成
                    userFinished[user.uuid] = true;
                    log(`@${user.name} 已遍历完所有作品（第 ${currentPage + 1} 页，共${stories.length}个）`, 'info');
                } else {
                    // 还有更多页，继续翻
                    userPageMap[user.uuid] = currentPage + 1;
                    log(`@${user.name} 第${currentPage + 1}页处理完成，翻到第${currentPage + 2}页`);
                }
            } catch (error) {
                log(`@${user.name}: ${error.message}`, 'error');
            }
        }
        
        // 检查是否所有任务都完成了（标签 + 用户）
        const tags = getSavedTags();
        const unfinishedTags = tags.filter(t => !tagFinished[t.name]);
        const unfinishedUsers = users.filter(u => !userFinished[u.uuid]);
        
        if (unfinishedTags.length === 0 && unfinishedUsers.length === 0) {
            isRunning = false;
            log('所有任务已完成', 'success');
            stopLiking();
            break;
        }
        
        // 检查超时（根据设置）- 只针对用户
        const timeoutMs = timeoutDuration * 60 * 1000;
        const noGrowthTime = Date.now() - likeStats.lastIncrease;
        
        if (timeoutDuration > 0 && noGrowthTime > timeoutMs) {
            if (timeoutScope === 'all') {
                // 整体：用户超时就停止整个进程
                isRunning = false;
                log(`⚠️ ${timeoutDuration}分钟无增长，已停止`, 'error');
                stopLiking();
                break;
            } else if (timeoutScope === 'except-tags') {
                // 除标签：用户超时就停止用户，但标签继续跑
                log(`⚠️ 用户 ${timeoutDuration}分钟无增长，停止用户进程，标签继续`, 'error');
                // 标记所有用户完成
                users.forEach(u => userFinished[u.uuid] = true);
                // 检查标签是否也完成了
                const unfinishedTags = tags.filter(t => !tagFinished[t.name]);
                if (unfinishedTags.length === 0) {
                    // 标签也完成了，停止整个进程
                    isRunning = false;
                    log('所有任务已完成', 'success');
                    stopLiking();
                    break;
                }
                // 标签还在跑，继续循环
                continue;
            }
            // except-users: 用户不检查超时，继续跑
        }
        
        // 检查是否所有用户都完成了
        if (unfinishedUsers.length === 0 && users.length > 0) {
            if (unfinishedTagsCheck.length === 0) {
                // 所有任务都完成了
                isRunning = false;
                log('所有任务已完成', 'success');
                stopLiking();
                break;
            } else {
                // 还有标签在跑
                if (!usersFinishedLogged) {
                    // except-tags 模式下，显示深蓝色日志
                    if (timeoutScope === 'except-tags') {
                        log('用户进程结束，标签进程继续', 'warning');
                    } else {
                        log('所有用户已完成，等待标签进程...', 'info');
                    }
                    usersFinishedLogged = true;
                }
                // except-tags 模式下，用户循环可以退出了，让标签循环继续
                if (timeoutScope === 'except-tags') {
                    return; // 直接返回，不执行函数末尾的重置代码
                }
            }
        } else {
            // 还有用户在跑，重置标志
            usersFinishedLogged = false;
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
    
    const progressEl = document.getElementById('like-progress');
    if (!progressEl) return;
    
    let html = `<div class="progress-item"><span>总赞数</span><span>${likeStats.total}</span></div>`;
    html += `<div class="progress-item"><span>运行时间</span><span>${elapsed}s</span></div>`;
    
    // 显示标签进度
    const tags = getSavedTags();
    tags.forEach(tag => {
        html += `<div class="progress-item"><span>#${tag.name}</span><span>${likeStats.byTag[tag.name] || 0}</span></div>`;
    });
    
    // 显示用户进度
    selectedUsers.forEach(user => {
        html += `<div class="progress-item"><span>@${user.name}</span><span>${likeStats.byTag[user.uuid] || 0}</span></div>`;
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
        selectedUsers.forEach(user => {
            if (!chartData.byTag[user.uuid]) chartData.byTag[user.uuid] = [];
            chartData.byTag[user.uuid].push(likeStats.byTag[user.uuid] || 0);
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
    const refreshProfileBtn = document.getElementById('refresh-profile-btn');
    
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
    
    // 刷新用户数据按钮
    if (refreshProfileBtn) {
        refreshProfileBtn.addEventListener('click', async () => {
            const token = getToken();
            if (!token) {
                showStatus('checkin-status', '请先登录', 'error');
                return;
            }
            
            // 旋转图标
            const icon = refreshProfileBtn.querySelector('.refresh-icon');
            if (icon) {
                icon.style.transform = 'rotate(360deg)';
            }
            
            try {
                await loadUserProfile();
                showStatus('checkin-status', '✓ 数据已刷新', 'success');
                setTimeout(() => {
                    showStatus('checkin-status', '', '');
                }, 2000);
            } catch (error) {
                showStatus('checkin-status', '刷新失败：' + error.message, 'error');
            } finally {
                // 重置图标
                if (icon) {
                    icon.style.transform = 'rotate(0deg)';
                }
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
    
    // 获取当前中国时间的日期字符串
    const now = new Date();
    const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000); // UTC+8
    const todayStr = chinaNow.toISOString().split('T')[0]; // "2026-05-17"
    
    const cutoffDays = parseInt(days);
    const cutoffDate = new Date(chinaNow);
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
    cutoffDate.setHours(0, 0, 0, 0);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]; // "2026-05-16"
    
    console.log(`[filterByRange] todayStr=${todayStr}, cutoffStr=${cutoffStr}, days=${days}`);
    
    return list.filter(item => {
        // 直接比较日期字符串 "2026-05-16" >= "2026-05-16"
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
        
        // 智能 page_size 策略（基于测试结果）：
        // page_size <= 3: 实时数据（当天）
        // page_size 5-10: 滞后 1 天
        // page_size 20: 滞后 2 天
        // page_size >= 50: 严重滞后
        let pageSize = 3; // 第 1 页用 page_size=3 获取实时数据
        let useRealTime = true; // 是否使用实时模式
        
        while (hasMore && pageIndex <= 500) {
            console.log(`准备请求第 ${pageIndex} 页，pageSize=${pageSize}, hasMore=${hasMore}`);
            // 添加时间戳 + 随机数参数，绕过 API 缓存
            const url = `${API_BASE}/v1/message/message-list?section=${section}&page_index=${pageIndex}&page_size=${pageSize}&_t=${Date.now()}_&r=${Math.random()}`;
            
            const res = await fetch(url, {
                headers: {
                    'x-token': token,
                    'x-platform': 'nieta-app/web',
                    'x-app-bundle-version': '6.11.5',
                    'x-nieta-app-version': '6.11.5',
                    'x-teen-mode': '0',
                    'device-id': '7545220721081910273',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                cache: 'no-store' // 禁用浏览器缓存
            });
            
            if (!res.ok) {
                console.error(`请求失败：${res.status}`);
                const errorText = await res.text();
                console.error(`错误详情：${errorText}`);
                break;
            }
            
            const data = await res.json();
            console.log(`第 ${pageIndex} 页响应：list.length=${data.list?.length}, total=${data.total}`);
            
            if (pageIndex === 1) {
                apiTotal = data.total || 0;
                console.log(`API 返回总数：${apiTotal}`);
                console.log(`第 1 页数据量：${data.list?.length || 0}, 最新：${data.list?.[0]?.ctime}`);
                
                // 检查第 1 页是否是实时数据（最新数据在 2 天内）
                const now = new Date();
                const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
                const todayStr = chinaNow.toISOString().split('T')[0];
                const firstItemDate = data.list?.[0]?.ctime?.split(' ')[0];
                
                // 计算日期差
                const dateDiff = (new Date(todayStr) - new Date(firstItemDate)) / (1000 * 60 * 60 * 24);
                
                if (dateDiff <= 1) {
                    // 第 1 页是近 1 天的数据，后续用 page_size=10 加速（10 滞后约 1 天，可接受）
                    useRealTime = false;
                    pageSize = 10;
                    console.log(`第 1 页是近 1 天数据 (${firstItemDate})，后续使用 page_size=10 加速`);
                } else {
                    console.log(`第 1 页数据滞后 (${firstItemDate})，继续使用 page_size=3`);
                }
            }
            
            if (!data.list || data.list.length === 0) {
                console.log(`第 ${pageIndex} 页无数据，停止`);
                hasMore = false;
                break;
            }
            
            // 过滤数据
            let filtered = data.list;
            if (type === 'inherit') {
                const beforeCount = filtered.length;
                filtered = filtered.filter(item => item.action_type === 'inherit');
                console.log(`第 ${pageIndex} 页：捏同款过滤 ${beforeCount} → ${filtered.length} 条`);
            }
            
            allData.push(...filtered);
            console.log(`第 ${pageIndex} 页：获取 ${data.list.length} 条，过滤后 ${filtered.length} 条，累计 ${allData.length} 条`);
            
            // 不再提前停止！因为 API 返回的数据不是按时间排序的
            // 必须获取所有数据，然后在后面统一排序和过滤
            
            // 如果获取的数据少于 page_size，说明是最后一页
            // 注意：第 1 页用 page_size=3 探测，不参与停止检查
            if (pageIndex > 1 && data.list.length < pageSize) {
                console.log(`第 ${pageIndex} 页数据量 (${data.list.length}) < pageSize (${pageSize})，停止`);
                hasMore = false;
            } else if (pageIndex > 1) {
                console.log(`继续请求第 ${pageIndex + 1} 页...`);
            }
            
            pageIndex++;
            
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.log(`循环结束：hasMore=${hasMore}, pageIndex=${pageIndex}, allData.length=${allData.length}`);
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
        console.log(`[loadStatsData] 调用 filterByRange, days=${days}, allData.length=${allData.length}`);
        const filteredData = filterByRange(allData, days);
        console.log(`过滤后剩余 ${filteredData.length} 条数据`);
        console.log(`时间范围：最近${days === 'all' ? '全部' : days + '天'}, cutoffStr=${cutoffStr}`);
        
        // 调试：打印过滤后的日期分布
        if (filteredData.length > 0) {
            const dates = filteredData.map(d => d.ctime.split(' ')[0]);
            const uniqueDates = [...new Set(dates)].sort();
            console.log(`过滤后的日期分布：${uniqueDates.join(', ')}`);
        }
        
        // 如果过滤后为 0，显示警告
        if (allData.length > 0 && filteredData.length === 0) {
            console.warn(`⚠️ 所有数据都被过滤掉了！最新数据是${allData[0].ctime.split(' ')[0]}，早于截止日期${cutoffStr}`);
        }
        
        // 粉丝/点赞/捏同款的总数从 userProfile 获取（更准确）
        let displayTotal = apiTotal;
        if (userProfile) {
            if (type === 'like') {
                displayTotal = parseInt(userProfile.total_likes) || apiTotal;
            } else if (type === 'inherit') {
                displayTotal = parseInt(userProfile.total_same_style) || apiTotal;
            } else if (type === 'fans') {
                displayTotal = userProfile.total_fans || apiTotal;
            }
        }
        
        return {
            total: filteredData.length,
            allTotal: displayTotal, // 显示准确的总数
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
    
    // 获取最新数据时间
    const latestTime = stats.list?.[0]?.ctime || '无数据';
    
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
        <div class="stat-card ${classPrefix}" style="min-width: 200px;">
            <div class="stat-value" style="font-size: 14px; line-height: 1.4;">${latestTime}</div>
            <div class="stat-label">${typeLabel}最新</div>
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
    
    // 显示对应类型的选项，并选中第一个
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
    
    console.log(`[updateStatsUI] type=${currentStatsType}, range=${range}, days=${days}`);
    
    const loadBtn = document.getElementById('load-stats');
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '加载中...';
    }
    
    const stats = await loadStatsData(currentStatsType, days);
    
    if (stats) {
        console.log(`[updateStatsUI] 加载完成，total=${stats.total}, byDate 键数量=${Object.keys(stats.byDate).length}`);
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
            const summaryEl = document.getElementById('stats-summary');
            const chartEl = document.getElementById('stats-chart');
            if (summaryEl) summaryEl.innerHTML = '';
            if (chartEl) chartEl.innerHTML = '';
        });
    });
    
    // 加载数据按钮
    const loadBtn = document.getElementById('load-stats');
    if (loadBtn) {
        loadBtn.addEventListener('click', () => updateStatsUI());
    }
    
    // 时间选项变化时，自动更新选中状态（确保只选中当前类型的一个选项）
    const rangeSelect = document.getElementById('stats-range');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', () => {
            const type = currentStatsType;
            const selectedValue = rangeSelect.value;
            // 确保同类型的其他选项不被选中
            rangeSelect.querySelectorAll(`option[data-for="${type}"]`).forEach(opt => {
                opt.selected = (opt.value === selectedValue);
            });
        });
    }
}

// ============ 图库功能 ============

function setupGallery() {
    const loadBtn = document.getElementById('load-gallery');
    const loadMoreBtn = document.getElementById('load-more-gallery');
    const modalitySelect = document.getElementById('gallery-modality');
    
    if (loadBtn) {
        loadBtn.addEventListener('click', () => {
            galleryPageIndex = 0;
            document.getElementById('gallery-grid').innerHTML = '';
            loadGallery(true);
        });
    }
    
    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            loadGallery(false);
        });
    }
    
    if (modalitySelect) {
        modalitySelect.addEventListener('change', () => {
            galleryPageIndex = 0;
            document.getElementById('gallery-grid').innerHTML = '';
        });
    }
}

async function loadGallery(isFirstLoad = false) {
    if (galleryLoading) return;
    
    const token = getToken();
    if (!token) {
        alert('请先登录');
        return;
    }
    
    galleryLoading = true;
    const loadingEl = document.getElementById('gallery-loading');
    const loadMoreBtn = document.getElementById('load-more-gallery');
    const gridEl = document.getElementById('gallery-grid');
    const modalitySelect = document.getElementById('gallery-modality');
    
    if (loadingEl) loadingEl.style.display = 'block';
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    
    const modality = modalitySelect ? modalitySelect.value : 'PICTURE';
    const pageSize = 50;
    
    try {
        const res = await fetch(`${API_BASE}/v1/artifact/list?page_index=${galleryPageIndex}&page_size=${pageSize}&modality=${modality}`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });
        
        if (!res.ok) {
            throw new Error('加载失败');
        }
        
        const data = await res.json();
        galleryTotal = data.total || 0;
        const list = data.list || [];
        
        if (isFirstLoad) {
            gridEl.innerHTML = '';
        }
        
        // 渲染图库项
        list.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'gallery-item';
            
            let mediaHtml = '';
            let originalUrl = '';
            
            if (modality === 'VIDEO') {
                // 视频用 mp4
                originalUrl = `https://oss.talesofai.cn/picture/${item.uuid}.mp4`;
                if (item.status === 'SUCCESS') {
                    mediaHtml = `<video src="${originalUrl}" class="gallery-item-media" muted loop onmouseover="this.play()" onmouseout="this.pause()" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"></video><div class="gallery-item-media" style="display:none;align-items:center;justify-content:center;background:#000;color:#fff;font-size:2rem;">🎬</div>`;
                } else {
                    mediaHtml = `<div class="gallery-item-media" style="display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-size:2rem;">🎬</div>`;
                }
            } else {
                // 图片用 png
                originalUrl = `https://oss.talesofai.cn/picture/${item.uuid}.png`;
                mediaHtml = item.status === 'SUCCESS'
                    ? `<img src="${originalUrl}" alt="${item.uuid}" class="gallery-item-media" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="gallery-item-media" style="display:none;align-items:center;justify-content:center;color:#86868b;">❌</div>`
                    : `<div class="gallery-item-media" style="display:flex;align-items:center;justify-content:center;color:#86868b;">❌</div>`;
            }
            
            itemEl.innerHTML = `
                ${mediaHtml}
                <div class="gallery-item-info">
                    <div class="gallery-item-url" title="${originalUrl || '无 URL'}">${originalUrl || '生成失败'}</div>
                    <div class="gallery-item-time">${item.ctime || ''}</div>
                    <span class="gallery-item-status ${item.status === 'SUCCESS' ? 'success' : 'failure'}">${item.status === 'SUCCESS' ? '成功' : '失败'}</span>
                </div>
            `;
            
            // 点击复制 URL
            if (originalUrl) {
                itemEl.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(originalUrl);
                        showToast('已复制 URL，点击打开→', originalUrl);
                    } catch (e) {
                        showToast('复制失败');
                    }
                });
            }
            
            gridEl.appendChild(itemEl);
        });
        
        galleryPageIndex++;
        
        // 显示加载更多按钮（如果返回的数据是满的）
        if (loadMoreBtn) {
            if (list.length === pageSize) {
                loadMoreBtn.style.display = 'block';
            }
        }
        
    } catch (error) {
        console.error('加载图库失败:', error);
        showToast('加载失败：' + error.message);
    } finally {
        galleryLoading = false;
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

let toastContainer = null;

function showToast(message, url = null) {
    // 创建或复用容器
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;gap:6px;z-index:9999;max-width:calc(100vw - 40px);';
        document.body.appendChild(toastContainer);
    }
    
    const toast = document.createElement('div');
    toast.style.cssText = 'background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:toastSlideIn 0.3s ease-out;cursor:' + (url ? 'pointer' : 'default') + ';';
    
    if (url) {
        // 有 URL 时，显示可点击的提示，"点击打开→"用蓝色按钮样式
        const msgParts = message.split('，');
        toast.innerHTML = `<span>${msgParts[0]}</span><span style="background:#0071e3;color:#fff;padding:2px 8px;border-radius:4px;margin-left:6px;font-weight:600;font-size:12px;">${msgParts[1] || ''}</span>`;
        toast.addEventListener('click', () => {
            window.open(url, '_blank');
        });
    } else {
        toast.textContent = message;
    }
    
    // 添加到容器（flex-direction: column-reverse 会自动把新的放下面）
    toastContainer.appendChild(toast);
    
    // 5 秒后移除
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-out';
        setTimeout(() => {
            toast.remove();
            // 如果容器空了，清理容器
            if (toastContainer.children.length === 0) {
                toastContainer.remove();
                toastContainer = null;
            }
        }, 300);
    }, 5000);
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes toastSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    @keyframes toastSlideOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(-10px); }
    }
`;
document.head.appendChild(style);

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
    setupGallery();
    loadHotTags();
    
    // 新增：用户点赞相关
    initUserSearch();
    initUserConfirm();
    renderUserQueue();
    
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
    
    // 初始化超时设置
    const timeoutDurationSelect = document.getElementById('timeout-duration');
    const timeoutScopeSelect = document.getElementById('timeout-scope');
    if (timeoutDurationSelect) {
        timeoutDurationSelect.addEventListener('change', (e) => {
            timeoutDuration = parseInt(e.target.value);
            console.log('超时时间设置为:', timeoutDuration, '分钟');
        });
    }
    if (timeoutScopeSelect) {
        timeoutScopeSelect.addEventListener('change', (e) => {
            timeoutScope = e.target.value;
            console.log('超时范围设置为:', timeoutScope);
        });
    }
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
