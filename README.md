# 🍵 云茗的茶馆 - 部署指南

欢迎来到云茗的茶馆！这是一个 Neta 创作工具箱网站。

## 📦 部署步骤

### 1. 上传文件到 GitHub

#### 方法 A：通过 GitHub 网页上传（推荐新手）

1. 打开你的仓库：https://github.com/clouds-agent/clouds-agent.github.io
2. 点击 **Add file** → **Upload files**
3. 把以下文件拖进去：
   - `index.html`
   - `style.css`
   - `app.js`
4. 点击 **Commit changes**

#### 方法 B：使用 Git 命令

```bash
git clone https://github.com/clouds-agent/clouds-agent.github.io.git
cd clouds-agent.github.io
# 把网站文件复制到这里
git add .
git commit -m "初始提交"
git push
```

---

### 2. 启用 GitHub Pages

1. 打开仓库的 **Settings**（设置）
2. 左侧菜单找到 **Pages**
3. **Source** 选择：
   - Branch: `main`
   - Folder: `/ (root)`
4. 点击 **Save**

等待 1-2 分钟，访问 https://clouds-agent.github.io 就能看到网站了！

---

### 3. 配置 Secrets（用于定时任务）

1. 打开仓库的 **Settings**
2. 左侧菜单找到 **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加以下 Secrets：

| Name | Value |
|------|-------|
| `NETA_TOKEN` | 你的 Neta Token |
| `LIKE_HASHTAGS` | `捏捏，捏捏新手村，OC，千面计划` |
| `LIKE_COUNT` | `100` |

---

### 4. 启用 GitHub Actions

1. 打开仓库的 **Actions** 标签
2. 找到 **自动点赞任务**
3. 点击 **Enable workflow**
4. 可以点击 **Run workflow** 手动测试

---

## 🔧 文件说明

```
clouds-agent.github.io/
├── index.html          # 网站主页
├── style.css           # 样式文件
├── app.js              # 前端逻辑
├── README.md           # 说明文档
└── .github/
    └── workflows/
        └── auto-like.yml  # GitHub Actions 定时任务
```

---

## 🎯 网站功能

- ✅ Token 管理（本地存储，安全）
- ✅ 批量点赞（支持多标签）
- ✅ 角色 UUID 查询
- ✅ 标签提示词生成器
- ✅ 活动热度排行
- ✅ 定时自动点赞（GitHub Actions）

---

## 📝 更新网站

修改文件后：

### 网页方式：
1. 在 GitHub 上找到文件
2. 点击铅笔图标编辑
3. 点击 **Commit changes**

### Git 方式：
```bash
git add .
git commit -m "更新说明"
git push
```

GitHub Pages 会自动更新，等待 1-2 分钟即可看到变化！

---

## 🍵 使用说明

### 首次使用

1. 打开网站 https://clouds-agent.github.io
2. 点击 **Token** 标签
3. 输入你的 Neta Token
4. 点击 **保存 Token**

### 点赞功能

1. 点击 **点赞** 标签
2. 输入标签名称（如：捏捏）
3. 设置点赞数量
4. 点击 **开始点赞**

### 定时任务

- 每天 12:00 UTC (20:00 中国时区) 自动执行
- 可以在 Actions 标签查看执行记录
- 可以手动触发

---

## ❓ 常见问题

### Q: 网站打不开？
A: 等待 1-2 分钟，GitHub Pages 需要时间构建。检查 Pages 设置是否正确。

### Q: Token 安全吗？
A: Token 只保存在你的浏览器本地（localStorage），不会上传到任何服务器。

### Q: 定时任务不执行？
A: 检查 Actions 是否启用，Secrets 是否正确配置。

### Q: 点赞失败？
A: 检查 Token 是否过期，重新获取并保存。

---

## 🎨 自定义

想修改网站外观？编辑 `style.css`：

- 修改主色调：搜索 `#667eea` 替换成你喜欢的颜色
- 修改字体：修改 `font-family`
- 添加新功能：编辑 `app.js`

---

## 📄 License

MIT License - 由 OpenClaw 驱动

🍵 有任何问题请勿找雨落
