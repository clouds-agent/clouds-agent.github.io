// API 配置
const API_BASE = 'https://api.talesofai.cn';

// 状态
let isRunning = false; // 是否正在运行
let isPaused = false; // 是否暂停
let currentActivePage = 'like'; // 当前活动页面:'like' 或 'tools'
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
let previousProfileData = null; // 上次用户数据(用于对比变化)

// 超时设置
let timeoutDuration = 1; // 无增长停止时间(分钟),0 表示无截止
let timeoutScope = 'all'; // 应用范围:'all', 'except-users', 'except-tags'

// 点赞速度
let likeSpeed = 200; // 默认 200ms

// 日志标志
let tagsFinishedLogged = false; // 标签完成日志是否已打印
let usersFinishedLogged = false; // 用户完成日志是否已打印

// 导航栏加载状态
function updateNavbarLoading(page, isLoading) {
    const navLink = document.querySelector(`.nav-link[href="#${page}"]`);
    console.log(`[updateNavbarLoading] page=${page}, isLoading=${isLoading}, navLink=${!!navLink}`);
    if (!navLink) return;

    if (isLoading) {
        navLink.classList.add('loading');
        console.log(`[updateNavbarLoading] 添加 loading 类到 #${page}`);
    } else {
        navLink.classList.remove('loading');
        console.log(`[updateNavbarLoading] 移除 #${page} 的 loading 类`);
    }
}

// 更新导航栏加载状态(简化版)
function updateNavbarLoading(page, isLoading) {
    const navLink = document.querySelector(`.nav-link[href="#${page}"]`);
    if (!navLink) return;

    if (isLoading) {
        navLink.classList.add('loading');
    } else {
        navLink.classList.remove('loading');
    }
}

// 页面切换
function switchPage(pageName) {
    // 移除所有 active 类
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));

    // 添加 active 到当前页面
    const activeLink = document.querySelector(`.nav-link[data-page="${pageName}"]`);
    const activeSection = document.getElementById(pageName);

    if (activeLink) activeLink.classList.add('active');
    if (activeSection) activeSection.classList.add('active');

    currentActivePage = pageName;

    // 切换到非点赞页时,隐藏点赞记录
    if (pageName !== 'like') {
        hideLikeRecords();
    }

    // 切换到点赞页,移除所有加载状态
    if (pageName === 'like') {
        updateNavbarLoading('like', false);
        updateNavbarLoading('tools', false);
    }
    // 切换到工具页
    else if (pageName === 'tools') {
        updateNavbarLoading('tools', false);
        if (isRunning) {
            updateNavbarLoading('like', true);
        }
    }
}

// 初始化导航点击事件
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const pageName = this.getAttribute('data-page');
            if (pageName) {
                switchPage(pageName);
            }
        });
    });
}

// 图库相关状态
let galleryPageIndex = 0;
let galleryTotal = 0;
let galleryLoading = false;

// ============ 工具函数 ============

function getToken() {
    const token = localStorage.getItem('neta_token');
    console.log('getToken:', token ? '有 Token,长度' + token.length : '无 Token');
    return token;
}

function saveToken(token) {
    console.log('saveToken:', '保存 Token,长度', token.length);
    localStorage.setItem('neta_token', token);

    // 保存到账号列表
    saveAccountToHistory(token);

    console.log('验证读取:', localStorage.getItem('neta_token') ? '成功' : '失败');
}

function saveAccountToHistory(token) {
    try {
        // 从 token 中提取用户信息(这里简化处理,实际应该调用 API 获取)
        const accounts = JSON.parse(localStorage.getItem('neta_accounts') || '[]');

        // 检查是否已存在
        const exists = accounts.some(acc => acc.token === token);
        if (!exists) {
            // 新账号,添加到列表
            accounts.push({
                token: token,
                userId: token.substring(0, 8) + '...', // 临时显示,登录后再更新
                avatar: '',
                addedAt: Date.now()
            });
            localStorage.setItem('neta_accounts', JSON.stringify(accounts));
        }
    } catch (e) {
        console.error('保存账号历史失败:', e);
    }
}

function getAccountHistory() {
    try {
        return JSON.parse(localStorage.getItem('neta_accounts') || '[]');
    } catch (e) {
        console.error('读取账号历史失败:', e);
        return [];
    }
}

function removeAccountFromHistory(token) {
    try {
        const accounts = JSON.parse(localStorage.getItem('neta_accounts') || '[]');
        const filtered = accounts.filter(acc => acc.token !== token);
        localStorage.setItem('neta_accounts', JSON.stringify(filtered));
    } catch (e) {
        console.error('删除账号历史失败:', e);
    }
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

// 获取用户详细信息(准确的粉丝数)
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

    // 只显示头像和昵称,不显示粉丝数(搜索 API 的数据不准确)
    container.innerHTML = users.map(user => `
        <div class="suggestion-item" data-uuid="${user.uuid}">
            <img src="${user.avatar_url || ''}" alt="${user.nick_name}" class="suggestion-avatar" />
            <div class="suggestion-info">
                <div class="suggestion-name">${user.nick_name || '未知'}</div>
            </div>
        </div>
    `).join('');

    container.style.display = 'block';

    // 绑定点击事件,弹窗确认
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

    // 获取详细用户信息(准确的粉丝数)
    const detail = await getUserDetail(user.uuid);
    const followers = detail ? (detail.total_fans || 0) : 0;
    // story_count 是 null,要用 total_collections
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

    // 获取详细用户信息(准确的粉丝数)
    const detail = await getUserDetail(user.uuid);
    const followers = detail ? (detail.total_fans || 0) : (user.subscriber_count || 0);
    // story_count 是 null,要用 total_collections
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
    log(`已添加用户:${user.nick_name}(${storyCount} 作品,${followers} 粉丝)`, 'success');
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
        container.innerHTML = '<div class="empty-tip">暂无用户,搜索后点击添加</div>';
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
        console.log('没有用户信息,不更新 UI');
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
        console.log('没有 Token,无法加载用户信息');
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
            uuid: data.uuid || '',
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
            const pageName = link.getAttribute('data-page');
            if (pageName) {
                switchPage(pageName);

                // 点赞按钮连续点击 5 次显示点赞记录
                if (pageName === 'like') {
                    likeNavClickCount++;
                    clearTimeout(likeNavClickTimeout);

                    if (likeNavClickCount >= 5) {
                        showLikeRecords();
                        likeNavClickCount = 0;
                    } else {
                        likeNavClickTimeout = setTimeout(() => {
                            likeNavClickCount = 0;
                        }, 1000); // 1 秒内连续点击才算
                    }
                }
            }
        });
    });

    // Kards 按钮双击
    const kardsBtn = document.getElementById('kards-btn');
    if (kardsBtn) {
        let kardsClickTimeout = null;
        let kardsLastClickTime = 0;

        // 加载图标
        const iconImg = new Image();
        iconImg.src = 'images/kards-icon.png';
        iconImg.onload = function() {
            kardsBtn.classList.add('loaded');
        };
        iconImg.onerror = function() {
            kardsBtn.style.display = 'none';
        };

        kardsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            const now = Date.now();

            if (now - kardsLastClickTime < 300) {
                if (kardsClickTimeout) {
                    clearTimeout(kardsClickTimeout);
                    kardsClickTimeout = null;
                }
                // 双击,切换到 Kards 页面
                switchPage('kards');
            } else {
                kardsClickTimeout = setTimeout(() => {
                    kardsClickTimeout = null;
                }, 300);
            }

            kardsLastClickTime = now;
        });
    }
}

// ============ 登录/登出 ============

function setupLogin() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userProfileBtn = document.getElementById('user-profile');

    console.log('setupLogin 执行,getToken:', getToken());

    // 检查是否已登录,已登录则关闭登录窗口
    if (getToken()) {
        console.log('已登录,关闭登录窗口');
        const loginModal = document.getElementById('login-modal');
        if (loginModal) {
            loginModal.classList.remove('show');
            console.log('登录窗口已关闭');
        }
        updateProfileUI();
    } else {
        console.log('未登录,保持登录窗口显示');
    }

    // 绑定登录按钮事件(最重要,放在最前面)
    if (loginBtn) {
        console.log('找到登录按钮,绑定事件');
        loginBtn.addEventListener('click', handleLogin);
        console.log('登录按钮事件已绑定');
    } else {
        console.error('找不到登录按钮!');
    }

    // 延迟加载快捷登录列表
    setTimeout(() => {
        loadQuickLoginList();
    }, 100);

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
window.handleLoginClick = handleLoginClick;
window.showQuickLogin = showQuickLogin;
window.selectQuickLogin = selectQuickLogin;
window.deleteQuickLogin = deleteQuickLogin;
window.copyToken = copyToken;

// 记录登录到 Cloudflare Workers
async function updateAccountInHistory(token, profile) {
    try {
        const accounts = JSON.parse(localStorage.getItem('neta_accounts') || '[]');
        const index = accounts.findIndex(acc => acc.token === token);
        if (index !== -1) {
            accounts[index].userId = profile.name;
            accounts[index].avatar = profile.avatar;
            accounts[index].lastLogin = Date.now();
            localStorage.setItem('neta_accounts', JSON.stringify(accounts));
        }
    } catch (e) {
        console.error('更新账号历史失败:', e);
    }
}

// 日志功能已移除(Cloudflare Workers 需要 VPN,用不了)

// 显示快捷登录列表
function showQuickLogin() {
    const listEl = document.getElementById('quick-login-list');
    const dividerEl = document.getElementById('quick-login-divider');
    const quickBtn = document.getElementById('quick-login-btn');

    if (listEl.style.display === 'block') {
        // 已展开,收起
        listEl.style.display = 'none';
        dividerEl.style.display = 'none';
        quickBtn.textContent = '👤 快捷登录';
    } else {
        // 未展开,加载并显示
        loadQuickLoginList();
        listEl.style.display = 'block';
        dividerEl.style.display = 'block';
        quickBtn.textContent = '收起';
    }
}

// 加载快捷登录列表
function loadQuickLoginList() {
    const listEl = document.getElementById('quick-login-list');
    if (!listEl) return;

    const accounts = getAccountHistory();

    if (accounts.length === 0) {
        const quickBtn = document.getElementById('quick-login-btn');
        if (quickBtn) quickBtn.style.display = 'none';
        return;
    }

    listEl.innerHTML = '';

    accounts.forEach((acc, index) => {
        const item = document.createElement('div');
        item.className = 'quick-login-item';

        const avatarUrl = acc.avatar || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNiIgaGVpZ2h0PSIzNiI+PGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiNkMmQyZDciLz48dGV4dCB4PSIxOCIgeT0iMjIiIGZpbGw9IiM4Njg2OGIiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPj88L3RleHQ+PC9zdmc+';
        const userId = acc.userId || acc.token.substring(0, 8) + '...';

        item.innerHTML = `
            <img src="${avatarUrl}" alt="avatar" class="quick-login-avatar" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzNiIgaGVpZ2h0PSIzNiI+PGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiNkMmQyZDciLz48dGV4dCB4PSIxOCIgeT0iMjIiIGZpbGw9IiM4Njg2OGIiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUiPj88L3RleHQ+PC9zdmc+'">
            <div class="quick-login-info">
                <div class="quick-login-name">${userId}</div>
            </div>
            <button class="quick-login-delete" onclick="deleteQuickLogin(${index})">删除</button>
        `;

        // 点击账号快速登录
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('quick-login-delete')) {
                selectQuickLogin(acc.token);
            }
        });

        listEl.appendChild(item);
    });
}

// 选择快捷登录
function selectQuickLogin(token) {
    localStorage.setItem('neta_token', token);
    location.reload();
}

// 删除快捷登录
function deleteQuickLogin(index) {
    if (!confirm('确定要删除这个账号吗?')) return;

    const accounts = getAccountHistory();
    if (index >= 0 && index < accounts.length) {
        accounts.splice(index, 1);
        localStorage.setItem('neta_accounts', JSON.stringify(accounts));
        loadQuickLoginList();

        // 如果列表为空,隐藏按钮
        if (accounts.length === 0) {
            const quickBtn = document.getElementById('quick-login-btn');
            if (quickBtn) quickBtn.style.display = 'none';
        }
    }
}

// 复制 Token
function copyToken() {
    const token = getToken();
    if (!token) {
        showToast('未登录');
        return;
    }
    navigator.clipboard.writeText(token).then(() => {
        showToast('✅ Token 已复制');
    }).catch(() => {
        showToast('❌ 复制失败');
    });
}

// 显示提示
let toastContainer = null;
function showToast(message, url = null) {
    // 创建或复用容器
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;gap:6px;z-index:9999;max-width:calc(100vw - 40px);';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.style.cssText = 'background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:toastSlideIn 0.3s ease-out;cursor:' + (url ? 'pointer' : 'default') + ';white-space:nowrap;display:flex;align-items:center;gap:6px;';

    toast.textContent = message;

    if (url) {
        toast.addEventListener('click', () => {
            window.open(url, '_blank');
        });
    }

    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// 全局函数,供 HTML onclick 调用
function handleLoginClick() {
    console.log('handleLoginClick 被调用');
    handleLogin();
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
        console.log('登录失败:Token 为空');
        return;
    }

    console.log('尝试登录,Token 长度:', token.length);

    try {
        console.log('发起登录请求...');
        const res = await fetch(`${API_BASE}/v1/user/`, {
            method: 'GET',
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web',
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            credentials: 'omit'
        });

        console.log('API 响应状态:', res.status);
        console.log('CORS 检查:', res.headers.get('Access-Control-Allow-Origin'));

        if (!res.ok) {
            let errorText = `HTTP ${res.status}`;
            try {
                const errorData = await res.json();
                errorText = errorData.message || errorData.detail || errorText;
            } catch (e) {}
            showStatus('login-status', `登录失败:${errorText}`, 'error');
            return;
        }

        const data = await res.json();
        console.log('登录成功,用户数据:', data);

        if (!data.id || !data.uuid) {
            showStatus('login-status', 'Token 验证失败:数据不完整', 'error');
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

        // 更新账号历史
        updateAccountInHistory(token, userProfile);

        // 关闭登录窗口
        setTimeout(() => {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('show');
            }
        }, 500);
    } catch (error) {
        console.error('登录失败:', error);
        showStatus('login-status', '登录失败:' + error.message, 'error');
    }
}

