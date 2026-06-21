# Neta Tools 网站代码架构文档

## 一、项目概述

**项目名称**：Neta Tools（捏Ta工具站）
**部署地址**：https://clouds-agent.github.io/
**技术栈**：纯前端 HTML + CSS + JavaScript（无框架）
**核心功能**：批量点赞、数据统计、UUID查询、Danbooru标签探索、翻译

---

## 二、文件结构

```
clouds-agent.github.io/
├── index.html              # 主页面（所有页面都在这一个HTML里，通过CSS切换显示）
├── style.css               # 主样式文件（397个选择器）
├── app.js                  # 核心JS逻辑（3999行，所有功能都在这里）
├── like-worker.js          # Web Worker，后台点赞用
├── favicon.ico             # 网站图标
├── favicon.png             # 图标原图
├── README.md               # 项目说明
├── css/
│   └── kards.css           # Kards卡牌工具样式
├── script/
│   └── stackblur.min.js    # 模糊效果库
├── images/                 # Kards卡牌相关图片资源
│   ├── body/
│   ├── faction/
│   ├── rarity/
│   ├── set/
│   ├── type/
│   └── kards-icon.png
└── .github/workflows/      # GitHub Actions
    ├── auto-like.yml       # 自动点赞工作流
    └── daily-checkin.yml   # 每日签到工作流
```

---

## 三、页面结构（index.html）

### 整体布局
```
┌─────────────────────────────────────┐
│  Header（顶部栏）                    │
│  from CLOUDS        [头像 用户名]   │
├─────────────────────────────────────┤
│  Navbar（导航栏）                    │
│  [点赞] [工具] [D站tag] [翻译] [K] │
├─────────────────────────────────────┤
│  Main（主内容区）                    │
│                                     │
│  5个section，同一时间只显示一个      │
│  （通过 .section.active 控制）      │
│                                     │
└─────────────────────────────────────┘
```

### 5个页面Section

#### 1. 点赞页 (#like)
- **标签搜索区**：输入框 + 添加按钮 + 联想建议下拉
- **已选标签列表**：标签名 + 热度 + 页码输入框 + 删除叉号
- **用户搜索区**：输入框 + 联想建议下拉
- **已选用户列表**：头像 + 昵称 + 粉丝数 + 删除按钮
- **点赞速度设置**：滑块（50ms-2000ms）
- **无增长停止设置**：时长选择 + 应用范围
- **操作按钮**：开始/终止 + 暂停/继续
- **进度显示**：进度条 + 统计数据
- **图表**：Chart.js 折线图，实时显示点赞趋势
- **日志区**：实时点赞日志
- **热门标签**：快速添加标签
- **热度排行TOP20**：加载按钮 + 排行榜列表

#### 2. 工具页 (#tools)
- **数据统计卡片**：
  - Tab切换：粉丝 / 点赞 / 捏同款
  - 时间范围选择
  - 加载按钮
  - 统计摘要
  - Chart.js 图表
- **UUID查询卡片**：
  - 搜索框（自动联想）
  - 结果展示区
- **我的图库卡片**：
  - 类型选择（图片/视频）
  - 加载按钮
  - 图片网格
  - 加载更多按钮

#### 3. D站tag页 (#danbooru)
- 搜索框 + 搜索按钮
- 空状态快速标签（常用标签一键搜索）
- 状态显示 + 计数
- 图片网格（20张/页）
- 分页导航（上一页/页码/下一页 + 跳转 + 清空）

#### 4. 翻译页 (#translate)
- 双语言选择器（源语言/目标语言）+ 交换按钮
- 输入文本框
- 操作按钮：翻译 / 复制结果 / 易译转化 / 切换API
- 输出文本框（只读）
- 状态显示

#### 5. Kards页 (#kards) - 隐藏
- 隐藏工具链接列表
- 入口：导航栏最右边的空白按钮，双击显示

