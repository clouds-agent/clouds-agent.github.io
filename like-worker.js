// 点赞 Worker - 后台运行，不受浏览器节流影响

const API_BASE = 'https://api.talesofai.cn';

let isRunning = false;
let isPaused = false;
let currentToken = '';
let tags = [];
let tagPageMap = {};
let tagFinished = {};
let likeStats = { total: 0, byTag: {} };

// 发送消息到主页面
function postMessage(data) {
    self.postMessage(data);
}

// 监听主页面的消息
self.addEventListener('message', async (e) => {
    const { action, payload } = e.data;
    
    switch (action) {
        case 'start':
            currentToken = payload.token;
            tags = payload.tags;
            tagPageMap = payload.tagPageMap || {};
            tagFinished = payload.tagFinished || {};
            likeStats = payload.likeStats || { total: 0, byTag: {} };
            isRunning = true;
            isPaused = false;
            postMessage({ type: 'started' });
            runLikeLoop();
            break;
            
        case 'pause':
            isPaused = true;
            postMessage({ type: 'paused' });
            break;
            
        case 'resume':
            isPaused = false;
            postMessage({ type: 'resumed' });
            break;
            
        case 'stop':
            isRunning = false;
            isPaused = false;
            postMessage({ type: 'stopped' });
            break;
            
        case 'updatePage':
            tagPageMap[payload.tag] = payload.page;
            postMessage({ 
                type: 'pageUpdated', 
                tag: payload.tag, 
                page: payload.page 
            });
            break;
    }
});

// 点赞主循环
async function runLikeLoop() {
    while (isRunning) {
        if (isPaused) {
            await sleep(500);
            continue;
        }
        
        for (const tag of tags) {
            if (!isRunning) break;
            if (isPaused) break;
            if (tagFinished[tag.name]) continue;
            
            try {
                const currentPage = tagPageMap[tag.name] || 0;
                const stories = await getStories(tag.name, currentPage);
                
                // 添加延迟避免限流
                await sleep(200);
                
                if (stories.length === 0) {
                    tagFinished[tag.name] = true;
                    postMessage({
                        type: 'log',
                        message: `#${tag.name} 已遍历完所有作品（第 ${currentPage} 页）`,
                        level: 'error'
                    });
                    
                    const allFinished = tags.every(t => tagFinished[t.name]);
                    if (allFinished) {
                        isRunning = false;
                        postMessage({ type: 'log', message: '所有标签已完成', level: 'success' });
                        postMessage({ type: 'finished', stats: likeStats });
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
                        likeStats.byTag[tag.name] = (likeStats.byTag[tag.name] || 0) + 1;
                        successCount++;
                        
                        // 每点赞 5 个上报一次进度
                        if (successCount % 5 === 0) {
                            postMessage({
                                type: 'progress',
                                stats: { ...likeStats },
                                currentPage: tagPageMap[tag.name]
                            });
                        }
                    } else {
                        postMessage({
                            type: 'log',
                            message: `点赞失败：${story.name || '未知'} - ${result.error}`,
                            level: 'error'
                        });
                    }
                }
                
                // 翻页
                tagPageMap[tag.name] = currentPage + 1;
                
                // 上报进度
                postMessage({
                    type: 'progress',
                    stats: { ...likeStats },
                    currentPage: tagPageMap[tag.name]
                });
                
            } catch (error) {
                postMessage({
                    type: 'log',
                    message: `错误：${error.message}`,
                    level: 'error'
                });
            }
        }
    }
}

// 获取作品列表
async function getStories(tagName, page, pageSize = 10) {
    const url = `${API_BASE}/v1/hashtag/${encodeURIComponent(tagName)}/stories?page_index=${page}&page_size=${pageSize}`;
    
    const res = await fetch(url, {
        headers: {
            'x-token': currentToken,
            'x-platform': 'nieta-app/web'
        }
    });
    
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    return data.list || [];
}

// 点赞单个作品
async function likeStory(storyId) {
    try {
        const res = await fetch(`${API_BASE}/v1/story/story-like`, {
            method: 'PUT',
            headers: {
                'x-token': currentToken,
                'x-platform': 'nieta-app/web',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                storyId: storyId,
                is_cancel: false
            })
        });
        
        if (res.ok) {
            return { success: true };
        } else {
            const error = await res.json().catch(() => ({}));
            return { success: false, error: error.message || '未知错误' };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