// ============ 标签搜索联想 ============

async function searchTags(keyword) {
    const token = getToken();
    if (!token) {
        console.log('搜索标签:没有 Token');
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

        // 搜索空间标签(宽松匹配:只要包含搜索词中的任意字)
        try {
            const spacesRes = await fetch(`${API_BASE}/v1/configs/config?namespace=space&key=topic_tags_config`, {
                headers: { 'x-token': token, 'x-platform': 'nieta-app/web' }
            });
            console.log('空间 API 状态:', spacesRes.status);
            if (spacesRes.ok) {
                const spacesData = await spacesRes.json();
                const spacesConfig = JSON.parse(spacesData.value || '{}');
                console.log('空间配置项数:', Object.keys(spacesConfig).length);

                // 宽松匹配:标签名包含搜索词,或搜索词的每个字都出现在标签名中
                const matched = Object.entries(spacesConfig)
                    .filter(([name]) => {
                        // 精确包含
                        if (name.includes(keyword)) return true;
                        // 宽松匹配:搜索词的每个字都出现在标签名中(如"捏捏"匹配"捏 Ta 学院")
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

        // 按热度排序,取前 10 个
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
                    ${item.popularity ? `· 热度:${item.popularity.toLocaleString()}` : ''}
                    ${item.posts ? `· 帖子:${item.posts.toLocaleString()}` : ''}
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
    // 保存到历史记录
    saveTagToHistory(tag.name);
    renderTagHistory();
    document.getElementById('tag-search').value = '';
    document.getElementById('tag-suggestions').classList.remove('show');
}

// 手动添加标签(支持任意标签名)
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
        console.log('浏览器不支持 Worker,使用传统模式');
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
    // 移除所有加载状态
    updateNavbarLoading('like', false);
    updateNavbarLoading('tools', false);
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
                // 正在运行,点击是"终止"
                stopLiking();
            } else {
                // 未运行,点击是"开始"
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
                renderTags(); // 暂停时重新渲染,启用页码编辑
            } else {
                log('继续点赞', 'success');
                renderTags(); // 继续时重新渲染,禁用页码编辑
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
    // 如果当前在工具页,立即显示点赞页加载状态
    const currentPage = document.querySelector('.section.active')?.id;
    if (currentPage === 'tools') {
        updateNavbarLoading('like', true);
    }
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

    // 启动标签点赞(Worker)
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

    // 保存点赞记录
    if (likeStats && likeStats.startTime && likeStats.total > 0) {
        const duration = Date.now() - likeStats.startTime;
        saveLikeRecord({
            startTime: likeStats.startTime,
            duration: duration,
            count: likeStats.total
        });
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

            // 如果这个标签已经完成,跳过
            if (tagFinished[tag.name]) continue;

            try {
                const currentPage = tagPageMap[tag.name] || 0;
                const stories = await getStories(tag.name, currentPage, 10);

                // 添加延迟,避免 API 限流
                await new Promise(r => setTimeout(r, 200));

                if (stories.length === 0) {
                    // 当前页没有作品,标记这个标签完成
                    tagFinished[tag.name] = true;
                    log(`#${tag.name} 已遍历完所有作品(第 ${currentPage} 页)`, 'info');

                    // 不在这里检查完成,让外层循环检查
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

                // 翻到下一页(限制最大页码为 999,即第 1000 页)
                const nextPage = currentPage + 1;
                if (nextPage >= 1000) {
                    // 已达到最大页码,标记这个标签完成
                    tagFinished[tag.name] = true;
                    log(`#${tag.name} 已达到最大页码限制(1000 页)`, 'info');
                } else {
                    tagPageMap[tag.name] = nextPage;
                    log(`#${tag.name} 第${currentPage + 1}页处理完成,翻到第${currentPage + 2}页`);
                }
            } catch (error) {
                log(`#${tag.name}: ${error.message}`, 'error');
            }
        }

        // 检查是否所有标签都完成了
        const unfinishedTagsCheck = tags.filter(t => !tagFinished[t.name]);
        if (unfinishedTagsCheck.length === 0 && tags.length > 0) {
            // 所有标签都完成了,检查用户
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
                    // except-users 模式下,显示深蓝色日志
                    if (timeoutScope === 'except-users') {
                        log('标签进程结束,用户进程继续', 'warning');
                    } else {
                        log('所有标签已完成,等待用户进程...', 'info');
                    }
                    tagsFinishedLogged = true;
                }
                // except-users 模式下,标签循环可以退出了,让用户循环继续
                if (timeoutScope === 'except-users') {
                    return; // 直接返回,不执行函数末尾的重置代码
                }
            }
        } else {
            // 还有标签在跑,重置标志
            tagsFinishedLogged = false;
        }

        // 检查超时(根据设置)- 只针对标签
        const timeoutMs = timeoutDuration * 60 * 1000;
        const noGrowthTime = Date.now() - likeStats.lastIncrease;

        if (timeoutDuration > 0 && noGrowthTime > timeoutMs) {
            if (timeoutScope === 'all') {
                // 整体:标签超时就停止整个进程
                isRunning = false;
                log(`⚠️ ${timeoutDuration}分钟无增长,已停止`, 'error');
                stopLiking();
                break;
            } else if (timeoutScope === 'except-users') {
                // 除用户:标签超时就停止标签,但用户继续跑
                log(`⚠️ 标签 ${timeoutDuration}分钟无增长,停止标签进程,用户继续`, 'error');
                // 标记所有标签完成
                tags.forEach(t => tagFinished[t.name] = true);
                // 检查用户是否也完成了
                const unfinishedUsers = selectedUsers.filter(u => !userFinished[u.uuid]);
                if (unfinishedUsers.length === 0) {
                    // 用户也完成了,停止整个进程
                    isRunning = false;
                    log('所有任务已完成', 'success');
                    stopLiking();
                    break;
                }
                // 用户还在跑,直接返回,让用户循环继续
                log('标签进程结束,用户进程继续', 'warning');
                return;
            }
            // except-tags: 标签不检查超时,继续跑
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

            // 如果这个用户已经完成,跳过
            if (userFinished[user.uuid]) continue;

            try {
                const currentPage = userPageMap[user.uuid] || 0;
                const stories = await getUserStories(user.uuid, currentPage, 20);

                // 添加延迟,避免 API 限流
                await new Promise(r => setTimeout(r, 300));

                if (stories.length === 0) {
                    // 当前页没有作品,标记这个用户完成
                    userFinished[user.uuid] = true;
                    log(`@${user.name} 已遍历完所有作品(第 ${currentPage} 页)`, 'info');

                    // 不在这里检查完成,让外层循环检查
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

                // 检查是否是最后一页(返回数量 < 20)或达到最大页码
                if (stories.length < 20 || currentPage + 1 >= 1000) {
                    // 最后一页了,标记完成
                    userFinished[user.uuid] = true;
                    if (currentPage + 1 >= 1000) {
                        log(`@${user.name} 已达到最大页码限制(1000 页)`, 'info');
                    } else {
                        log(`@${user.name} 已遍历完所有作品(第 ${currentPage + 1} 页,共${stories.length}个)`, 'info');
                    }
                } else {
                    // 还有更多页,继续翻
                    userPageMap[user.uuid] = currentPage + 1;
                    log(`@${user.name} 第${currentPage + 1}页处理完成,翻到第${currentPage + 2}页`);
                }
            } catch (error) {
                log(`@${user.name}: ${error.message}`, 'error');
            }
        }

        // 检查是否所有任务都完成了(标签 + 用户)
        const tags = getSavedTags();
        const unfinishedTags = tags.filter(t => !tagFinished[t.name]);
        const unfinishedUsers = users.filter(u => !userFinished[u.uuid]);

        if (unfinishedTags.length === 0 && unfinishedUsers.length === 0) {
            isRunning = false;
            log('所有任务已完成', 'success');
            stopLiking();
            break;
        }

        // 检查超时(根据设置)- 只针对用户
        const timeoutMs = timeoutDuration * 60 * 1000;
        const noGrowthTime = Date.now() - likeStats.lastIncrease;

        if (timeoutDuration > 0 && noGrowthTime > timeoutMs) {
            if (timeoutScope === 'all') {
                // 整体:用户超时就停止整个进程
                isRunning = false;
                log(`⚠️ ${timeoutDuration}分钟无增长,已停止`, 'error');
                stopLiking();
                break;
            } else if (timeoutScope === 'except-tags') {
                // 除标签:用户超时就停止用户,但标签继续跑
                log(`⚠️ 用户 ${timeoutDuration}分钟无增长,停止用户进程,标签继续`, 'error');
                // 标记所有用户完成
                users.forEach(u => userFinished[u.uuid] = true);
                // 检查标签是否也完成了
                const unfinishedTags = tags.filter(t => !tagFinished[t.name]);
                if (unfinishedTags.length === 0) {
                    // 标签也完成了,停止整个进程
                    isRunning = false;
                    log('所有任务已完成', 'success');
                    stopLiking();
                    break;
                }
                // 标签还在跑,继续循环
                continue;
            }
            // except-users: 用户不检查超时,继续跑
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
                    // except-tags 模式下,显示深蓝色日志
                    if (timeoutScope === 'except-tags') {
                        log('用户进程结束,标签进程继续', 'warning');
                    } else {
                        log('所有用户已完成,等待标签进程...', 'info');
                    }
                    usersFinishedLogged = true;
                }
                // except-tags 模式下,用户循环可以退出了,让标签循环继续
                if (timeoutScope === 'except-tags') {
                    return; // 直接返回,不执行函数末尾的重置代码
                }
            }
        } else {
            // 还有用户在跑,重置标志
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

    // 限制只显示最新 100 条,避免卡顿
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
                        ${item.popularity ? `· 热度:${item.popularity.toLocaleString()}` : ''}
                    </div>
                </div>
                <div class="ranking-hot">${item.popularity ? '🔥 ' + item.popularity.toLocaleString() : '-'}</div>
                <button class="ranking-add" onclick="addTag({name:'${item.tag_name}',type:'${item.type}',popularity:${item.popularity || 0}})">+</button>
            </div>
        `).join('');
    } catch (error) {
        listEl.textContent = '加载失败:' + error.message;
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

        // 100ms 就开始搜索,更快响应
        uuidDebounce = setTimeout(() => {
            console.log('开始 UUID 搜索:', keyword);
            searchUUID(keyword);
        }, 100);
    });
}

async function searchUUID(keyword) {
    const token = getToken();
    if (!token) {
        console.log('UUID 搜索:没有 Token');
        return;
    }

    const suggestionsEl = document.getElementById('uuid-suggestions');
    if (!suggestionsEl) {
        console.log('UUID 搜索:suggestions 元素不存在');
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

        // 搜索角色(20 个)
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

        // 搜索元素(20 个)
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

        // 按热度排序(如果有 popularity 字段)
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

        // 按热度排序,取前 15 个
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
                    showStatus('checkin-status', '签到失败:' + (data.message || '未知错误'), 'error');
                }
            } catch (error) {
                showStatus('checkin-status', '签到失败:' + error.message, 'error');
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
                showStatus('checkin-status', '刷新失败:' + error.message, 'error');
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
                    '是否跳转到配置页面?'
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
        // 由于需要额外的 GitHub Token,我们改为指导用户手动配置

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
            '请按以下步骤配置定时签到:\n\n' +
            '1. 打开仓库:https://github.com/' + repo + '/settings/secrets/actions\n' +
            '2. 点击 "New repository secret"\n' +
            '3. 添加 Secret:\n' +
            '   Name: NETA_TOKEN\n' +
            '   Value: 你的 Token(已自动复制)\n\n' +
            '4. 打开:https://github.com/' + repo + '/actions/new-workflow\n' +
            '5. 选择 "set up a workflow yourself"\n' +
            '6. 粘贴以下内容:\n\n' + workflowContent +
            '\n7. 点击 "Commit changes"\n\n' +
            '配置完成后,每天 0:01 会自动签到!'
        );

        // 复制 Token 到剪贴板
        try {
            await navigator.clipboard.writeText(token);
        } catch (e) {
            console.log('无法自动复制 Token,请手动复制');
        }

    } catch (error) {
        console.error('配置失败:', error);
        alert('配置失败:' + error.message);
    }
}

// ============ 数据统计 ============

let currentStatsType = 'fans'; // 当前统计类型:fans, like, inherit
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
// 加载统计数据(优化:按时间范围提前停止)
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

    // 计算截止日期(用于提前停止)- 使用中国时间
    let cutoffDate = null;
    let cutoffStr = null;
    if (days !== 'all') {
        const now = new Date();
        const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000); // UTC+8
        cutoffDate = new Date(chinaNow);
        cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
        cutoffDate.setHours(0, 0, 0, 0);
        cutoffStr = cutoffDate.toISOString().split('T')[0]; // "2026-05-15"
        console.log(`截止日期字符串:${cutoffStr}`);
    }

    try {
        const allData = [];
        let pageIndex = 1;
        let hasMore = true;
        let apiTotal = 0;

        console.log(`开始加载 ${type} 数据,section=${section}, days=${days}`);
        if (cutoffDate) {
            console.log(`截止日期:${cutoffDate.toISOString()}`);
        }

        // 智能 page_size 策略(基于测试结果):
        // page_size <= 3: 实时数据(当天)
        // page_size 5-10: 滞后 1 天
        // page_size 20: 滞后 2 天
        // page_size >= 50: 严重滞后
        let pageSize = 3; // 第 1 页用 page_size=3 获取实时数据
        let useRealTime = true; // 是否使用实时模式

        while (hasMore && pageIndex <= 500) {
            console.log(`准备请求第 ${pageIndex} 页,pageSize=${pageSize}, hasMore=${hasMore}`);
            // 添加时间戳 + 随机数参数,绕过 API 缓存
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
                console.error(`请求失败:${res.status}`);
                const errorText = await res.text();
                console.error(`错误详情:${errorText}`);
                break;
            }

            const data = await res.json();
            console.log(`第 ${pageIndex} 页响应:list.length=${data.list?.length}, total=${data.total}`);

            if (pageIndex === 1) {
                apiTotal = data.total || 0;
                console.log(`API 返回总数:${apiTotal}`);
                console.log(`第 1 页数据量:${data.list?.length || 0}, 最新:${data.list?.[0]?.ctime}`);

                // 检查第 1 页是否是实时数据(最新数据在 2 天内)
                const now = new Date();
                const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
                const todayStr = chinaNow.toISOString().split('T')[0];
                const firstItemDate = data.list?.[0]?.ctime?.split(' ')[0];

                // 始终保持 page_size=3,确保数据实时性
                // 不切换到 page_size=10,避免数据滞后
                console.log(`第 1 页最新数据:${firstItemDate},继续使用 page_size=3 保证实时性`);
            }

            if (!data.list || data.list.length === 0) {
                console.log(`第 ${pageIndex} 页无数据,停止`);
                hasMore = false;
                break;
            }

            // 过滤数据
            let filtered = data.list;
            if (type === 'inherit') {
                const beforeCount = filtered.length;
                filtered = filtered.filter(item => item.action_type === 'inherit');
                console.log(`第 ${pageIndex} 页:捏同款过滤 ${beforeCount} → ${filtered.length} 条`);
            }

            allData.push(...filtered);
            console.log(`第 ${pageIndex} 页:获取 ${data.list.length} 条,过滤后 ${filtered.length} 条,累计 ${allData.length} 条`);

            // 不再提前停止!因为 API 返回的数据不是按时间排序的
            // 必须获取所有数据,然后在后面统一排序和过滤

            // 如果获取的数据少于 page_size,说明是最后一页
            // 注意:第 1 页用 page_size=3 探测,不参与停止检查
            if (pageIndex > 1 && data.list.length < pageSize) {
                console.log(`第 ${pageIndex} 页数据量 (${data.list.length}) < pageSize (${pageSize}),停止`);
                hasMore = false;
            } else if (pageIndex > 1) {
                console.log(`继续请求第 ${pageIndex + 1} 页...`);
            }

            pageIndex++;

            await new Promise(r => setTimeout(r, 100));
        }

        console.log(`循环结束:hasMore=${hasMore}, pageIndex=${pageIndex}, allData.length=${allData.length}`);
        console.log(`总共获取 ${allData.length} 条数据`);

        // 按时间倒序排序(确保最新数据在前面)
        allData.sort((a, b) => {
            return b.ctime.localeCompare(a.ctime);
        });

        // 调试:打印第一条和最后一条数据的时间
        if (allData.length > 0) {
            console.log(`最新数据时间:${allData[0].ctime}`);
            console.log(`最旧数据时间:${allData[allData.length - 1].ctime}`);
        }

        // 按时间范围过滤
        console.log(`[loadStatsData] 调用 filterByRange, days=${days}, allData.length=${allData.length}`);
        const filteredData = filterByRange(allData, days);
        console.log(`过滤后剩余 ${filteredData.length} 条数据`);
        console.log(`时间范围:最近${days === 'all' ? '全部' : days + '天'}, cutoffStr=${cutoffStr}`);

        // 调试:打印过滤后的日期分布
        if (filteredData.length > 0) {
            const dates = filteredData.map(d => d.ctime.split(' ')[0]);
            const uniqueDates = [...new Set(dates)].sort();
            console.log(`过滤后的日期分布:${uniqueDates.join(', ')}`);
        }

        // 如果过滤后为 0,显示警告
        if (allData.length > 0 && filteredData.length === 0) {
            console.warn(`⚠️ 所有数据都被过滤掉了!最新数据是${allData[0].ctime.split(' ')[0]},早于截止日期${cutoffStr}`);
        }

        // 粉丝/点赞/捏同款的总数从 userProfile 获取(更准确)
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

// 渲染统计图表(Chart.js 折线图)
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
                            return `数量:${context.parsed.y}`;
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

    // 显示对应类型的选项,并选中第一个
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

    // 设置导航栏加载状态(只有切换到其他页面时才显示)
    const currentPage = document.querySelector('.section.active')?.id;
    if (currentPage !== 'tools') {
        updateNavbarLoading('tools', true);
    }

    // 显示加载提示
    const chartContainer = document.getElementById('stats-chart');
    if (chartContainer) {
        const typeName = currentStatsType === 'fans' ? '粉丝' : currentStatsType === 'like' ? '点赞' : '捏同款';
        const rangeName = range === 'all' ? '全部' :
                         range === '7' ? '最近 7 天' :
                         range === '14' ? '最近 14 天' :
                         range === '30' ? '最近 30 天' : `最近${range}天`;
        chartContainer.innerHTML = `<div class="stats-loading">${typeName} - ${rangeName} 加载中<div class="dots"><span>.</span><span>.</span><span>.</span><span>.</span></div></div>`;
    }

    const loadBtn = document.getElementById('load-stats');
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = '加载中...';
    }

    const stats = await loadStatsData(currentStatsType, days);

    if (stats) {
        console.log(`[updateStatsUI] 加载完成,total=${stats.total}, byDate 键数量=${Object.keys(stats.byDate).length}`);
        renderStatsSummary(stats, currentStatsType);
        renderStatsChart(stats, currentStatsType);
    }

    if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = '加载数据';
    }

    // 移除导航栏加载状态
    updateNavbarLoading('tools', false);
}

function setupStats() {
    // 切换统计类型
    document.querySelectorAll('.stats-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentStatsType = tab.dataset.type;
            updateRangeOptions(currentStatsType);
            // 只切换选项,不自动加载数据
            // 清空图表和摘要,提示用户点击加载
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

    // 时间选项变化时,自动更新选中状态(确保只选中当前类型的一个选项)
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
            let pngUrl = '', jpgUrl = '', webpUrl = '';

            if (modality === 'VIDEO') {
                // 视频用 mp4
                originalUrl = `https://oss.talesofai.cn/picture/${item.uuid}.mp4`;
                if (item.status === 'SUCCESS') {
                    mediaHtml = `<video src="${originalUrl}" class="gallery-item-media" muted loop onmouseover="this.play()" onmouseout="this.pause()" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"></video><div class="gallery-item-media" style="display:none;align-items:center;justify-content:center;background:#000;color:#fff;font-size:2rem;">🎬</div>`;
                } else {
                    mediaHtml = `<div class="gallery-item-media" style="display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font-size:2rem;">🎬</div>`;
                }
            } else {
                // 图片:尝试 png、jpg、webp 三种格式
                pngUrl = `https://oss.talesofai.cn/picture/${item.uuid}.png`;
                jpgUrl = `https://oss.talesofai.cn/picture/${item.uuid}.jpg`;
                webpUrl = `https://oss.talesofai.cn/picture/${item.uuid}.webp`;

                if (item.status === 'SUCCESS') {
                    // 先尝试 png,失败再尝试 jpg,最后 webp
                    mediaHtml = `<img src="${pngUrl}" alt="${item.uuid}" class="gallery-item-media" loading="lazy"/><div class="gallery-item-media" style="display:none;align-items:center;justify-content:center;color:#86868b;">❌</div>`;
                } else {
                    mediaHtml = `<div class="gallery-item-media" style="display:flex;align-items:center;justify-content:center;color:#86868b;">❌</div>`;
                }
            }

            // 生成失败的图片也要显示 URL 并可复制
            const displayUrl = item.status === 'SUCCESS' ? pngUrl : `https://oss.talesofai.cn/picture/${item.uuid}.webp`;

            itemEl.innerHTML = `
                ${mediaHtml}
                <div class="gallery-item-info">
                    <div class="gallery-item-url">${displayUrl}</div>
                    <div class="gallery-item-time">${item.ctime || ''}</div>
                    <span class="gallery-item-status ${item.status === 'SUCCESS' ? 'success' : 'failure'}">${item.status === 'SUCCESS' ? '成功' : '失败'}</span>
                    <button class="gallery-item-search-btn" onclick="showImageDetail('${item.uuid}', event)" title="查看详情">详情</button>
                </div>
            `;

            // 图片加载逻辑:尝试 png→jpg→webp(仅图片模式)
            if (item.status === 'SUCCESS' && modality === 'PICTURE') {
                const img = itemEl.querySelector('img');
                const urlEl = itemEl.querySelector('.gallery-item-url');
                let currentUrl = pngUrl;

                // 更新显示的 URL
                const updateUrl = (url) => {
                    currentUrl = url;
                    if (urlEl) {
                        urlEl.textContent = url;
                        urlEl.title = url;
                    }
                };

                // 初始设置为 png
                updateUrl(pngUrl);

                // 加载成功
                if (img) {
                    img.addEventListener('load', () => {
                        updateUrl(currentUrl);
                    });

                    // 加载失败,尝试下一个格式
                    img.addEventListener('error', function() {
                        if (currentUrl === pngUrl) {
                            this.src = jpgUrl;
                            updateUrl(jpgUrl);
                        } else if (currentUrl === jpgUrl) {
                            this.src = webpUrl;
                            updateUrl(webpUrl);
                        } else {
                            // 所有格式都失败
                            this.style.display = 'none';
                            this.nextElementSibling.style.display = 'flex';
                        }
                    });
                }
            }

            // 点击复制 URL(无论成功失败都可以复制),但搜索按钮除外
            itemEl.addEventListener('click', async (e) => {
                // 如果点击的是搜索按钮,不复制 URL
                if (e.target.closest('.gallery-item-search-btn')) {
                    return;
                }

                try {
                    const urlEl = itemEl.querySelector('.gallery-item-url');
                    const urlToCopy = urlEl?.textContent || displayUrl;
                    await navigator.clipboard.writeText(urlToCopy);
                    showToast('已复制 URL,点击打开→', urlToCopy);
                } catch (e) {
                    showToast('复制失败');
                }
            });

            gridEl.appendChild(itemEl);
        });

        galleryPageIndex++;

        // 显示加载更多按钮(如果返回的数据是满的)
        if (loadMoreBtn) {
            if (list.length === pageSize) {
                loadMoreBtn.style.display = 'block';
            }
        }

    } catch (error) {
        console.error('加载图库失败:', error);
        showToast('加载失败:' + error.message);
    } finally {
        galleryLoading = false;
        if (loadingEl) loadingEl.style.display = 'none';
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
    setupGallery();
    setupDanbooruExplorer();
    setupTranslate();
    loadHotTags();

    // 历史标签
    renderTagHistory();
    const toggleHistoryBtn = document.getElementById('toggle-history-btn');
    if (toggleHistoryBtn) {
        toggleHistoryBtn.addEventListener('click', toggleTagHistoryFold);
    }

    // 新增:用户点赞相关
    initUserSearch();
    initUserConfirm();
    renderUserQueue();

    // 渲染已保存的标签
    renderTags();

    // 检查登录状态
    const token = getToken();
    if (token) {
        console.log('发现已保存的 Token,加载用户信息...');
        loadUserProfile().then(() => {
            const loginModal = document.getElementById('login-modal');
            if (loginModal) {
                loginModal.classList.remove('show');
            }
        });
    } else {
        console.log('未登录,显示登录窗口');
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

// ============ 图片筛选 & 词条归类 ============


// ============ 图片详情弹窗 ============

let currentPromptsText = '';

async function showImageDetail(uuid, event) {
    // 阻止事件冒泡,避免触发 URL 复制
    if (event) {
        event.stopPropagation();
    }

    const modal = document.getElementById('image-detail-modal');
    const modelEl = document.getElementById('detail-model');
    const seedEl = document.getElementById('detail-seed');
    const promptsEl = document.getElementById('detail-prompts');

    if (!modal || !modelEl || !seedEl || !promptsEl) {
        console.error('图片详情弹窗元素不存在');
        return;
    }

    // 显示加载状态
    modelEl.textContent = '加载中...';
    seedEl.textContent = '-';
    promptsEl.textContent = '';
    currentPromptsText = '';
    modal.classList.add('show');

    try {
        const token = getToken();
        if (!token) {
            promptsEl.textContent = '请先登录';
            return;
        }

        // 调用详情 API
        const res = await fetch(`https://api.talesofai.cn/v1/artifact/artifact-detail?uuids=${uuid}&is_brief_only=false`, {
            headers: {
                'x-token': token,
                'x-platform': 'nieta-app/web'
            }
        });

        const data = await res.json();
        if (!data || !data[0]) {
            promptsEl.textContent = '未找到图片详情';
            return;
        }

        const detail = data[0];
        const input = detail.input || {};

        // 显示模型(从 context_model_series 推断)
        const modelSeries = input.context_model_series || '';
        let modelText = '未知';
        if (modelSeries === '9_image_edit_bravo') {
            modelText = '捏捏 9_image_edit_bravo';
        } else if (modelSeries === '8_image_edit') {
            modelText = '旧捏捏 8_image_edit';
        } else if (modelSeries === '3_noobxl') {
            modelText = '模型三 3_noobxl';
        } else if (modelSeries) {
            modelText = modelSeries;
        }
        modelEl.textContent = modelText;

        // 显示种子
        seedEl.textContent = input.seed !== undefined ? input.seed : '未知';

        // 显示词条(用中文逗号隔开,带权重)
        const rawPrompt = input.rawPrompt || [];
        const formattedPrompts = rawPrompt
            .map(p => {
                const weight = p.weight;
                let text = '';

                // 根据类型格式化
                if (p.type === 'oc_vtoken_adaptor') {
                    // 角色引用:@角色名:权重(不加括号)
                    text = `@${p.name || ''}`;
                } else if (p.type === 'elementum') {
                    // 元素引用:/元素名:权重(不加括号)
                    text = `/${p.name || ''}`;
                } else if (p.type === 'freetext') {
                    // 自由文本
                    text = p.value || '';
                    // 权重不为 1 时显示权重(加括号)
                    if (weight !== undefined && weight !== 1 && weight !== 1.0) {
                        const weightStr = parseFloat(weight.toFixed(1));
                        return `(${text}:${weightStr})`;
                    }
                    return text;
                } else {
                    // 其他类型跳过
                    return null;
                }

                // 角色和元素:权重不为 1 时显示权重(不加括号)
                if (weight !== undefined && weight !== 1 && weight !== 1.0) {
                    const weightStr = parseFloat(weight.toFixed(1));
                    return `${text}:${weightStr}`;
                }
                return text;
            })
            .filter(v => v);

        if (formattedPrompts.length === 0) {
            promptsEl.textContent = '无词条';
            currentPromptsText = '无词条';
        } else {
            currentPromptsText = formattedPrompts.join(',');
            promptsEl.textContent = currentPromptsText;
        }

    } catch (e) {
        console.error('获取图片详情失败:', e);
        promptsEl.textContent = `获取失败:${e.message}`;
    }
}

function copyPrompts() {
    if (!currentPromptsText) {
        showToast('暂无可复制的词条');
        return;
    }

    navigator.clipboard.writeText(currentPromptsText).then(() => {
        showToast('已复制词条');
    }).catch(() => {
        showToast('复制失败');
    });
}

function closeImageDetail() {
    const modal = document.getElementById('image-detail-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

// 点击弹窗外部关闭
document.addEventListener('click', (e) => {
    const modal = document.getElementById('image-detail-modal');
    if (modal && e.target === modal) {
        closeImageDetail();
    }
});




// ============ Danbooru 标签探索 ============

let danbooruCurrentPage = 1;
let danbooruCurrentTags = [];
let danbooruAllPosts = [];
const DANBOoru_POSTS_PER_PAGE = 20;
const DANBOORU_MAX_POSTS = 200;

// 已选词条管理
let selectedTagsSet = new Set();

// 搜索图片(使用 Safebooru API,国内可访问)
async function searchDanbooruPosts(tags, page = 1) {
    const response = await fetch(
        `https://safebooru.donmai.us/posts.json?tags=${tags.join('+')}&limit=${DANBOoru_POSTS_PER_PAGE}&page=${page}`
    );

    if (!response.ok) {
        throw new Error(`API 请求失败:${response.status}`);
    }

    const posts = await response.json();
    return posts;
}

// 获取帖子详情
async function getPostDetail(postId) {
    const response = await fetch(
        `https://safebooru.donmai.us/posts/${postId}.json`
    );

    if (!response.ok) {
        throw new Error(`获取详情失败:${response.status}`);
    }

    return await response.json();
}

// 渲染图片网格
function renderPostGrid(posts) {
    const grid = document.getElementById('danbooru-grid');
    if (!grid) return;

    grid.innerHTML = '';

    posts.forEach(post => {
        const item = document.createElement('div');
        item.className = 'danbooru-item';

        const img = document.createElement('img');
        img.src = post.preview_file_url || post.file_url;
        img.alt = post.tag_string_general;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer-when-downgrade';
        img.addEventListener('click', () => showPostDetailModal(post.id));

        item.appendChild(img);
        grid.appendChild(item);
    });
}

// 显示帖子详情弹窗
async function showPostDetailModal(postId) {
    const modal = document.getElementById('danbooru-detail-modal');
    const statusEl = document.getElementById('detail-status');
    const detailTagsEl = document.getElementById('detail-tags');
    const fullTagsEl = document.getElementById('full-tags-display');

    if (!modal) return;

    // 隐藏旧内容,避免闪烁
    detailTagsEl.style.display = 'none';
    fullTagsEl.style.display = 'none';

    // 重置已选词条
    selectedTagsSet.clear();
    updateSelectedTagsTextarea();

    // 先显示弹窗
    modal.style.display = 'block';
    statusEl.textContent = '加载详情中...';

    // 清空旧图片
    document.getElementById('detail-image').src = '';

    try {
        const post = await getPostDetail(postId);

        // 大图片
        document.getElementById('detail-image').src = post.large_file_url || post.file_url;

        // 信息
        document.getElementById('detail-id').textContent = post.id;
        document.getElementById('detail-resolution').textContent = `${post.image_width}x${post.image_height}`;
        document.getElementById('detail-score').textContent = post.score;
        document.getElementById('detail-favs').textContent = post.fav_count || 0;

        // 标签分类(按顺序:画师、角色、版权、一般、元标签)
        const categories = [
            { name: '画师', tags: (post.tag_string_artist || '').split(' ').filter(t => t) },
            { name: '角色', tags: (post.tag_string_character || '').split(' ').filter(t => t) },
            { name: '版权', tags: (post.tag_string_copyright || '').split(' ').filter(t => t) },
            { name: '一般', tags: (post.tag_string_general || '').split(' ').filter(t => t) },
            { name: '元标签', tags: (post.tag_string_meta || '').split(' ').filter(t => t) }
        ];

        // 渲染词条
        let tagsHTML = '';
        for (const cat of categories) {
            if (cat.tags.length > 0) {
                tagsHTML += `
                    <div class="tag-category">
                        <strong>${cat.name} (${cat.tags.length}):</strong>
                        <div class="tag-list">
                            ${cat.tags.map(tag => `<span class="tag-item" data-tag="${tag}" onclick="toggleTag('${tag}')">${tag}</span>`).join('')}
                        </div>
                    </div>
                `;
            }
        }
        detailTagsEl.innerHTML = tagsHTML;
        detailTagsEl.style.display = 'block';

        // 完整标签显示
        const allTagsFlat = categories.flatMap(c => c.tags);
        fullTagsEl.textContent = allTagsFlat.join(', ');
        fullTagsEl.style.display = 'block';

        // 复制已选按钮
        document.getElementById('copy-selected-tags-btn').onclick = () => {
            const text = document.getElementById('selected-tags-textarea').value;
            if (text.trim()) {
                navigator.clipboard.writeText(text);
                showToast('已选词条已复制');
            } else {
                showToast('没有已选词条');
            }
        };

        // 清空按钮
        document.getElementById('clear-selected-tags-btn').onclick = () => {
            selectedTagsSet.clear();
            updateSelectedTagsTextarea();

            // 移除所有词条的选中状态
            document.querySelectorAll('.tag-item.selected').forEach(el => {
                el.classList.remove('selected');
            });
        };

        // 转翻译按钮
        document.getElementById('translate-selected-tags-btn').onclick = () => {
            const text = Array.from(selectedTagsSet).join(', ');
            if (!text.trim()) {
                showToast('没有已选词条');
                return;
            }

            // 切换到翻译页
            switchPage('translate');

            // 填充文本并自动翻译
            setTimeout(() => {
                const input = document.getElementById('translate-input');
                if (input) {
                    input.value = text;
                    doTranslate();
                }
            }, 300);
        };

        // 复制全标签按钮
        document.getElementById('copy-all-tags-btn').onclick = () => {
            const text = allTagsFlat.join(', ');
            navigator.clipboard.writeText(text);
            showToast('完整标签已复制');
        };

        // 原链接
        document.getElementById('open-danbooru-btn').onclick = () => {
            window.open(`https://safebooru.donmai.us/posts/${post.id}`, '_blank');
        };

        statusEl.textContent = '';

    } catch (e) {
        console.error('加载详情失败:', e);
        statusEl.textContent = `加载失败:${e.message}`;
    }
}

// 切换词条(添加/移除)
function toggleTag(tag) {
    if (selectedTagsSet.has(tag)) {
        selectedTagsSet.delete(tag);
        const el = document.querySelector(`.tag-item[data-tag="${tag}"]`);
        if (el) el.classList.remove('selected');
    } else {
        selectedTagsSet.add(tag);
        const el = document.querySelector(`.tag-item[data-tag="${tag}"]`);
        if (el) el.classList.add('selected');
    }
    updateSelectedTagsTextarea();
}

// 更新已选词条文本框
function updateSelectedTagsTextarea() {
    const textarea = document.getElementById('selected-tags-textarea');
    if (textarea) {
        textarea.value = Array.from(selectedTagsSet).join(',');
    }
}
// 隐藏页链接点击(新标签页打开)
document.querySelectorAll('.hidden-link[data-url]').forEach(link => {
    link.addEventListener('click', () => {
        const url = link.dataset.url;
        window.open(url, '_blank');
    });
});

function closeDanbooruDetailModal() {
    const modal = document.getElementById('danbooru-detail-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 更新分页 UI
function updateDanbooruPagination() {
    const pageEl = document.getElementById('danbooru-current-page');
    const inputEl = document.getElementById('danbooru-page-input');
    const countEl = document.getElementById('danbooru-post-count');

    if (pageEl) pageEl.textContent = danbooruCurrentPage;
    if (inputEl) inputEl.value = danbooruCurrentPage;
    if (countEl) countEl.textContent = `第 ${danbooruCurrentPage} 页`;
}

// 加载指定页(严格分页,只显示当前页)
async function loadDanbooruPage(page) {
    if (page < 1) page = 1;

    const statusEl = document.getElementById('danbooru-status');

    try {
        const posts = await searchDanbooruPosts(danbooruCurrentTags, page);

        if (posts.length === 0) {
            showToast('已经是最后一页了');
            return;
        }

        // 只保留当前页(严格分页)
        danbooruCurrentPage = page;

        // 渲染
        renderPostGrid(posts);
        updateDanbooruPagination();

    } catch (e) {
        console.error('加载失败:', e);
        statusEl.textContent = `加载失败:${e.message}`;
    }
}

// 搜索
async function searchDanbooru() {
    const input = document.getElementById('danbooru-search-input');
    const tags = input.value.split(/[\s,]+/).filter(t => t);

    if (tags.length === 0) {
        showToast('请输入标签');
        return;
    }

    danbooruCurrentTags = tags;
    danbooruAllPosts = [];
    danbooruCurrentPage = 1;

    await loadDanbooruPage(1);
    updateDanbooruEmptyState();
}

// 上一页
function danbooruPrevPage() {
    if (danbooruCurrentPage > 1) {
        loadDanbooruPage(danbooruCurrentPage - 1);
    }
}

// 下一页
function danbooruNextPage() {
    if (danbooruAllPosts.length >= DANBOORU_MAX_POSTS) {
        showToast(`已加载 ${DANBOORU_MAX_POSTS} 张,达到上限`);
        return;
    }
    loadDanbooruPage(danbooruCurrentPage + 1);
}

// 跳页
function danbooruJumpToPage() {
    const input = document.getElementById('danbooru-page-input');
    const targetPage = parseInt(input.value);

    if (targetPage && targetPage > 0) {
        loadDanbooruPage(targetPage);
    }
}

// 清空
function clearDanbooruResults() {
    danbooruCurrentTags = [];
    danbooruAllPosts = [];
    danbooruCurrentPage = 1;

    const grid = document.getElementById('danbooru-grid');
    if (grid) grid.innerHTML = '';

    updateDanbooruPagination();
    updateDanbooruEmptyState();
}

// 初始化 Danbooru 探索
function setupDanbooruExplorer() {
    const searchBtn = document.getElementById('danbooru-search-btn');
    const prevBtn = document.getElementById('danbooru-prev-btn');
    const nextBtn = document.getElementById('danbooru-next-btn');
    const jumpBtn = document.getElementById('danbooru-jump-btn');
    const clearBtn = document.getElementById('danbooru-clear-btn');

    if (searchBtn) searchBtn.addEventListener('click', searchDanbooru);
    if (prevBtn) prevBtn.addEventListener('click', danbooruPrevPage);
    if (nextBtn) nextBtn.addEventListener('click', danbooruNextPage);
    if (jumpBtn) jumpBtn.addEventListener('click', danbooruJumpToPage);
    if (clearBtn) clearBtn.addEventListener('click', clearDanbooruResults);

    // 回车搜索
    const input = document.getElementById('danbooru-search-input');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchDanbooru();
        });
    }

    // 快速标签点击
    document.querySelectorAll('.quick-tag').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            const input = document.getElementById('danbooru-search-input');
            if (input) {
                input.value = tag;
            }
            searchDanbooru();
        });
    });

    // 初始化时显示空状态
    updateDanbooruEmptyState();

    // 初始化分页 UI
    updateDanbooruPagination();
}