### 弹窗系统（Modals）
1. **登录弹窗** (#login-modal) - 默认显示
   - Token输入框
   - 快捷登录（历史账号列表）
   - 登录按钮
   - 状态提示

2. **图片详情弹窗** (#image-detail-modal)
   - 模型、种子信息
   - 词条显示 + 复制按钮

3. **Danbooru详情弹窗** (#danbooru-detail-modal)
   - 大图预览
   - 图片信息（ID、分辨率、评分、收藏）
   - 分类标签列表（点击可选中）
   - 已选词条文本框
   - 操作按钮：复制已选 / 清空 / 转翻译
   - 完整标签信息 + 复制全标签 / 打开原链接

4. **个人主页弹窗** (#profile-modal)
   - 大头像 + 用户名
   - 统计数据：关注/粉丝/电量/获赞/捏同款
   - 签到按钮 + 状态
   - 定时签到开关
   - 复制Token / 退出登录

5. **用户确认弹窗** (#user-confirm-modal)
   - 用户卡片（头像 + 昵称 + 粉丝 + 作品数）
   - 添加到任务队列按钮

---

## 四、样式体系（style.css）

### 设计风格
- 苹果风格：圆角、毛玻璃、浅色背景
- 主色调：蓝色系（#0071e3）
- 卡片式布局
- 响应式设计

### 核心组件样式
1. **基础重置**：html, body, *
2. **顶部栏**：.header, .signature, .profile-btn
3. **导航栏**：.navbar, .nav-link, #kards-btn
4. **容器与卡片**：.container, .section, .card
5. **表单元素**：input, select, textarea
6. **按钮**：.btn, .btn-primary, .btn-secondary, .btn-outline, .btn-full
7. **设置项**：.setting-row, .setting-label, .setting-select, .setting-range
8. **搜索框**：.search-box, .suggestions, .suggestion-item
9. **标签列表**：.tag-list, .tag-item, .tag-item button
10. **用户列表**：.user-list, .user-item
11. **进度与状态**：.progress, .status, .status.success, .status.error
12. **图表**：.chart, .chart-wrapper
13. **日志**：.log
14. **热门标签**：.hot-tags, .hot-tag-item
15. **排行榜**：.ranking-list
16. **弹窗**：.modal, .modal-content, .modal-header, .modal-close
17. **数据统计**：.stats-tabs, .stats-tab, .stats-summary
18. **图库**：.gallery-grid, .gallery-item
19. **Danbooru**：.danbooru-grid, .danbooru-item, .danbooru-pagination
20. **分页**：.pagination-btn, .pagination-numbers, .pagination-jump
21. **快速标签**：.quick-tags-group, .quick-tag
22. **翻译**：.translate-container, .translate-row, .translate-box
23. **响应式**：@media 媒体查询

---

## 五、核心逻辑（app.js）

### 5.1 全局状态变量

```javascript
// API基础地址
const API_BASE = 'https://api.talesofai.cn';

// 点赞状态
let isRunning = false;      // 是否正在运行
let isPaused = false;       // 是否暂停
let likeSpeed = 200;        // 点赞速度（ms）

// 页面状态
let currentActivePage = 'like';  // 当前活动页面

// 点赞统计
let likeStats = { total: 0, byTag: {}, startTime: null, lastIncrease: null };
let chartData = { labels: [], total: [], byTag: {} };

// 标签状态
let tagPageMap = {};       // 每个标签的当前页码
let tagFinished = {};      // 每个标签是否已完成

// 用户状态
let selectedUsers = [];    // 已选中的用户列表
let userPageMap = {};      // 每个用户的当前页码
let userFinished = {};     // 每个用户是否已完成

// 超时设置
let timeoutDuration = 1;   // 无增长停止时间（分钟）
let timeoutScope = 'all';  // 应用范围：all/except-users/except-tags

// 用户信息
let userProfile = null;

// 图库状态
let galleryPageIndex = 0;
let galleryTotal = 0;
let galleryLoading = false;

// 数据统计
let currentStatsType = 'fans';  // fans/like/inherit
let statsChart = null;          // Chart.js实例

// Danbooru状态
let danbooruCurrentPage = 1;
let danbooruCurrentTags = [];
let danbooruAllPosts = [];
const DANBOORU_POSTS_PER_PAGE = 20;
const DANBOORU_MAX_POSTS = 200;
let selectedTagsSet = new Set();

// 翻译状态
let translateApiChoice = 'auto';  // auto/google/mymemory
```

### 5.2 登录与Token管理

**核心函数**：
- `getToken()` - 从localStorage读取token
- `saveToken(token)` - 保存token到localStorage
- `clearToken()` - 清除token并重置所有状态
- `saveAccountToHistory(token)` - 保存账号到历史列表
- `getAccountHistory()` - 获取历史账号列表
- `removeAccountFromHistory(token)` - 删除历史账号
- `handleLogin()` - 处理登录（调用/v1/user/验证token）
- `setupLogin()` - 初始化登录相关UI
- `setupLoginInterceptor()` - 拦截未登录的操作

**API调用方式**：
```javascript
fetch(`${API_BASE}/v1/user/`, {
    method: 'GET',
    headers: { 
        'x-token': token, 
        'x-platform': 'nieta-app/web',
        'Content-Type': 'application/json'
    },
    mode: 'cors',
    credentials: 'omit'
})
```

### 5.3 导航与页面切换

**核心函数**：
- `switchPage(pageName)` - 切换页面（添加/移除.active类）
- `setupNavigation()` - 绑定导航按钮事件
- `updateNavbarLoading(page, isLoading)` - 导航栏加载状态

**实现方式**：
- 所有页面都在同一个HTML里
- 通过 `.section.active` CSS类控制显示/隐藏
- 切换时只改类名，不刷新页面

### 5.4 标签搜索与管理

**核心函数**：
- `searchTags(keyword)` - 搜索标签（活动标签+空间标签+普通标签）
- `setupTagSearch()` - 初始化标签搜索（防抖300ms）
- `addTag(tag)` - 添加标签到已选列表
- `addTagManual(tagName)` - 手动添加标签
- `removeTag(name)` - 删除标签
- `renderTags()` - 渲染已选标签列表
- `getSavedTags()` - 从localStorage读取保存的标签
- `saveTags(tags)` - 保存标签到localStorage

**标签数据结构**：
```javascript
{
    name: '标签名',
    type: 'activity' | 'space' | 'tag',  // 类型
    popularity: 12345,                    // 热度
    ...
}
```

### 5.5 用户搜索与管理

**核心函数**：
- `initUserSearch()` - 初始化用户搜索
- `showUserSuggestions(users)` - 显示用户搜索建议
- `initUserConfirm()` - 初始化用户确认弹窗
- `closeUserConfirmModal()` - 关闭确认弹窗
- `addUserToQueue(user)` - 添加用户到队列
- `removeUserFromQueue(uuid)` - 从队列删除用户
- `renderUserQueue()` - 渲染用户队列

### 5.6 点赞系统（核心）

**架构**：主线程 + Web Worker
- 主线程：UI更新、用户交互
- Web Worker：后台点赞循环，不受浏览器节流影响

**主线程函数**：
- `initWorker()` - 初始化Web Worker
- `handleWorkerMessage(e)` - 处理Worker消息
- `setupLikeButtons()` - 绑定点赞按钮事件
- `startLiking()` - 开始点赞（发送start消息给Worker）
- `stopLiking()` - 停止点赞
- `resetUI()` - 重置UI状态
- `updateProgress()` - 更新进度显示
- `renderChart()` - 渲染点赞趋势图
- `log(message, type)` - 输出日志
- `setupRanking()` - 加载热度排行

**Web Worker（like-worker.js）**：
- `runLikeLoop()` - 点赞主循环
- `getStories(tagName, page)` - 获取标签下的作品列表
- `likeStory(storyId)` - 点赞单个作品
- `sleep(ms)` - 延迟函数

**点赞流程**：
```
1. 用户点击"开始"
   ↓
2. 主线程发送 start 消息给 Worker
   ↓
3. Worker 进入主循环
   ├─ 遍历每个标签
   │  ├─ 获取该标签第N页的作品列表（10个）
   │  ├─ 逐个点赞
   │  ├─ 每5个上报一次进度
   │  └─ 翻到下一页
   └─ 所有标签完成后结束
   ↓
4. Worker 发送 progress/log/finished 消息给主线程
   ↓
5. 主线程更新UI（进度、图表、日志）
```

### 5.7 数据统计

**核心函数**：
- `setupStats()` - 初始化统计功能
- `groupByDate(list, dateField)` - 按日期分组数据
- `filterByRange(list, days, dateField)` - 按时间范围过滤
- `renderStatsChart(stats, type)` - 渲染统计图表
- `renderStatsSummary(stats, type)` - 渲染统计摘要
- `updateRangeOptions(type)` - 更新时间范围选项（不同类型选项不同）

**数据来源**：
- 粉丝：/v2/user/fans 接口
- 点赞：/v1/user/like 接口
- 捏同款：/v1/user/inherit 接口

### 5.8 UUID查询

**核心函数**：
- `setupUUIDSearch()` - 初始化UUID搜索（防抖300ms）
- 搜索角色和元素：/v2/travel/parent-search 接口

### 5.9 我的图库

**核心函数**：
- `setupGallery()` - 初始化图库
- 分页加载：/v1/artifact/list 接口
- 支持图片和视频两种类型

### 5.10 签到系统

**核心函数**：
- `setupCheckin()` - 初始化签到功能
- 签到接口：POST /v1/checkin/manual
- 支持定时签到（GitHub Actions实现）

### 5.11 Danbooru探索

**核心函数**：
- `setupDanbooruExplorer()` - 初始化Danbooru功能
- `searchDanbooru()` - 搜索图片
- `loadDanbooruPage(page)` - 加载指定页
- `renderPostGrid(posts)` - 渲染图片网格
- `danbooruPrevPage()` / `danbooruNextPage()` - 翻页
- `danbooruJumpToPage()` - 跳转到指定页
- `clearDanbooruResults()` - 清空结果
- `updateDanbooruPagination()` - 更新分页UI
- `updateDanbooruEmptyState()` - 更新空状态显示

**详情弹窗**：
- `openDanbooruDetail(post)` - 打开详情
- `closeDanbooruDetailModal()` - 关闭详情
- `toggleTag(tag)` - 切换标签选中状态
- `updateSelectedTagsTextarea()` - 更新已选标签文本框
- `copySelectedTags()` - 复制已选标签
- `copyAllTags()` - 复制全部标签
- `translateSelectedTags()` - 跳转到翻译页

**API**：Safebooru API
```
https://safebooru.donmai.us/posts.json?tags=xxx&page=xxx
```

### 5.12 翻译功能

**核心函数**：
- `setupTranslate()` - 初始化翻译功能
- `translateText(text, from, to)` - 翻译文本
- `copyTranslateResult()` - 复制翻译结果
- `formatForTranslation(text)` - 易译转化（大写转小写，下划线转空格）

**支持的API**：
- Google Translate API（默认）
- MyMemory Translation API（备用）
- 可切换，自动降级

### 5.13 个人主页

**核心函数**：
- `openProfile()` - 打开个人主页弹窗
- `closeProfile()` - 关闭弹窗
- `updateProfileUI()` - 更新用户信息UI
- `showStatDelta(elementId, newValue, oldValue)` - 显示数值变化动画

### 5.14 初始化

**核心函数**：
- `init()` - 页面初始化入口
  - setupNavigation()
  - setupLogin()
  - setupTagSearch()
  - initUserSearch()
  - setupLikeButtons()
  - initWorker()
  - setupRanking()
  - setupUUIDSearch()
  - setupStats()
  - setupGallery()
  - setupCheckin()
  - setupDanbooruExplorer()
  - setupTranslate()
  - setupClickOutside()

**触发时机**：DOMContentLoaded 事件

---

## 六、API调用规范

### 基础地址
```
https://api.talesofai.cn
```

### 请求头
```javascript
headers: {
    'x-token': '<用户Token>',
    'x-platform': 'nieta-app/web',
    'Content-Type': 'application/json'
}
```

### 请求模式
```javascript
fetch(url, {
    mode: 'cors',
    credentials: 'omit'
})
```

### 主要API端点

#### 用户相关
- `GET /v1/user/` - 获取用户信息（登录验证）
- `GET /v1/user/search?keywords=xxx` - 搜索用户
- `GET /v2/user/ap_info` - 获取AP积分详情

#### 标签与作品
- `GET /v1/activities` - 获取活动标签列表
- `GET /v1/hashtag/{tag}/stories?page_index=0&page_size=10` - 获取标签下的作品
- `GET /v2/travel/parent-search?keywords=xxx&parent_type=oc|elementum` - 搜索角色/元素

#### 点赞
- `PUT /v1/story/story-like` - 点赞/取消点赞

#### 签到
- `POST /v1/checkin/manual` - 手动签到

#### 数据统计
- `GET /v2/user/fans` - 粉丝列表
- `GET /v1/user/like` - 点赞列表
- `GET /v1/user/inherit` - 捏同款列表

#### 图库
- `GET /v1/artifact/list?page_index=0&page_size=20&modality=PICTURE` - 我的图库

#### 空间
- `GET /v1/configs/config?namespace=space&key=topic_tags_config` - 空间标签配置

---

## 七、本地存储（localStorage）

| Key | 说明 | 格式 |
|-----|------|------|
| `neta_token` | 当前登录的Token | string |
| `neta_accounts` | 历史账号列表 | JSON数组 |
| `saved_tags` | 保存的标签列表 | JSON数组 |
| `like_speed` | 点赞速度设置 | number |

---

## 八、关键设计模式

### 1. 单页应用（SPA）
- 所有页面在同一个HTML里
- 通过CSS类名切换显示
- 无刷新、无URL跳转

### 2. Web Worker 后台任务
- 点赞逻辑放在Worker里
- 不受浏览器标签页节流影响
- 主线程只负责UI

### 3. 防抖（Debounce）
- 搜索输入框防抖300ms
- 避免频繁API请求

### 4. 渐进式加载
- 分页加载数据
- 图片懒加载
- 按需渲染

### 5. 模块化组织
- 按功能模块组织函数
- 每个模块有setup函数初始化
- init函数统一调用所有setup

---

## 九、修改代码注意事项

### 1. 添加新页面
1. 在index.html里添加新的 `<section id="xxx" class="section">`
2. 在导航栏添加对应的 `<button class="nav-link" data-page="xxx">`
3. 在style.css里添加页面样式（如果需要）
4. 在app.js里添加 `setupXxx()` 初始化函数
5. 在 `init()` 函数里调用 setupXxx()

### 2. 添加新API调用
1. 统一使用 `API_BASE` 常量
2. 统一请求头格式（x-token + x-platform）
3. 统一错误处理
4. 注意CORS问题

### 3. 修改样式
1. 遵循现有的命名规范（BEM风格：block-element-modifier）
2. 注意响应式适配
3. 修改前确认不会影响其他页面

### 4. 修改点赞逻辑
1. 点赞主循环在 like-worker.js 里，不在 app.js
2. Worker和主线程通过 postMessage 通信
3. 不要在Worker里操作DOM

### 5. 版本号
- app.js 引用时带版本号：`app.js?v=20260520v165`
- 重大修改后记得更新版本号，避免缓存

---

## 十、已知的坑

1. **CORS限制**：捏Ta API有CORS限制，纯前端调用可能被拦截
2. **Token格式**：不是标准JWT，是自定义格式，用x-token header
3. **Worker限制**：Worker里不能访问DOM，不能用localStorage
4. **移动端适配**：部分触摸区域可能太小，需要优化
5. **Danbooru API**：Safebooru是安全镜像，没有R18内容
6. **翻译API**：Google Translate可能不稳定，有MyMemory备用

---

*文档生成时间：2026年6月20日*
*基于 commit: 2e5773f*