// 更新分页 UI(生成页码按钮)
function updateDanbooruPagination() {
    const numbersContainer = document.getElementById('danbooru-page-numbers');
    const prevBtn = document.getElementById('danbooru-prev-btn');
    const nextBtn = document.getElementById('danbooru-next-btn');

    if (!numbersContainer) return;

    numbersContainer.innerHTML = '';

    // 生成页码按钮(最多显示 5 个)
    const maxVisible = 5;
    let startPage = Math.max(1, danbooruCurrentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(startPage + maxVisible - 1, 100); // 假设最多 100 页

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `pagination-btn${i === danbooruCurrentPage ? ' active' : ''}`;
        btn.textContent = i;
        btn.addEventListener('click', () => {
            loadDanbooruPage(i);
        });
        numbersContainer.appendChild(btn);
    }

    // 更新上一页/下一页按钮状态
    if (prevBtn) {
        prevBtn.disabled = danbooruCurrentPage <= 1;
    }
    if (nextBtn) {
        // 这里可以添加更多逻辑判断是否还有下一页
    }
}

// 更新空状态显示
function updateDanbooruEmptyState() {
    const emptyState = document.getElementById('danbooru-empty-state');
    const grid = document.getElementById('danbooru-grid');
    const status = document.getElementById('danbooru-status');

    if (!emptyState || !grid) return;

    // 没有搜索结果且没有标签时显示空状态
    if (danbooruCurrentTags.length === 0 && grid.children.length === 0) {
        emptyState.classList.add('show');
        if (status) status.textContent = '';
    } else {
        emptyState.classList.remove('show');
    }
}

// ============ 翻译功能 ============

// 翻译文本(根据用户选择使用 API)
async function translateText(text, from, to) {
    if (!text || !text.trim()) {
        return '';
    }

    // 根据用户选择决定使用哪个 API
    if (translateApiChoice === 'google') {
        return await translateWithGoogle(text, from, to);
    } else if (translateApiChoice === 'mymemory') {
        return await translateWithMyMemory(text, from, to);
    } else {
        // 自动:Google → MyMemory
        try {
            return await translateWithGoogle(text, from, to);
        } catch (e) {
            console.log('Google 失败,切换到 MyMemory:', e.message);
            return await translateWithMyMemory(text, from, to);
        }
    }
}

// Google Translate
async function translateWithGoogle(text, from, to) {
    const sourceLang = from === 'auto' ? 'auto' : from;
    const url = `https://translate.googleapis.com/translate_a/t?client=gtx&sl=${sourceLang}&tl=${to}&q=${encodeURIComponent(text)}`;

    console.log('翻译请求 (Google):', url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Google 翻译响应:', data);

        if (Array.isArray(data) && data.length > 0) {
            const result = Array.isArray(data[0]) ? data[0][0] : data[0];
            if (result) return result;
        }

        throw new Error('Google 翻译结果为空');
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

// MyMemory
async function translateWithMyMemory(text, from, to) {
    const sourceLang = from === 'auto' ? 'autodetect' : from;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${to}`;

    console.log('翻译请求 (MyMemory):', url);

    const response = await fetch(url, { timeout: 5000 });
    const data = await response.json();

    console.log('MyMemory 翻译响应:', data);

    if (data.responseStatus === 200 && data.responseData) {
        return data.responseData.translatedText || '';
    }

    throw new Error(data.responseDetails || 'MyMemory 翻译失败');
}

// 执行翻译
async function doTranslate() {
    const input = document.getElementById('translate-input');
    const output = document.getElementById('translate-output');
    const status = document.getElementById('translate-status');
    const fromLang = document.getElementById('translate-from').value;
    const toLang = document.getElementById('translate-to').value;

    if (!input || !output || !status) return;

    const text = input.value.trim();
    if (!text) {
        status.textContent = '请输入要翻译的内容';
        status.style.color = '#ff3b30';
        return;
    }

    // 检查文本长度
    if (text.length > 1000) {
        status.textContent = `文本过长(${text.length} 字),建议分批翻译(每批<500 字)`;
        status.style.color = '#ff9500';
        return;
    }

    status.textContent = '翻译中...';
    status.style.color = '#86868b';
    output.value = '';

    try {
        const result = await translateText(text, fromLang, toLang);
        output.value = result;

        // 检查是否返回原文(可能是未翻译)
        if (result === text || !result) {
            status.textContent = '翻译完成(API 返回原文,可能无对应翻译)';
            status.style.color = '#ff9500';
        } else {
            status.textContent = '翻译完成 ✓';
            status.style.color = '#34c759';
        }

        // 记录使用的 API(调试用)
        console.log('最终翻译结果:', result);
    } catch (e) {
        status.textContent = `翻译失败:${e.message}`;
        status.style.color = '#ff3b30';
        console.error('翻译错误:', e);
    }

    // 显示 API 使用提示(仅调试)
    console.log('翻译完成,检查控制台日志了解使用的 API');
}

// 复制翻译结果
function copyTranslateResult() {
    const output = document.getElementById('translate-output');
    const status = document.getElementById('translate-status');

    if (!output || !status) return;

    const text = output.value.trim();
    if (!text) {
        status.textContent = '没有可复制的内容';
        return;
    }

    navigator.clipboard.writeText(text);
    status.textContent = '已复制到剪贴板';
}

// 翻译页原始文本缓存(用于易译转化还原)
let translateOriginalText = null;

// 翻译 API 选择:'auto' | 'google' | 'mymemory'
let translateApiChoice = 'auto';

// 初始化翻译功能
function setupTranslate() {
    const translateBtn = document.getElementById('translate-btn');
    const copyBtn = document.getElementById('translate-copy-btn');
    const formatBtn = document.getElementById('translate-format-btn');
    const apiBtn = document.getElementById('translate-api-btn');
    const swapBtn = document.getElementById('translate-swap-btn');
    const fromSelect = document.getElementById('translate-from');
    const toSelect = document.getElementById('translate-to');
    const input = document.getElementById('translate-input');

    if (translateBtn) translateBtn.addEventListener('click', doTranslate);
    if (copyBtn) copyBtn.addEventListener('click', copyTranslateResult);

    // API 切换按钮
    if (apiBtn) {
        apiBtn.addEventListener('click', () => {
            // 循环切换:auto → google → mymemory → auto
            if (translateApiChoice === 'auto') {
                translateApiChoice = 'google';
                apiBtn.textContent = 'API: Google';
            } else if (translateApiChoice === 'google') {
                translateApiChoice = 'mymemory';
                apiBtn.textContent = 'API: MyMemory';
            } else {
                translateApiChoice = 'auto';
                apiBtn.textContent = 'API: 自动';
            }
            apiBtn.classList.add('btn-primary');
            setTimeout(() => apiBtn.classList.remove('btn-primary'), 300);
        });
    }

    // 易译转化按钮
    if (formatBtn && input) {
        formatBtn.addEventListener('click', () => {
            if (translateOriginalText === null) {
                // 保存原始文本,转换为易译格式
                translateOriginalText = input.value;
                input.value = translateOriginalText
                    .replace(/_/g, ' ')
                    .replace(/,/g, ',')
                    .toLowerCase();
                formatBtn.textContent = '还原格式';
                formatBtn.classList.add('btn-primary');
            } else {
                // 还原原始文本
                input.value = translateOriginalText;
                translateOriginalText = null;
                formatBtn.textContent = '易译转化';
                formatBtn.classList.remove('btn-primary');
            }
        });

        // 输入框内容变化时重置缓存
        input.addEventListener('input', () => {
            translateOriginalText = null;
            formatBtn.textContent = '易译转化';
            formatBtn.classList.remove('btn-primary');
        });
    }

    // 交换语言
    if (swapBtn && fromSelect && toSelect) {
        swapBtn.addEventListener('click', () => {
            // 自动识别时不能交换
            if (fromSelect.value === 'auto') return;

            const temp = fromSelect.value;
            fromSelect.value = toSelect.value;
            toSelect.value = temp;

            updateSwapButton();
        });

        // 监听语言选择变化,更新按钮状态
        fromSelect.addEventListener('change', updateSwapButton);
    }

    function updateSwapButton() {
        if (swapBtn) {
            swapBtn.disabled = (fromSelect.value === 'auto');
        }
    }

    // 初始化按钮状态
    updateSwapButton();

    // Ctrl+Enter 快捷翻译
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                doTranslate();
            }
        });
    }
}

// ============ 历史标签 ============

const TAG_HISTORY_KEY = 'neta_tag_history';
const MAX_VISIBLE_TAGS = 30;
let tagHistoryFolded = true;

function saveTagToHistory(tagName) {
    const history = loadTagHistory();
    // 去重:已存在的先删掉,新的放最前面
    const filtered = history.filter(t => t !== tagName);
    filtered.unshift(tagName);
    // 最多保存 100 个
    const limited = filtered.slice(0, 100);
    localStorage.setItem(TAG_HISTORY_KEY, JSON.stringify(limited));
}

function loadTagHistory() {
    try {
        const data = localStorage.getItem(TAG_HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function renderTagHistory() {
    const container = document.getElementById('tag-history');
    const toggleBtn = document.getElementById('toggle-history-btn');
    if (!container) return;

    const history = loadTagHistory();
    if (history.length === 0) {
        container.innerHTML = '<span style="color: #999; font-size: 14px;">暂无历史标签</span>';
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    const displayTags = tagHistoryFolded ? history.slice(0, MAX_VISIBLE_TAGS) : history;

    container.innerHTML = displayTags.map(tag => `
        <button class="quick-tag" data-tag="${tag}">${tag}</button>
    `).join('');

    // 绑定点击事件
    container.querySelectorAll('.quick-tag').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.getAttribute('data-tag');
            addTagManual(tag);
        });
    });

    // 显示/隐藏展开按钮
    if (toggleBtn) {
        if (history.length > MAX_VISIBLE_TAGS) {
            toggleBtn.style.display = 'block';
            toggleBtn.textContent = tagHistoryFolded
                ? `展开更多 (${history.length - MAX_VISIBLE_TAGS})`
                : '收起';
        } else {
            toggleBtn.style.display = 'none';
        }
    }
}

function toggleTagHistoryFold() {
    tagHistoryFolded = !tagHistoryFolded;
    renderTagHistory();
}

// ============ 点赞记录 ============

function getLikeRecordsKey() {
    if (userProfile && userProfile.uuid) {
        return 'neta_like_records_' + userProfile.uuid;
    }
    return 'neta_like_records';
}

let likeRecordStartTime = null;
let likeRecordStartCount = 0;
let likeNavClickCount = 0;
let likeNavClickTimeout = null;

function saveLikeRecord(record) {
    const records = loadLikeRecords();
    records.unshift(record);
    // 最多保存 50 条
    const limited = records.slice(0, 50);
    localStorage.setItem(getLikeRecordsKey(), JSON.stringify(limited));
}

function loadLikeRecords() {
    try {
        const data = localStorage.getItem(getLikeRecordsKey());
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function renderLikeRecords() {
    const container = document.getElementById('like-records');
    if (!container) return;

    const records = loadLikeRecords();
    if (records.length === 0) {
        container.innerHTML = '<div style="color: #999; font-size: 14px;">暂无点赞记录</div>';
        return;
    }

    container.innerHTML = records.map(record => {
        const startTime = new Date(record.startTime).toLocaleString('zh-CN');
        const duration = formatDuration(record.duration);
        return `
            <div style="margin-bottom: 6px; font-size: 13px; line-height: 1.6;">
                <span style="color: #666;">[${startTime}]</span>
                运行 ${duration},点赞 <strong>${record.count}</strong> 个
            </div>
        `;
    }).join('');
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}小时${minutes % 60}分${seconds % 60}秒`;
    } else if (minutes > 0) {
        return `${minutes}分${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}

function showLikeRecords() {
    const card = document.getElementById('like-records-card');
    if (card) {
        card.style.display = 'block';
        renderLikeRecords();
    }
}

function hideLikeRecords() {
    const card = document.getElementById('like-records-card');
    if (card) {
        card.style.display = 'none';
    }
}

// ============ Minecraft 像素画生成器 ============

// Minecraft 方块颜色表(平均RGB值)
const minecraftBlocks = [
    { name: '白色羊毛', color: [233, 236, 236] },
    { name: '橙色羊毛', color: [234, 153, 39] },
    { name: '品红色羊毛', color: [199, 78, 189] },
    { name: '浅蓝色羊毛', color: [58, 179, 218] },
    { name: '黄色羊毛', color: [248, 198, 39] },
    { name: '黄绿色羊毛', color: [127, 194, 41] },
    { name: '粉色羊毛', color: [243, 139, 170] },
    { name: '灰色羊毛', color: [71, 79, 82] },
    { name: '浅灰色羊毛', color: [156, 157, 151] },
    { name: '青色羊毛', color: [38, 113, 145] },
    { name: '紫色羊毛', color: [126, 61, 191] },
    { name: '蓝色羊毛', color: [60, 68, 170] },
    { name: '棕色羊毛', color: [114, 71, 40] },
    { name: '绿色羊毛', color: [84, 109, 27] },
    { name: '红色羊毛', color: [161, 39, 34] },
    { name: '黑色羊毛', color: [29, 27, 27] },
    { name: '白色混凝土', color: [210, 210, 210] },
    { name: '橙色混凝土', color: [225, 130, 30] },
    { name: '品红色混凝土', color: [180, 70, 170] },
    { name: '浅蓝色混凝土', color: [50, 150, 200] },
    { name: '黄色混凝土', color: [240, 180, 30] },
    { name: '黄绿色混凝土', color: [100, 170, 30] },
    { name: '粉色混凝土', color: [230, 120, 150] },
    { name: '灰色混凝土', color: [60, 60, 60] },
    { name: '浅灰色混凝土', color: [130, 130, 125] },
    { name: '青色混凝土', color: [30, 100, 130] },
    { name: '紫色混凝土', color: [100, 50, 160] },
    { name: '蓝色混凝土', color: [40, 50, 140] },
    { name: '棕色混凝土', color: [90, 60, 30] },
    { name: '绿色混凝土', color: [70, 90, 20] },
    { name: '红色混凝土', color: [140, 30, 30] },
    { name: '黑色混凝土', color: [10, 10, 10] },
    { name: '白色陶瓦', color: [210, 195, 185] },
    { name: '橙色陶瓦', color: [170, 90, 50] },
    { name: '品红色陶瓦', color: [150, 75, 95] },
    { name: '浅蓝色陶瓦', color: [115, 130, 150] },
    { name: '黄色陶瓦', color: [190, 150, 70] },
    { name: '黄绿色陶瓦', color: [95, 110, 55] },
    { name: '粉色陶瓦', color: [170, 100, 110] },
    { name: '灰色陶瓦', color: [65, 60, 60] },
    { name: '浅灰色陶瓦', color: [135, 115, 105] },
    { name: '青色陶瓦', color: [60, 85, 95] },
    { name: '紫色陶瓦', color: [110, 70, 90] },
    { name: '蓝色陶瓦', color: [65, 65, 95] },
    { name: '棕色陶瓦', color: [100, 65, 50] },
    { name: '绿色陶瓦', color: [80, 90, 50] },
    { name: '红色陶瓦', color: [145, 60, 50] },
    { name: '黑色陶瓦', color: [40, 30, 25] },
    { name: '石头', color: [139, 139, 139] },
    { name: '紫颂块', color: [170, 130, 190] },
    { name: '紫珀块', color: [150, 100, 170] },
    { name: '海晶灯', color: [80, 200, 220] },
    { name: '骨块', color: [230, 226, 210] },
    { name: '铁块', color: [192, 192, 192] },
    { name: '黑曜石', color: [20, 13, 34] },
    { name: '雪块', color: [250, 250, 255] },
    { name: '末地石', color: [240, 229, 160] },
    { name: '岩浆块', color: [200, 80, 30] },
    { name: '钻石块', color: [92, 219, 213] },
    { name: '金块', color: [255, 215, 0] },
    { name: '红石块', color: [176, 0, 0] },
    { name: '绿宝石块', color: [23, 221, 98] },
    { name: '青金石块', color: [30, 50, 120] },
    { name: '木板', color: [160, 114, 76] },
    { name: '圆石', color: [119, 119, 119] },
    { name: '砂岩', color: [220, 182, 133] },
    { name: '草方块', color: [93, 155, 59] },
    { name: '泥土', color: [139, 90, 43] },
    { name: '南瓜', color: [232, 160, 48] },
    { name: '下界岩', color: [112, 32, 32] },
    { name: '浮冰', color: [170, 210, 240] },
    { name: '蓝冰', color: [120, 180, 230] },
    { name: '冰块', color: [200, 230, 250] },
    { name: '紫水晶块', color: [150, 100, 200] },
    { name: '棱镜砖', color: [180, 200, 190] },
    { name: '浅粉色混凝土', color: [240, 180, 200] },
    { name: '深粉色混凝土', color: [200, 80, 120] },
    { name: '樱花木板', color: [210, 170, 170] },
    { name: '樱花树叶', color: [220, 160, 190] },
    { name: '末地烛', color: [220, 210, 230] },
    { name: '紫水晶簇', color: [140, 80, 180] },
    { name: '铜块', color: [180, 110, 70] },
    { name: '石英块', color: [240, 235, 225] },
    { name: '红砖', color: [150, 70, 50] },
    { name: '海晶石', color: [70, 130, 130] },
    { name: '史莱姆块', color: [100, 200, 80] },
    { name: '蜂蜜块', color: [230, 170, 50] },
    { name: '西瓜', color: [90, 150, 60] },
    { name: '锈蚀铜块', color: [80, 130, 110] },
    { name: '涂蜡铜块', color: [190, 120, 80] },
    { name: '暗棱镜砖', color: [80, 100, 90] },
    { name: '海晶石砖', color: [60, 110, 110] },
    { name: '暗海晶石', color: [40, 70, 70] },
    { name: '深板岩', color: [70, 70, 80] },
    { name: '凝灰岩', color: [100, 100, 105] },
    { name: '方解石', color: [235, 230, 220] },
    { name: '滴水石块', color: [150, 140, 130] },
];

// 像素画状态
let pixelOriginalImage = null;
let pixelResultData = null;
let pixelBlockMap = null; // 二维数组,保存每个像素对应的方块名称 [y][x] => blockName
let highlightedBlock = null; // 当前高亮的方块名称(同色全部红框)
let selectedPixel = null; // 当前选中的具体像素 {x, y}(RGB动态变色框)

// 红均值颜色距离算法(更符合人眼感知)
function colorDistanceRedmean(c1, c2) {
    const rMean = (c1[0] + c2[0]) / 2;
    const dr = c1[0] - c2[0];
    const dg = c1[1] - c2[1];
    const db = c1[2] - c2[2];
    return Math.sqrt(
        (2 + rMean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rMean) / 256) * db * db
    );
}

// ========== CIE Lab 颜色空间转换 ==========

// RGB转XYZ
function rgbToXyz(r, g, b) {
    r = r / 255;
    g = g / 255;
    b = b / 255;

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    r *= 100;
    g *= 100;
    b *= 100;

    return [
        r * 0.4124 + g * 0.3576 + b * 0.1805,
        r * 0.2126 + g * 0.7152 + b * 0.0722,
        r * 0.0193 + g * 0.1192 + b * 0.9505
    ];
}

// XYZ转Lab
function xyzToLab(x, y, z) {
    const xn = 95.047;
    const yn = 100.000;
    const zn = 108.883;

    x = x / xn;
    y = y / yn;
    z = z / zn;

    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);

    return [
        (116 * y) - 16,
        500 * (x - y),
        200 * (y - z)
    ];
}

// RGB转Lab
function rgbToLab(r, g, b) {
    const xyz = rgbToXyz(r, g, b);
    return xyzToLab(xyz[0], xyz[1], xyz[2]);
}

// CIEDE2000色差公式
function colorDistanceCIEDE2000(c1, c2) {
    const lab1 = rgbToLab(c1[0], c1[1], c1[2]);
    const lab2 = rgbToLab(c2[0], c2[1], c2[2]);

    const L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    const L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];

    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cb = (C1 + C2) / 2;

    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
    const a1p = a1 * (1 + G);
    const a2p = a2 * (1 + G);

    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);

    let h1p = Math.atan2(b1, a1p);
    if (h1p < 0) h1p += 2 * Math.PI;
    let h2p = Math.atan2(b2, a2p);
    if (h2p < 0) h2p += 2 * Math.PI;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (Math.abs(dhp) > Math.PI) {
            if (dhp > Math.PI) dhp -= 2 * Math.PI;
            else dhp += 2 * Math.PI;
        }
    }

    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2);

    const Lp = (L1 + L2) / 2;
    const Cp = (C1p + C2p) / 2;

    let hp = 0;
    if (C1p * C2p !== 0) {
        hp = (h1p + h2p) / 2;
        if (Math.abs(h1p - h2p) > Math.PI) {
            if (h1p + h2p < 2 * Math.PI) hp += Math.PI;
            else hp -= Math.PI;
        }
    }

    const T = 1 - 0.17 * Math.cos(hp - Math.PI/6) + 0.24 * Math.cos(2 * hp) + 0.32 * Math.cos(3 * hp + Math.PI/30) - 0.2 * Math.cos(4 * hp - 63 * Math.PI/180);

    const dTheta = 30 * Math.PI / 180 * Math.exp(-Math.pow((hp - 275 * Math.PI / 180) / (25 * Math.PI / 180), 2));
    const RC = 2 * Math.sqrt(Math.pow(Cp, 7) / (Math.pow(Cp, 7) + Math.pow(25, 7)));

    const SL = 1 + (0.015 * Math.pow(Lp - 50, 2)) / Math.sqrt(20 + Math.pow(Lp - 50, 2));
    const SC = 1 + 0.045 * Cp;
    const SH = 1 + 0.015 * Cp * T;

    const RT = -Math.sin(2 * dTheta) * RC;

    return Math.sqrt(
        Math.pow(dLp / SL, 2) +
        Math.pow(dCp / SC, 2) +
        Math.pow(dHp / SH, 2) +
        RT * (dCp / SC) * (dHp / SH)
    );
}

// 通用颜色距离函数
function colorDistance(c1, c2, algorithm = 'redmean') {
    if (algorithm === 'ciede2000') {
        return colorDistanceCIEDE2000(c1, c2);
    }
    return colorDistanceRedmean(c1, c2);
}

// ========== Sobel 边缘检测 ==========

// Sobel 边缘检测
function computeSobelEdgeMap(pixels, width, height) {
    // pixels 是 Float32Array,每 3 个值代表一个像素的 RGB
    const edgeMap = new Float32Array(width * height);

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 3;

            // Sobel 算子:水平梯度 Gx 和垂直梯度 Gy
            // 使用亮度值计算边缘
            const getLum = (px, py) => {
                const i = (py * width + px) * 3;
                return 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            };

            const gx = -getLum(x - 1, y - 1) - 2 * getLum(x - 1, y) - getLum(x - 1, y + 1)
                     + getLum(x + 1, y - 1) + 2 * getLum(x + 1, y) + getLum(x + 1, y + 1);
            const gy = -getLum(x - 1, y - 1) - 2 * getLum(x, y - 1) - getLum(x + 1, y - 1)
                     + getLum(x - 1, y + 1) + 2 * getLum(x, y + 1) + getLum(x + 1, y + 1);

            edgeMap[y * width + x] = Math.sqrt(gx * gx + gy * gy);
        }
    }

    // 归一化到 0-1
    let maxEdge = 0;
    for (let i = 0; i < edgeMap.length; i++) {
        if (edgeMap[i] > maxEdge) maxEdge = edgeMap[i];
    }
    if (maxEdge > 0) {
        for (let i = 0; i < edgeMap.length; i++) {
            edgeMap[i] /= maxEdge;
        }
    }

    return edgeMap;
}

// ========== 抖动算法 ==========

// Bayer抖动矩阵(4x4)
const bayerMatrix4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
];

// 应用Bayer有序抖动
function applyBayerDither(pixels, width, height, amount = 0.5) {
    const result = new Float32Array(width * height * 3);
    const threshold = amount * 255 / 16;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            const bayer = bayerMatrix4[y % 4][x % 4];
            const offset = (bayer - 8) * threshold;

            result[i] = Math.max(0, Math.min(255, pixels[i] + offset));
            result[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + offset));
            result[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + offset));
        }
    }

    return result;
}

// 应用Floyd-Steinberg误差扩散抖动(带边缘保护)
function applyFloydSteinbergDitherWithEdgeProtection(pixels, width, height, blocks, colorAlgorithm, edgeMap, edgeThreshold) {
    // 创建误差缓冲区
    const errors = new Float32Array(width * height * 3);

    // 复制原始像素
    const result = new Float32Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
        result[i] = pixels[i];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;
            const edgeVal = edgeMap ? edgeMap[y * width + x] : 0;

            // 如果边缘强度超过阈值,跳过抖动,使用原始颜色
            if (edgeVal > (1 - edgeThreshold)) {
                continue;
            }

            // 加上累积的误差
            let r = result[i] + errors[i];
            let g = result[i + 1] + errors[i + 1];
            let b = result[i + 2] + errors[i + 2];

            // 限制范围
            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            b = Math.max(0, Math.min(255, b));

            // 找到最接近的方块颜色
            let closestBlock = null;
            let minDist = Infinity;

            for (const block of blocks) {
                const blockColor = block.color;
                const dist = colorDistance([r, g, b], blockColor, colorAlgorithm);
                if (dist < minDist) {
                    minDist = dist;
                    closestBlock = blockColor;
                }
            }

            if (closestBlock) {
                // 计算误差
                const errR = r - closestBlock[0];
                const errG = g - closestBlock[1];
                const errB = b - closestBlock[2];

                // 将误差扩散到周围像素(仅扩散到非边缘像素)
                const spreadError = (nx, ny, weight) => {
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const neighborEdge = edgeMap ? edgeMap[ny * width + nx] : 0;
                        if (neighborEdge <= (1 - edgeThreshold)) {
                            const nIdx = (ny * width + nx) * 3;
                            errors[nIdx] += errR * weight;
                            errors[nIdx + 1] += errG * weight;
                            errors[nIdx + 2] += errB * weight;
                        }
                    }
                };

                spreadError(x + 1, y, 7 / 16);
                spreadError(x - 1, y + 1, 3 / 16);
                spreadError(x, y + 1, 5 / 16);
                spreadError(x + 1, y + 1, 1 / 16);

                // 保存量化后的颜色
                result[i] = closestBlock[0];
                result[i + 1] = closestBlock[1];
                result[i + 2] = closestBlock[2];
            }
        }
    }

    return result;
}

// 应用Floyd-Steinberg误差扩散抖动
function applyFloydSteinbergDither(pixels, width, height, blocks, colorAlgorithm) {
    // 创建误差缓冲区
    const errors = new Float32Array(width * height * 3);

    // 复制原始像素
    const result = new Float32Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) {
        result[i] = pixels[i];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 3;

            // 加上累积的误差
            let r = result[i] + errors[i];
            let g = result[i + 1] + errors[i + 1];
            let b = result[i + 2] + errors[i + 2];

            // 限制范围
            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            b = Math.max(0, Math.min(255, b));

            // 找到最接近的方块颜色
            let closestBlock = null;
            let minDist = Infinity;

            for (const block of blocks) {
                const blockColor = block.color;
                const dist = colorDistance([r, g, b], blockColor, colorAlgorithm);
                if (dist < minDist) {
                    minDist = dist;
                    closestBlock = blockColor;
                }
            }

            if (closestBlock) {
                // 计算误差
                const errR = r - closestBlock[0];
                const errG = g - closestBlock[1];
                const errB = b - closestBlock[2];

                // 将误差扩散到周围像素
                // 右
                if (x + 1 < width) {
                    const rightIdx = (y * width + x + 1) * 3;
                    errors[rightIdx] += errR * 7 / 16;
                    errors[rightIdx + 1] += errG * 7 / 16;
                    errors[rightIdx + 2] += errB * 7 / 16;
                }
                // 左下
                if (x > 0 && y + 1 < height) {
                    const blIdx = ((y + 1) * width + x - 1) * 3;
                    errors[blIdx] += errR * 3 / 16;
                    errors[blIdx + 1] += errG * 3 / 16;
                    errors[blIdx + 2] += errB * 3 / 16;
                }
                // 正下
                if (y + 1 < height) {
                    const downIdx = ((y + 1) * width + x) * 3;
                    errors[downIdx] += errR * 5 / 16;
                    errors[downIdx + 1] += errG * 5 / 16;
                    errors[downIdx + 2] += errB * 5 / 16;
                }
                // 右下
                if (x + 1 < width && y + 1 < height) {
                    const brIdx = ((y + 1) * width + x + 1) * 3;
                    errors[brIdx] += errR * 1 / 16;
                    errors[brIdx + 1] += errG * 1 / 16;
                    errors[brIdx + 2] += errB * 1 / 16;
                }

                // 保存量化后的颜色
                result[i] = closestBlock[0];
                result[i + 1] = closestBlock[1];
                result[i + 2] = closestBlock[2];
            }
        }
    }

    return result;
}

// 找到最接近的方块
function findClosestBlock(r, g, b, blocks = minecraftBlocks, algorithm = 'redmean') {
    let minDist = Infinity;
    let closest = null;
    for (const block of blocks) {
        const dist = colorDistance([r, g, b], block.color, algorithm);
        if (dist < minDist) {
            minDist = dist;
            closest = block;
        }
    }
    return closest;
}

// 根据色彩区分度精简方块表
function getReducedBlocks(discrimination) {
    if (discrimination >= 100) {
        return minecraftBlocks;
    }

    const targetCount = Math.max(2, Math.floor(minecraftBlocks.length * discrimination / 100));
    let result = minecraftBlocks.map(b => ({ ...b }));

    while (result.length > targetCount) {
        let minDist = Infinity;
        let minPair = [0, 1];

        for (let i = 0; i < result.length; i++) {
            for (let j = i + 1; j < result.length; j++) {
                const dist = colorDistanceRedmean(result[i].color, result[j].color);
                if (dist < minDist) {
                    minDist = dist;
                    minPair = [i, j];
                }
            }
        }

        result.splice(minPair[1], 1);
    }

    return result;
}

// 计算目标尺寸
function calculateTargetSize(originalWidth, originalHeight) {
    const mode = document.getElementById('pixel-size-mode').value;
    const keepRatio = document.getElementById('pixel-keep-ratio').checked;
    let targetWidth, targetHeight;

    if (mode === 'custom') {
        targetWidth = parseInt(document.getElementById('pixel-width-input').value) || 64;
        targetHeight = parseInt(document.getElementById('pixel-height-input').value) || 64;
        if (keepRatio) {
            // 保持比例,以宽度为准
            targetHeight = Math.round(targetWidth * originalHeight / originalWidth);
        }
    } else {
        const size = parseInt(document.getElementById('pixel-size-slider').value) || 64;
        if (mode === 'longside') {
            if (originalWidth >= originalHeight) {
                targetWidth = size;
                targetHeight = Math.round(size * originalHeight / originalWidth);
            } else {
                targetHeight = size;
                targetWidth = Math.round(size * originalWidth / originalHeight);
            }
        } else if (mode === 'width') {
            targetWidth = size;
            targetHeight = Math.round(size * originalHeight / originalWidth);
        } else if (mode === 'height') {
            targetHeight = size;
            targetWidth = Math.round(size * originalWidth / originalHeight);
        }
    }

    // 确保至少1像素
    targetWidth = Math.max(1, targetWidth);
    targetHeight = Math.max(1, targetHeight);

    return { width: targetWidth, height: targetHeight };
}

// 计算每个像素的显示大小(让预览图保持合适的大小)
function calculatePixelDisplaySize(targetWidth, targetHeight) {
    const maxDisplayWidth = 600;
    const maxDisplayHeight = 500;
    const pixelSizeByWidth = Math.floor(maxDisplayWidth / targetWidth);
    const pixelSizeByHeight = Math.floor(maxDisplayHeight / targetHeight);
    return Math.max(1, Math.min(pixelSizeByWidth, pixelSizeByHeight));
}

// 绘制像素画到Canvas
function drawPixelArt(ctx, blockMap, blockCounts, pixelSize, highlightBlockName = null) {
    const height = blockMap.length;
    const width = blockMap[0].length;

    // 先清空
    ctx.clearRect(0, 0, width * pixelSize, height * pixelSize);

    // 绘制所有像素方块
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const blockName = blockMap[y][x];
            if (!blockName) continue; // 透明像素

            const blockData = blockCounts[blockName];
            if (!blockData) continue;

            const [r, g, b] = blockData.color;
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
    }

    // 如果有高亮,绘制红框(同色所有方块)
    if (highlightBlockName) {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (blockMap[y][x] === highlightBlockName) {
                    // 如果是选中的像素,跳过(用RGB框单独画)
                    if (selectedPixel && selectedPixel.x === x && selectedPixel.y === y) continue;
                    ctx.strokeRect(
                        x * pixelSize + 0.5,
                        y * pixelSize + 0.5,
                        pixelSize - 1,
                        pixelSize - 1
                    );
                }
            }
        }
    }

    // 选中像素:RGB 动态变色框
    if (selectedPixel) {
        const sx = selectedPixel.x;
        const sy = selectedPixel.y;
        if (sy < height && sx < width && blockMap[sy][sx]) {
            const t = Date.now() / 500; // 动画速度
            const cr = Math.round(128 + 127 * Math.sin(t));
            const cg = Math.round(128 + 127 * Math.sin(t + 2.094)); // +120°
            const cb = Math.round(128 + 127 * Math.sin(t + 4.189)); // +240°
            ctx.strokeStyle = `rgb(${cr}, ${cg}, ${cb})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                sx * pixelSize + 0.5,
                sy * pixelSize + 0.5,
                pixelSize - 1,
                pixelSize - 1
            );
        }
    }
}

// 生成像素画
function generatePixelArt() {
    if (!pixelOriginalImage) {
        showPixelStatus('请先上传图片', 'error');
        return;
    }

    const statusEl = document.getElementById('pixel-status');
    statusEl.textContent = '生成中...';
    statusEl.className = 'status';

    // 重置高亮和选中
    highlightedBlock = null;
    selectedPixel = null;

    // 用setTimeout让UI先更新
    setTimeout(() => {
        try {
            const targetSize = calculateTargetSize(pixelOriginalImage.width, pixelOriginalImage.height);
            const pixelSize = calculatePixelDisplaySize(targetSize.width, targetSize.height);

            // 获取色彩区分度和精简后的方块表
            const discrimination = parseInt(document.getElementById('pixel-discrimination-slider').value) || 100;
            const blocks = getReducedBlocks(discrimination);

            // 获取算法选择
            const colorAlgorithm = document.getElementById('pixel-color-algorithm').value || 'redmean';
            const ditherAlgorithm = document.getElementById('pixel-dither-algorithm').value || 'none';

            const canvas = document.getElementById('pixel-result-canvas');
            const ctx = canvas.getContext('2d');

            // 设置canvas显示尺寸
            canvas.width = targetSize.width * pixelSize;
            canvas.height = targetSize.height * pixelSize;

            // 创建临时canvas来缩放原图
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = targetSize.width;
            tempCanvas.height = targetSize.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(pixelOriginalImage, 0, 0, targetSize.width, targetSize.height);

            // 获取像素数据
            const imageData = tempCtx.getImageData(0, 0, targetSize.width, targetSize.height);
            const data = imageData.data;

            // 提取像素颜色
            const pixels = new Float32Array(targetSize.width * targetSize.height * 3);
            for (let i = 0; i < targetSize.width * targetSize.height; i++) {
                const srcIdx = i * 4;
                const dstIdx = i * 3;
                pixels[dstIdx] = data[srcIdx];
                pixels[dstIdx + 1] = data[srcIdx + 1];
                pixels[dstIdx + 2] = data[srcIdx + 2];
            }

            // 边缘保护:获取边缘强度
            const edgeStrength = parseInt(document.getElementById('pixel-edge-slider').value) || 0;
            let edgeMap = null;
            if (edgeStrength > 0) {
                edgeMap = computeSobelEdgeMap(pixels, targetSize.width, targetSize.height);
            }

            // 应用抖动算法
            let processedPixels = pixels;
            if (ditherAlgorithm === 'bayer' && edgeStrength === 0) {
                processedPixels = applyBayerDither(pixels, targetSize.width, targetSize.height, 0.8);
            } else if (ditherAlgorithm === 'floyd') {
                // Floyd-Steinberg 自带误差扩散,如果开启边缘保护则跳过
                if (edgeStrength > 0) {
                    processedPixels = applyFloydSteinbergDitherWithEdgeProtection(
                        pixels, targetSize.width, targetSize.height, blocks, colorAlgorithm, edgeMap, edgeStrength / 100
                    );
                } else {
                    processedPixels = applyFloydSteinbergDither(pixels, targetSize.width, targetSize.height, blocks, colorAlgorithm);
                }
            }

            // 统计方块和保存像素映射
            const blockCounts = {};
            let totalBlocks = 0;
            pixelBlockMap = [];

            for (let y = 0; y < targetSize.height; y++) {
                pixelBlockMap[y] = [];
                for (let x = 0; x < targetSize.width; x++) {
                    const i4 = (y * targetSize.width + x) * 4;
                    const i3 = (y * targetSize.width + x) * 3;
                    let r = processedPixels[i3];
                    let g = processedPixels[i3 + 1];
                    let b = processedPixels[i3 + 2];
                    const a = data[i4 + 3];

                    if (a < 50) {
                        pixelBlockMap[y][x] = null;
                        continue;
                    }

                    // 边缘保护:强边缘区域使用原始像素颜色匹配
                    if (edgeMap && edgeMap[y * targetSize.width + x] > (1 - edgeStrength / 100)) {
                        r = pixels[i3];
                        g = pixels[i3 + 1];
                        b = pixels[i3 + 2];
                    }

                    const block = findClosestBlock(r, g, b, blocks, colorAlgorithm);
                    const blockName = block.name;

                    pixelBlockMap[y][x] = blockName;

                    // 统计
                    if (!blockCounts[blockName]) {
                        blockCounts[blockName] = { count: 0, color: block.color };
                    }
                    blockCounts[blockName].count++;
                    totalBlocks++;
                }
            }

            // 绘制像素画
            drawPixelArt(ctx, pixelBlockMap, blockCounts, pixelSize);

            // 保存结果数据
            pixelResultData = {
                width: targetSize.width,
                height: targetSize.height,
                totalBlocks: totalBlocks,
                blockCounts: blockCounts,
                pixelSize: pixelSize,
            };

            // 显示结果
            document.getElementById('pixel-content-container').style.display = 'flex';

            // 更新统计信息
            document.getElementById('pixel-stats-size').textContent = `${targetSize.width} × ${targetSize.height}`;
            document.getElementById('pixel-stats-total').textContent = totalBlocks.toLocaleString();
            document.getElementById('pixel-stats-types').textContent = Object.keys(blockCounts).length;

            // 渲染方块列表
            renderBlockList(blockCounts);

            showPixelStatus('生成完成!点击方块可高亮对应位置', 'success');

            // 如果是SVG模式,更新SVG预览
            if (currentPixelMode === 'svg') {
                updateSvgPreview();
            }
        } catch (e) {
            console.error('生成像素画失败:', e);
            showPixelStatus('生成失败:' + e.message, 'error');
        }
    }, 50);
}

// 更新当前选中显示
function updateSelectedBlockDisplay() {
    const selectedEl = document.getElementById('pixel-selected-block');
    const nameEl = document.getElementById('pixel-selected-name');
    const colorEl = document.getElementById('pixel-selected-color');
    const countEl = document.getElementById('pixel-selected-count');

    if (!selectedEl || !pixelResultData) return;

    if (highlightedBlock && pixelResultData.blockCounts[highlightedBlock]) {
        const data = pixelResultData.blockCounts[highlightedBlock];
        const [r, g, b] = data.color;
        nameEl.textContent = highlightedBlock;
        colorEl.style.background = `rgb(${r}, ${g}, ${b})`;
        countEl.textContent = data.count;
        selectedEl.style.display = 'block';
    } else {
        selectedEl.style.display = 'none';
    }
}

// 渲染方块列表
function renderBlockList(blockCounts) {
    const container = document.getElementById('pixel-block-list');
    if (!container) return;

    // 按数量排序
    const sorted = Object.entries(blockCounts).sort((a, b) => b[1].count - a[1].count);

    container.innerHTML = sorted.map(([name, data]) => {
        const [r, g, b] = data.color;
        const isHighlighted = highlightedBlock === name;
        return `
            <div class="pixel-block-item" data-block-name="${name}" style="display: flex; align-items: center; padding: 8px 12px; background: ${isHighlighted ? '#fff0f0' : '#fafafa'}; border-radius: 6px; margin-bottom: 6px; cursor: pointer; transition: all 0.2s; border: 1px solid ${isHighlighted ? '#ff3b30' : 'transparent'};">
                <div style="width: 24px; height: 24px; border-radius: 4px; margin-right: 12px; border: 1px solid #e5e5e5; flex-shrink: 0; background: rgb(${r}, ${g}, ${b});"></div>
                <span style="flex: 1; font-size: 0.9rem; color: #1d1d1f;">${name}</span>
                <span style="font-weight: 600; color: #0071e3;">${data.count}</span>
            </div>
        `;
    }).join('');

    // 绑定点击事件
    container.querySelectorAll('.pixel-block-item').forEach(item => {
        item.addEventListener('click', () => {
            const blockName = item.getAttribute('data-block-name');
            toggleBlockHighlight(blockName);
        });
    });

    // 更新当前选中显示
    updateSelectedBlockDisplay();
}

// 切换方块高亮（从方块列表点击）
function toggleBlockHighlight(blockName) {
    if (!pixelBlockMap || !pixelResultData) return;

    if (highlightedBlock === blockName) {
        // 取消高亮
        highlightedBlock = null;
        selectedPixel = null;
    } else {
        // 设置高亮（同时清除选中像素）
        highlightedBlock = blockName;
        selectedPixel = null;
    }

    // 重新绘制
    const canvas = document.getElementById('pixel-result-canvas');
    const ctx = canvas.getContext('2d');
    drawPixelArt(ctx, pixelBlockMap, pixelResultData.blockCounts, pixelResultData.pixelSize, highlightedBlock);

    // 更新方块列表样式
    renderBlockList(pixelResultData.blockCounts);

    // 如果是SVG模式,也更新SVG
    if (currentPixelMode === 'svg') {
        updateSvgPreview();
    }
}

// 当前预览模式
let currentPixelMode = 'png'; // 'png' 或 'svg'

// 生成SVG代码
function generateSvg(blockMap, blockCounts, pixelSize, highlightBlock = null) {
    if (!blockMap || blockMap.length === 0) return '';

    const height = blockMap.length;
    const width = blockMap[0].length;
    const svgWidth = width * pixelSize;
    const svgHeight = height * pixelSize;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="max-width: 100%; height: auto; display: block; margin: 0 auto;">`;

    // 遍历每个像素,生成rect
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const blockName = blockMap[y][x];
            if (!blockName) continue;

            const blockData = blockCounts[blockName];
            if (!blockData) continue;

            const [r, g, b] = blockData.color;
            const px = x * pixelSize;
            const py = y * pixelSize;

            // 如果是高亮的方块,加边框
            if (highlightBlock && blockName === highlightBlock) {
                svgContent += `<rect x="${px}" y="${py}" width="${pixelSize}" height="${pixelSize}" fill="rgb(${r},${g},${b})" stroke="#ff3b30" stroke-width="1"/>`;
            } else {
                svgContent += `<rect x="${px}" y="${py}" width="${pixelSize}" height="${pixelSize}" fill="rgb(${r},${g},${b})"/>`;
            }
        }
    }

    svgContent += '</svg>';
    return svgContent;
}

// 更新SVG预览
function updateSvgPreview() {
    if (!pixelBlockMap || !pixelResultData) return;

    const svgEl = document.getElementById('pixel-result-svg');
    if (!svgEl) return;

    const svgContent = generateSvg(pixelBlockMap, pixelResultData.blockCounts, pixelResultData.pixelSize, highlightedBlock);
    svgEl.innerHTML = svgContent;
}

// 切换预览模式
function switchPixelMode(mode) {
    if (mode === currentPixelMode) return;

    currentPixelMode = mode;

    const canvas = document.getElementById('pixel-result-canvas');
    const svgEl = document.getElementById('pixel-result-svg');
    const pngBtn = document.getElementById('pixel-mode-png');
    const svgBtn = document.getElementById('pixel-mode-svg');
    const downloadBtn = document.getElementById('pixel-download-btn');
    const downloadSvgBtn = document.getElementById('pixel-download-svg-btn');

    if (!canvas || !svgEl || !pngBtn || !svgBtn) return;

    if (mode === 'png') {
        // 显示PNG
        canvas.style.display = '';
        svgEl.style.display = 'none';
        pngBtn.classList.add('active');
        svgBtn.classList.remove('active');
        pngBtn.style.background = 'white';
        pngBtn.style.color = '#1d1d1f';
        pngBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        svgBtn.style.background = 'transparent';
        svgBtn.style.color = '#86868b';
        svgBtn.style.boxShadow = 'none';
        // 切换下载按钮
        if (downloadBtn) downloadBtn.style.display = '';
        if (downloadSvgBtn) downloadSvgBtn.style.display = 'none';
    } else {
        // 显示SVG
        canvas.style.display = 'none';
        svgEl.style.display = '';
        pngBtn.classList.remove('active');
        svgBtn.classList.add('active');
        pngBtn.style.background = 'transparent';
        pngBtn.style.color = '#86868b';
        pngBtn.style.boxShadow = 'none';
        svgBtn.style.background = 'white';
        svgBtn.style.color = '#1d1d1f';
        svgBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        // 更新SVG内容
        updateSvgPreview();
        // 切换下载按钮
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (downloadSvgBtn) downloadSvgBtn.style.display = '';
    }
}

// 全屏弹窗相关
const baseModalPixelSize = 20; // 100%缩放时的方块大小
let modalPixelSize = 20; // 弹窗中的方块大小

// 打开SVG全屏弹窗
function openSvgModal() {
    if (!pixelBlockMap || !pixelResultData) {
        showPixelStatus('请先生成像素画', 'error');
        return;
    }

    const modal = document.getElementById('pixel-svg-modal');
    if (!modal) return;

    modal.style.display = 'flex';

    // 初始化滑块值
    const slider = document.getElementById('pixel-svg-size-slider');
    const valueEl = document.getElementById('pixel-svg-size-value');
    if (slider && valueEl) {
        const scalePercent = parseInt(slider.value);
        modalPixelSize = Math.round(baseModalPixelSize * scalePercent / 100);
        valueEl.textContent = scalePercent + '%';
    }

    // 更新弹窗中的SVG
    updateModalSvg();
}

// 关闭SVG全屏弹窗
function closeSvgModal() {
    const modal = document.getElementById('pixel-svg-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 更新弹窗中的SVG
function updateModalSvg() {
    if (!pixelBlockMap || !pixelResultData) return;

    const svgEl = document.getElementById('pixel-svg-modal-svg');
    if (!svgEl) return;

    const svgContent = generateSvg(pixelBlockMap, pixelResultData.blockCounts, modalPixelSize, highlightedBlock);
    svgEl.innerHTML = svgContent;
}

// 下载SVG文件
function downloadSvgFile() {
    if (!pixelBlockMap || !pixelResultData) return;

    // 用原始像素大小生成SVG(1像素=1px,保持原始尺寸)
    const svgContent = generateSvg(pixelBlockMap, pixelResultData.blockCounts, 1, highlightedBlock);

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixel-art.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 显示状态

function showPixelStatus(message, type = '') {
    const statusEl = document.getElementById('pixel-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ' ' + type : '');
}

// 下载像素画图片(原始像素尺寸)
function downloadPixelImage() {
    if (!pixelBlockMap || !pixelResultData) return;

    // 创建原始尺寸的canvas
    const downloadCanvas = document.createElement('canvas');
    downloadCanvas.width = pixelResultData.width;
    downloadCanvas.height = pixelResultData.height;
    const downloadCtx = downloadCanvas.getContext('2d');

    // 绘制原始尺寸像素画
    drawPixelArt(downloadCtx, pixelBlockMap, pixelResultData.blockCounts, 1);

    const link = document.createElement('a');
    link.download = 'minecraft-pixel-art.png';
    link.href = downloadCanvas.toDataURL('image/png');
    link.click();
}

// 复制方块清单
function copyBlockList() {
    if (!pixelResultData) return;

    const sorted = Object.entries(pixelResultData.blockCounts).sort((a, b) => b[1].count - a[1].count);

    // 如果有高亮的方块,置顶显示
    if (highlightedBlock) {
        const highlightIndex = sorted.findIndex(([name]) => name === highlightedBlock);
        if (highlightIndex > 0) {
            const [highlightItem] = sorted.splice(highlightIndex, 1);
            sorted.unshift(highlightItem);
        }
    }
    let text = `Minecraft 像素画方块清单\n`;
    text += `尺寸:${pixelResultData.width} × ${pixelResultData.height}\n`;
    text += `总方块数:${pixelResultData.totalBlocks}\n`;
    text += `方块种类:${sorted.length}\n`;
    text += `\n---\n\n`;

    sorted.forEach(([name, data], index) => {
        text += `${index + 1}. ${name}: ${data.count} 个\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
        showPixelStatus('方块清单已复制到剪贴板', 'success');
    }).catch(() => {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showPixelStatus('方块清单已复制到剪贴板', 'success');
    });
}

// 更新尺寸标签
function updateSizeLabel() {
    const mode = document.getElementById('pixel-size-mode').value;
    const sizeRow = document.getElementById('pixel-size-row');
    const customRow = document.getElementById('pixel-custom-row');
    const sizeLabel = document.querySelector('#pixel-size-row .setting-label');

    if (mode === 'custom') {
        sizeRow.style.display = 'none';
        customRow.style.display = 'flex';
    } else {
        sizeRow.style.display = 'flex';
        customRow.style.display = 'none';

        if (mode === 'longside') {
            sizeLabel.textContent = '长边像素:';
        } else if (mode === 'width') {
            sizeLabel.textContent = '宽度像素:';
        } else if (mode === 'height') {
            sizeLabel.textContent = '高度像素:';
        }
    }
}

// 初始化像素画页面
function initPixelArtPage() {
    const uploadArea = document.getElementById('pixel-upload-area');
    const fileInput = document.getElementById('pixel-file-input');
    const generateBtn = document.getElementById('pixel-generate-btn');
    const downloadBtn = document.getElementById('pixel-download-btn');
    const copyListBtn = document.getElementById('pixel-copy-list-btn');
    const resultCanvas = document.getElementById('pixel-result-canvas');
    const sizeMode = document.getElementById('pixel-size-mode');
    const sizeSlider = document.getElementById('pixel-size-slider');
    const sizeValue = document.getElementById('pixel-size-value');
    const keepRatio = document.getElementById('pixel-keep-ratio');
    const widthInput = document.getElementById('pixel-width-input');
    const heightInput = document.getElementById('pixel-height-input');
    const discriminationSlider = document.getElementById('pixel-discrimination-slider');
    const discriminationValue = document.getElementById('pixel-discrimination-value');
    const edgeSlider = document.getElementById('pixel-edge-slider');
    const edgeValue = document.getElementById('pixel-edge-value');

    if (!uploadArea) return;

    // 点击上传区域
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    // 拖拽上传
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#0071e3';
        uploadArea.style.background = '#f0f7ff';
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#d2d2d7';
        uploadArea.style.background = '#fafafa';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#d2d2d7';
        uploadArea.style.background = '#fafafa';

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            handleImageFile(files[0]);
        }
    });

    // 文件选择
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageFile(e.target.files[0]);
        }
    });

    // 尺寸模式切换
    sizeMode.addEventListener('change', updateSizeLabel);

    // 尺寸滑块
    sizeSlider.addEventListener('input', () => {
        sizeValue.textContent = sizeSlider.value;
    });

    // 色彩区分度滑块
    discriminationSlider.addEventListener('input', () => {
        discriminationValue.textContent = discriminationSlider.value;
    });

    // 边缘保护滑块
    edgeSlider.addEventListener('input', () => {
        const v = parseInt(edgeSlider.value);
        edgeValue.textContent = v === 0 ? '关闭' : v + '%';
    });

    // 保持比例 - 自定义模式下联动宽高
    widthInput.addEventListener('input', () => {
        if (keepRatio.checked && pixelOriginalImage) {
            const w = parseInt(widthInput.value) || 1;
            heightInput.value = Math.round(w * pixelOriginalImage.height / pixelOriginalImage.width);
        }
    });

    heightInput.addEventListener('input', () => {
        if (keepRatio.checked && pixelOriginalImage) {
            const h = parseInt(heightInput.value) || 1;
            widthInput.value = Math.round(h * pixelOriginalImage.width / pixelOriginalImage.height);
        }
    });

    // 生成按钮
    generateBtn.addEventListener('click', generatePixelArt);

    // 下载按钮
    downloadBtn.addEventListener('click', downloadPixelImage);

    // 复制清单按钮
    copyListBtn.addEventListener('click', copyBlockList);

    // RGB 动态框动画帧 ID
    let rgbAnimFrameId = null;

    // 启动 RGB 框动画循环
    function startRgbAnimation() {
        if (rgbAnimFrameId) return; // 已经在运行
        function animate() {
            if (!selectedPixel && !highlightedBlock) {
                rgbAnimFrameId = null;
                return;
            }
            const canvas = document.getElementById('pixel-result-canvas');
            const ctx = canvas.getContext('2d');
            drawPixelArt(ctx, pixelBlockMap, pixelResultData.blockCounts, pixelResultData.pixelSize, highlightedBlock);
            rgbAnimFrameId = requestAnimationFrame(animate);
        }
        rgbAnimFrameId = requestAnimationFrame(animate);
    }

    // 点击像素画中的像素：选中该像素 + 高亮同色方块 + 显示坐标
    resultCanvas.addEventListener('click', (e) => {
        if (!pixelBlockMap || !pixelResultData) return;

        const coordDisplay = document.getElementById('pixel-coordinate-display');
        const coordText = document.getElementById('pixel-coord-text');
        const coordBlock = document.getElementById('pixel-coord-block');

        const rect = resultCanvas.getBoundingClientRect();
        const scaleX = resultCanvas.width / rect.width;
        const scaleY = resultCanvas.height / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX / pixelResultData.pixelSize);
        const y = Math.floor((e.clientY - rect.top) * scaleY / pixelResultData.pixelSize);

        if (y >= 0 && y < pixelBlockMap.length && x >= 0 && x < pixelBlockMap[0].length) {
            const blockName = pixelBlockMap[y][x];

            // 设置选中像素（RGB动态框）
            if (selectedPixel && selectedPixel.x === x && selectedPixel.y === y) {
                // 再次点击同一像素：取消选中
                selectedPixel = null;
                highlightedBlock = null;
                coordDisplay.style.display = 'none';
            } else {
                // 选中新像素
                selectedPixel = { x, y };
                highlightedBlock = blockName; // 同色红框

                // 显示坐标（左下为 1,1）
                if (blockName) {
                    coordDisplay.style.display = 'block';
                    const displayY = pixelBlockMap.length - y;
                    coordText.textContent = `(${x + 1}, ${displayY})`;
                    const data = pixelResultData.blockCounts[blockName];
                    if (data) {
                        const [r, g, b] = data.color;
                        coordBlock.innerHTML = `<span style="display: inline-block; width: 14px; height: 14px; background: rgb(${r},${g},${b}); border-radius: 3px; vertical-align: middle; margin-right: 4px; border: 1px solid #e5e5e5;"></span><span style="color: #1d1d1f;">${blockName}</span>`;
                    }
                }

                // 启动 RGB 动画
                startRgbAnimation();
            }

            // 更新方块列表
            renderBlockList(pixelResultData.blockCounts);
        }
    });

    // 预览模式切换 - 位图
    const modePngBtn = document.getElementById('pixel-mode-png');
    if (modePngBtn) {
        modePngBtn.addEventListener('click', () => {
            switchPixelMode('png');
        });
    }

    // 预览模式切换 - 矢量图
    const modeSvgBtn = document.getElementById('pixel-mode-svg');
    if (modeSvgBtn) {
        modeSvgBtn.addEventListener('click', () => {
            switchPixelMode('svg');
        });
    }

    // 全屏按钮
    const fullscreenBtn = document.getElementById('pixel-fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', openSvgModal);
    }

    // 弹窗关闭按钮
    const modalCloseBtn = document.getElementById('pixel-svg-modal-close');
    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeSvgModal);
    }

    // 点击弹窗遮罩层关闭
    const svgModal = document.getElementById('pixel-svg-modal');
    if (svgModal) {
        svgModal.addEventListener('click', (e) => {
            if (e.target === svgModal) {
                closeSvgModal();
            }
        });
    }

    // 弹窗缩放滑块
    const svgSizeSlider = document.getElementById('pixel-svg-size-slider');
    const svgSizeValue = document.getElementById('pixel-svg-size-value');
    if (svgSizeSlider && svgSizeValue) {
        svgSizeSlider.addEventListener('input', () => {
            const scalePercent = parseInt(svgSizeSlider.value);
            modalPixelSize = Math.round(baseModalPixelSize * scalePercent / 100);
            svgSizeValue.textContent = scalePercent + '%';
            updateModalSvg();
        });
    }

    // 下载SVG按钮(预览区)
    const downloadSvgBtn = document.getElementById('pixel-download-svg-btn');
    if (downloadSvgBtn) {
        downloadSvgBtn.addEventListener('click', downloadSvgFile);
    }

    // 下载SVG按钮(弹窗里)
    const modalDownloadBtn = document.getElementById('pixel-svg-download-btn');
    if (modalDownloadBtn) {
        modalDownloadBtn.addEventListener('click', downloadSvgFile);
    }
}

// 处理图片文件
function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            pixelOriginalImage = img;

            // 显示原图预览
            const preview = document.getElementById('pixel-original-preview');
            const previewImg = document.getElementById('pixel-original-img');
            if (preview && previewImg) {
                previewImg.src = e.target.result;
                preview.style.display = 'block';
            }

            // 启用生成按钮
            const generateBtn = document.getElementById('pixel-generate-btn');
            if (generateBtn) {
                generateBtn.disabled = false;
            }

            // 如果是自定义模式,更新高度
            const keepRatio = document.getElementById('pixel-keep-ratio');
            const widthInput = document.getElementById('pixel-width-input');
            const heightInput = document.getElementById('pixel-height-input');
    const discriminationSlider = document.getElementById('pixel-discrimination-slider');
    const discriminationValue = document.getElementById('pixel-discrimination-value');
            if (keepRatio.checked && widthInput && heightInput) {
                const w = parseInt(widthInput.value) || 64;
                heightInput.value = Math.round(w * img.height / img.width);
            }

            showPixelStatus('图片已加载,点击生成按钮开始', 'success');
        };
        img.onerror = () => {
            showPixelStatus('图片加载失败', 'error');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    initPixelArtPage();
});
