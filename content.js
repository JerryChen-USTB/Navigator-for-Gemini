/**
 * Navigator for Gemini - Gemini 对话目录导航插件
 * 为 Gemini 对话提供目录面板，支持快速跳转到任意问答位置
 */

(function () {
    'use strict';

    // ============================================================
    // 配置常量
    // ============================================================
    const CONFIG = {
        // DOM 选择器（适配 Gemini 的 Angular 自定义元素）
        SELECTORS: {
            // 对话轮次容器（每个 conversation-container 包含一组 user-query + model-response）
            TURN: 'div.conversation-container',
            // 用户消息元素
            USER_QUERY: 'user-query',
            // 用户消息文本内容
            USER_CONTENT: '.query-text-line',
            // 用户消息文本内容（备选）
            USER_CONTENT_ALT: '.query-content',
            // 助手回复内容
            ASSISTANT_CONTENT: 'message-content',
            // 滚动容器
            SCROLL_CONTAINER: 'infinite-scroller[data-test-id="chat-history-container"]',
            // 滚动容器（备选）
            SCROLL_CONTAINER_ALT: '#chat-history',
            // 根容器（面板插入位置，使面板占满整个垂直高度）
            APP_ROOT: 'chat-app#app-root',
            // 主内容区域
            MAIN_CONTENT: 'main.chat-app',
            // 头部右侧区域（展开按钮插入位置）
            HEADER_RIGHT_SECTION: '.top-bar-actions .right-section',
            // 头部按钮容器（备选）
            HEADER_BUTTONS: '.top-bar-actions .buttons-container',
        },
        // 摘要最大字符数
        SUMMARY_MAX_LENGTH: 30,
        // Tooltip 最大字符数
        TOOLTIP_MAX_LENGTH: 150,
        // 重命名最大字符数
        RENAME_MAX_LENGTH: 50,
        // 面板宽度
        PANEL_WIDTH: 280,
        // 防抖延迟
        DEBOUNCE_DELAY: 200,
        // 节流延迟
        THROTTLE_DELAY: 100,
        // Tooltip 悬停延迟
        TOOLTIP_DELAY: 500,
        // 存储键前缀（与 ChatGPT 版不同，避免冲突）
        STORAGE_KEY: 'gemininav_renames',
        // AI 摘要输入文本最大字符数
        AI_SUMMARY_MAX_LENGTH: 1000,
        // AI 摘要截断时首尾保留字符数
        AI_SUMMARY_HALF_LENGTH: 500,
    };

    // ============================================================
    // 工具函数
    // ============================================================

    /**
     * 防抖函数
     */
    function debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    /**
     * 节流函数
     */
    function throttle(fn, delay) {
        let lastTime = 0;
        return function (...args) {
            const now = Date.now();
            if (now - lastTime >= delay) {
                lastTime = now;
                fn.apply(this, args);
            }
        };
    }

    /**
     * 生成唯一 ID
     */
    function generateId() {
        return 'gn-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 提取文本摘要
     */
    function extractSummary(element, maxLength = CONFIG.SUMMARY_MAX_LENGTH) {
        if (!element) return '(无内容)';
        const text = element.textContent?.trim() || '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    /**
     * 提取完整文本（用于 tooltip）
     */
    function extractFullText(element, maxLength = CONFIG.TOOLTIP_MAX_LENGTH) {
        if (!element) return '';
        const text = element.textContent?.trim() || '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    // ============================================================
    // 文本预处理器
    // ============================================================

    /**
     * 文本预处理器 - 将对话内容格式化为 AI 摘要所需的输入
     */
    const TextPreprocessor = {
        /**
         * 默认文本缩减策略：直接截断
         */
        truncateText(text, maxLength = CONFIG.AI_SUMMARY_MAX_LENGTH, halfLength = CONFIG.AI_SUMMARY_HALF_LENGTH) {
            if (!text || text.length <= maxLength) return text || '';
            return text.substring(0, halfLength) + '……' + text.substring(text.length - halfLength);
        },

        /**
         * 从对话轮次 DOM 元素中提取对话对（用户提问 + AI 回答）
         * 注意：Gemini 中用户和助手在同一个 conversation-container 内
         */
        extractConversationPair(turnElement) {
            // 在同一容器内查找用户内容
            const userContent = turnElement.querySelector(CONFIG.SELECTORS.USER_CONTENT)
                || turnElement.querySelector(CONFIG.SELECTORS.USER_CONTENT_ALT);
            const userText = userContent?.textContent?.trim() || '';

            // 在同一容器内查找助手回复内容
            const assistantContent = turnElement.querySelector(CONFIG.SELECTORS.ASSISTANT_CONTENT);
            const assistantText = assistantContent?.textContent?.trim() || '';

            return { userText, assistantText };
        },

        /**
         * 格式化对话文本，用于发送给 AI 摘要
         */
        formatForSummarization({ userText, assistantText, userTextReducer, assistantTextReducer }) {
            const uReducer = userTextReducer || this.truncateText.bind(this);
            const aReducer = assistantTextReducer || this.truncateText.bind(this);

            const processedUser = uReducer(userText);
            const processedAssistant = aReducer(assistantText);

            return `User's Prompt:\n${processedUser}\nGemini's Answer:\n${processedAssistant}`;
        },
    };

    // ============================================================
    // AI 摘要服务
    // ============================================================

    /**
     * AI 摘要服务 - 通过 background service worker 调用后端代理
     */
    const AISummarizerService = {
        /**
         * 检查服务是否可用
         */
        async isAvailable() {
            return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
        },

        /**
         * 对文本进行摘要（通过后端代理调用 Qwen API）
         */
        async summarize(text) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'AI_SUMMARIZE', text }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (response?.error) {
                        reject(new Error(response.error));
                        return;
                    }
                    resolve(response?.summary || '');
                });
            });
        },
    };

    // ============================================================
    // 目录数据管理
    // ============================================================
    class TocManager {
        constructor() {
            this.items = [];
            this.activeItemId = null;
        }

        /**
         * 扫描页面消息并生成目录
         * Gemini 中每个 div.conversation-container 包含 user-query + model-response
         */
        scan() {
            const turns = document.querySelectorAll(CONFIG.SELECTORS.TURN);
            const newItems = [];
            let qaIndex = 0;

            for (let i = 0; i < turns.length; i++) {
                const turn = turns[i];

                // 检查是否包含用户消息
                const userQuery = turn.querySelector(CONFIG.SELECTORS.USER_QUERY);
                if (!userQuery) continue;

                qaIndex++;
                // 使用 conversation-container 的 id 属性作为唯一标识
                const turnId = turn.id || generateId();

                // 提取用户问题摘要和完整内容
                const contentElement = turn.querySelector(CONFIG.SELECTORS.USER_CONTENT)
                    || turn.querySelector(CONFIG.SELECTORS.USER_CONTENT_ALT);
                const summary = extractSummary(contentElement);
                const fullText = extractFullText(contentElement);

                newItems.push({
                    id: turnId,
                    index: qaIndex,
                    type: 'qa',
                    summary,
                    fullText,
                    element: turn,
                });
            }

            this.items = newItems;
            return this.items;
        }

        /**
         * 获取所有目录项
         */
        getItems() {
            return this.items;
        }

        /**
         * 设置当前活跃的目录项
         */
        setActiveItem(id) {
            this.activeItemId = id;
        }

        /**
         * 获取当前活跃的目录项 ID
         */
        getActiveItemId() {
            return this.activeItemId;
        }
    }

    // ============================================================
    // 目录面板 UI
    // ============================================================
    class TocPanel {
        constructor(tocManager) {
            this.tocManager = tocManager;
            this.panel = null;
            this.listContainer = null;
            this.searchInput = null;
            this.isCollapsed = false;
            this.searchTerm = '';
            this.isScrolling = false;
            this.scrollTargetId = null;
            this.scrollEndTimer = null;
            this.boundScrollEndHandler = null;
            this.jumpTargetId = null;
            this.tooltip = null;
            this.tooltipTimer = null;
            this.customNames = {};
            this.editingItemId = null;
            this.summarizingItemId = null;
            this.conversationId = this.getConversationId();
        }

        /**
         * 获取当前对话 ID
         * Gemini URL 格式: /app/{hex-id}
         */
        getConversationId() {
            const match = window.location.pathname.match(/\/app\/([a-f0-9]+)/);
            return match ? match[1] : 'default';
        }

        /**
         * 加载自定义名称
         */
        async loadCustomNames() {
            try {
                const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
                const allRenames = result[CONFIG.STORAGE_KEY] || {};
                this.customNames = allRenames[this.conversationId] || {};
                this.render();
            } catch (e) {
                console.warn('Navigator for Gemini: 加载自定义名称失败', e);
                this.customNames = {};
            }
        }

        /**
         * 保存自定义名称
         */
        async saveCustomName(itemId, newName) {
            try {
                const result = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
                const allRenames = result[CONFIG.STORAGE_KEY] || {};

                if (!allRenames[this.conversationId]) {
                    allRenames[this.conversationId] = {};
                }

                if (newName && newName.trim()) {
                    allRenames[this.conversationId][itemId] = newName.trim();
                    this.customNames[itemId] = newName.trim();
                } else {
                    delete allRenames[this.conversationId][itemId];
                    delete this.customNames[itemId];
                }

                await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: allRenames });
            } catch (e) {
                console.warn('Navigator for Gemini: 保存自定义名称失败', e);
            }
        }

        /**
         * 获取显示名称（自定义名称优先）
         */
        getDisplayName(item) {
            return this.customNames[item.id] || item.summary;
        }

        /**
         * 创建面板 DOM
         */
        create() {
            // 检查是否已存在
            if (document.getElementById('gemininav-panel')) {
                this.panel = document.getElementById('gemininav-panel');
                this.listContainer = this.panel.querySelector('.gn-list');
                this.searchInput = this.panel.querySelector('.gn-search-input');
                return;
            }

            // 创建面板容器
            this.panel = document.createElement('div');
            this.panel.id = 'gemininav-panel';

            // 注入图标路径 CSS 变量
            try {
                this.panel.style.setProperty('--gn-icon-rename', `url('${chrome.runtime.getURL('icons/rename.svg')}')`);
                this.panel.style.setProperty('--gn-icon-ai', `url('${chrome.runtime.getURL('icons/ai_sumarize.svg')}')`);
                this.panel.style.setProperty('--gn-icon-hide', `url('${chrome.runtime.getURL('icons/hide.svg')}')`);
            } catch (e) {
                console.warn('Navigator for Gemini: 设置图标路径失败', e);
            }
            this.panel.innerHTML = `
        <div class="gn-header">
          <div class="gn-title">
            <svg class="gn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16M4 12h16M4 18h10"/>
            </svg>
            <span>对话目录</span>
          </div>
          <div class="gn-header-actions">
            <button class="gn-btn gn-btn-collapse" title="折叠面板"></button>
          </div>
        </div>
        <div class="gn-search">
          <div class="gn-search-wrap">
            <input type="text" class="gn-search-input" placeholder="搜索消息...">
            <button class="gn-search-clear" title="清空搜索">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="gn-list"></div>
      `;

            // 创建展开按钮（Material Design 圆形图标按钮风格）
            this.collapseBtn = document.createElement('button');
            this.collapseBtn.id = 'gemininav-expand-btn';
            this.collapseBtn.className = 'gn-expand-btn';
            this.collapseBtn.title = '展开目录';
            this.collapseBtn.innerHTML = `
        <svg viewBox="0 0 1024 1024" fill="currentColor">
          <path d="M195.1 344.1v335.8c0 26.7 11.1 52.3 30.9 71.2 19.8 18.9 46.7 29.5 74.7 29.5h422.6c28 0 54.9-10.6 74.7-29.5 19.8-18.9 30.9-44.5 30.9-71.2V344.1c0-26.7-11.1-52.3-30.9-71.2-19.8-18.9-46.7-29.5-74.7-29.5H300.7c-28 0-54.9 10.6-74.7 29.5-19.8 18.8-30.9 44.5-30.9 71.2z m422.5-33.6h105.6c9.3 0 18.3 3.5 24.9 9.8 6.6 6.3 10.3 14.8 10.3 23.7v335.8c0 8.9-3.7 17.4-10.3 23.7-6.6 6.3-15.6 9.8-24.9 9.8H617.6V310.5z m-352.1 33.6c0-8.9 3.7-17.4 10.3-23.7 6.6-6.3 15.6-9.8 24.9-9.8h246.5v403H300.7c-9.3 0-18.3-3.5-24.9-9.8-6.6-6.3-10.3-14.8-10.3-23.7v-336z"/>
        </svg>
      `;
            this.collapseBtn.style.display = 'flex';

            // 将面板插入到 Gemini 内容区
            this.insertPanelIntoLayout();

            // 将展开按钮插入到 Gemini 顶栏
            this.insertExpandButton();

            // 获取引用
            this.listContainer = this.panel.querySelector('.gn-list');
            this.searchInput = this.panel.querySelector('.gn-search-input');

            // 绑定事件
            this.bindEvents();

            // 恢复折叠状态
            this.restoreState();
        }

        /**
         * 将展开按钮插入到 Gemini 顶栏右侧
         */
        insertExpandButton() {
            // 优先：插入到 studio-sidebar-button 容器的左侧（作为兄弟元素）
            const studioBtn = document.querySelector('.top-bar-actions studio-sidebar-button');
            const studioContainer = studioBtn ? studioBtn.closest('.buttons-container') : null;
            if (studioContainer && studioContainer.parentElement) {
                if (this.collapseBtn.parentElement === studioContainer.parentElement
                    && this.collapseBtn.nextElementSibling === studioContainer) return;
                studioContainer.parentElement.insertBefore(this.collapseBtn, studioContainer);
                return;
            }

            // studio-sidebar-button 不存在时：插入到 pillbox 容器前面（作为兄弟元素）
            const pillbox = document.querySelector('.top-bar-actions [data-test-id="pillbox"]');
            if (pillbox && pillbox.parentElement) {
                if (this.collapseBtn.parentElement === pillbox.parentElement
                    && this.collapseBtn.nextElementSibling === pillbox) return;
                pillbox.parentElement.insertBefore(this.collapseBtn, pillbox);
                return;
            }

            // 降级：插入到 buttons-container
            const buttonsContainer = document.querySelector(CONFIG.SELECTORS.HEADER_BUTTONS);
            if (buttonsContainer) {
                if (this.collapseBtn.parentElement === buttonsContainer) return;
                buttonsContainer.insertBefore(this.collapseBtn, buttonsContainer.firstChild);
            } else {
                const rightSection = document.querySelector(CONFIG.SELECTORS.HEADER_RIGHT_SECTION);
                if (rightSection) {
                    if (this.collapseBtn.parentElement === rightSection) return;
                    rightSection.insertBefore(this.collapseBtn, rightSection.firstChild);
                } else if (!this.collapseBtn.parentElement) {
                    console.warn('Navigator for Gemini: 未找到顶栏按钮容器，使用降级方案');
                    document.body.appendChild(this.collapseBtn);
                }
            }
        }

        /**
         * 将面板插入到 Gemini 页面布局中（全高侧边栏模式）
         * 将面板插入到 chat-app 根元素内，与 main.chat-app 并列，
         * 使面板独占整个垂直方向（从顶栏到页面底部）
         */
        insertPanelIntoLayout() {
            const appRoot = document.querySelector(CONFIG.SELECTORS.APP_ROOT);

            if (appRoot && this.panel.parentElement !== appRoot) {
                // 使 chat-app 成为 flex 行容器
                appRoot.style.display = 'flex';
                appRoot.style.flexDirection = 'row';
                appRoot.style.overflow = 'hidden';

                // 确保 main.chat-app 占据剩余空间
                const mainContent = appRoot.querySelector(CONFIG.SELECTORS.MAIN_CONTENT);
                if (mainContent) {
                    mainContent.style.flex = '1';
                    mainContent.style.minWidth = '0';
                    mainContent.style.overflow = 'hidden';
                }

                // 插入面板作为最后一个子元素（右侧，与顶栏齐平）
                appRoot.appendChild(this.panel);
            } else if (!appRoot && !this.panel.parentElement) {
                console.warn('Navigator for Gemini: 未找到 chat-app 根元素，面板添加到 body');
                document.body.appendChild(this.panel);
            }

            // 调整固定定位元素的偏移
            this.adjustFixedElements();
        }

        /**
         * 调整 Gemini 页面中固定/绝对定位的元素（如顶栏、Google 账号栏）
         * 使其在面板打开时向左偏移，避免被面板遮挡
         */
        adjustFixedElements() {
            const panelWidth = this.isCollapsed ? 0 : CONFIG.PANEL_WIDTH;
            this.injectFixedElementsOverride(panelWidth);

            // 用 margin-right 而非 right，这样会叠加到 Angular 原有的 right 值上，
            // 避免直接覆盖导致与头像位置重叠
            const topBarActions = document.querySelector('top-bar-actions');
            if (topBarActions) {
                topBarActions.style.setProperty('margin-right', panelWidth + 'px', 'important');
            }
        }

        /**
         * 注入/更新 CSS 规则，覆盖 Gemini 顶栏元素的定位
         * 始终保留 transition 规则，确保展开/收起时平滑过渡
         */
        injectFixedElementsOverride(panelWidth) {
            const styleId = 'gemininav-fixed-override';
            let styleEl = document.getElementById(styleId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                document.head.appendChild(styleEl);
            }

            styleEl.textContent = `
                .boqOnegoogleliteOgbOneGoogleBar {
                    transition: right 0.2s ease !important;
                    right: ${panelWidth}px !important;
                }
                top-bar-actions {
                    transition: margin-right 0.2s ease, left 0.3s, right 0.3s !important;
                }
            `;
        }

        /**
         * 绑定事件
         */
        bindEvents() {
            // 折叠按钮
            const collapseBtn = this.panel.querySelector('.gn-btn-collapse');
            collapseBtn.addEventListener('click', () => {
                this.toggleCollapse();
            });

            // 展开按钮
            this.collapseBtn.addEventListener('click', () => {
                this.toggleCollapse();
            });

            // 搜索输入
            this.searchInput.addEventListener(
                'input',
                debounce((e) => {
                    this.searchTerm = e.target.value.toLowerCase();
                    this.render();
                }, CONFIG.DEBOUNCE_DELAY)
            );

            // 搜索清空按钮
            this.panel.querySelector('.gn-search-clear').addEventListener('click', () => {
                this.searchInput.value = '';
                this.searchTerm = '';
                this.render();
                this.searchInput.focus();
            });

            // 目录项点击 - 使用 mousedown 比 click 更快响应
            this.listContainer.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                if (e.target.closest('.gn-rename-btn') ||
                    e.target.closest('.gn-item-rename-btn') ||
                    e.target.closest('.gn-item-ai-btn') ||
                    e.target.closest('.gn-rename-input')) {
                    return;
                }

                const item = e.target.closest('.gn-item');
                if (item && item.dataset.id && !item.classList.contains('gn-item-editing')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideTooltip();
                    this.currentHoverId = null;
                    const id = item.dataset.id;
                    this.scrollToItem(id);
                }
            });

            // AI 摘要按钮和重命名按钮点击
            this.listContainer.addEventListener('click', (e) => {
                if (e.target.closest('.gn-item-ai-btn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = e.target.closest('.gn-item');
                    if (item && item.dataset.id) {
                        this.aiSummarize(item.dataset.id);
                    }
                    return;
                }

                if (e.target.closest('.gn-item-rename-btn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = e.target.closest('.gn-item');
                    if (item && item.dataset.id) {
                        this.startRename(item.dataset.id);
                    }
                    return;
                }
            });

            // ESC 和 Enter 键处理
            this.listContainer.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('gn-rename-input')) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.cancelRename();
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        this.confirmRename();
                    }
                }
            });

            // Tooltip 悬停事件
            this.currentHoverId = null;

            this.listContainer.addEventListener('mouseover', (e) => {
                const item = e.target.closest('.gn-item');
                if (item && item.dataset.id && !item.classList.contains('gn-item-editing')) {
                    const id = item.dataset.id;
                    if (id !== this.currentHoverId) {
                        this.currentHoverId = id;
                        this.scheduleTooltip(item);
                    }
                }
            });

            this.listContainer.addEventListener('mouseout', (e) => {
                const relatedTarget = e.relatedTarget;
                const newItem = relatedTarget?.closest?.('.gn-item');
                const newId = newItem?.dataset?.id;

                if (newId !== this.currentHoverId) {
                    this.currentHoverId = null;
                    this.hideTooltip();
                }
            });
        }

        /**
         * 开始重命名
         */
        startRename(itemId) {
            this.editingItemId = itemId;
            this.hideTooltip();
            this.render();

            setTimeout(() => {
                this.clickOutsideHandler = (e) => {
                    const editingItem = this.listContainer.querySelector('.gn-item-editing');
                    if (editingItem && !editingItem.contains(e.target)) {
                        this.cancelRename();
                    }
                };
                document.addEventListener('mousedown', this.clickOutsideHandler);
            }, 0);
        }

        /**
         * 确认重命名
         */
        async confirmRename() {
            const input = this.listContainer.querySelector('.gn-rename-input');
            if (input && this.editingItemId) {
                const newName = input.value.trim().substring(0, CONFIG.RENAME_MAX_LENGTH);
                await this.saveCustomName(this.editingItemId, newName);
                this.editingItemId = null;
                if (this.clickOutsideHandler) {
                    document.removeEventListener('mousedown', this.clickOutsideHandler);
                    this.clickOutsideHandler = null;
                }
                this.render();
            }
        }

        /**
         * 取消重命名
         */
        cancelRename() {
            this.editingItemId = null;
            if (this.clickOutsideHandler) {
                document.removeEventListener('mousedown', this.clickOutsideHandler);
                this.clickOutsideHandler = null;
            }
            this.render();
        }

        /**
         * AI 摘要并自动重命名
         */
        async aiSummarize(itemId) {
            if (this.summarizingItemId) return;

            const available = await AISummarizerService.isAvailable();
            if (!available) {
                console.warn('Navigator for Gemini: Summarizer API 不可用');
                return;
            }

            const tocItem = this.tocManager.getItems().find((i) => i.id === itemId);
            if (!tocItem || !tocItem.element) return;

            this.summarizingItemId = itemId;
            this.hideTooltip();
            this.render();

            try {
                const { userText, assistantText } = TextPreprocessor.extractConversationPair(tocItem.element);
                const inputText = TextPreprocessor.formatForSummarization({ userText, assistantText });
                const summary = await AISummarizerService.summarize(inputText);

                const newName = (summary || '').trim().substring(0, CONFIG.RENAME_MAX_LENGTH);
                if (newName) {
                    await this.saveCustomName(itemId, newName);
                }
            } catch (e) {
                console.warn('Navigator for Gemini: AI 摘要失败', e);
            } finally {
                this.summarizingItemId = null;
                this.render();
            }
        }

        /**
         * 渲染目录列表
         */
        render() {
            const items = this.tocManager.getItems();
            const activeId = this.tocManager.getActiveItemId();

            // 过滤搜索
            const filteredItems = this.searchTerm
                ? items.filter((item) => {
                    const term = this.searchTerm;
                    const original = item.summary.toLowerCase();
                    const custom = (this.customNames[item.id] || '').toLowerCase();
                    return original.includes(term) || custom.includes(term);
                })
                : items;

            // 生成列表 HTML
            const html = filteredItems
                .map((item) => {
                    const isActive = item.id === activeId;
                    const isJumpTarget = item.id === this.jumpTargetId;
                    const isEditing = item.id === this.editingItemId;
                    const displayName = this.getDisplayName(item);
                    const hasCustomName = this.customNames[item.id] ? true : false;
                    const isSummarizing = item.id === this.summarizingItemId;

                    if (isEditing) {
                        return `
          <div class="gn-item gn-item-editing" data-id="${item.id}">
            <input type="text" class="gn-rename-input" value="${this.escapeAttr(displayName)}" maxlength="${CONFIG.RENAME_MAX_LENGTH}" />
          </div>
        `;
                    } else if (isSummarizing) {
                        return `
          <div class="gn-item gn-item-summarizing" data-id="${item.id}">
            <span class="gn-item-indicator"></span>
            <span class="gn-item-summary">AI 摘要中...</span>
            <span class="gn-item-ai-loading"></span>
          </div>
        `;
                    } else {
                        return `
          <div class="gn-item ${isActive ? 'gn-item-active' : ''}" data-id="${item.id}" data-fulltext="${this.escapeAttr(item.fullText || '')}" data-original="${this.escapeAttr(item.summary)}">
            <span class="gn-item-indicator ${isJumpTarget ? 'gn-indicator-active' : ''}"></span>
            <span class="gn-item-summary ${hasCustomName ? 'gn-custom-name' : ''}">${this.escapeHtml(displayName)}</span>
            <button class="gn-item-ai-btn" title="AI 摘要"></button>
            <button class="gn-item-rename-btn" title="重命名"></button>
          </div>
        `;
                    }
                })
                .join('');

            const newHtml = html || '<div class="gn-empty">暂无消息</div>';
            if (newHtml === this._lastRenderedHtml) return;
            this._lastRenderedHtml = newHtml;
            this.listContainer.innerHTML = newHtml;

            // 如果有编辑中的项目，聚焦输入框
            if (this.editingItemId) {
                const input = this.listContainer.querySelector('.gn-rename-input');
                if (input) {
                    input.focus();
                    input.select();
                }
            }
        }

        /**
         * 转义 HTML 属性
         */
        escapeAttr(text) {
            return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        /**
         * 延迟显示 Tooltip
         */
        scheduleTooltip(itemEl) {
            if (this.tooltipTimer) {
                clearTimeout(this.tooltipTimer);
                this.tooltipTimer = null;
            }

            const itemId = itemEl.dataset.id;

            this.tooltipTimer = setTimeout(() => {
                if (this.currentHoverId === itemId) {
                    const currentItem = this.listContainer.querySelector(`[data-id="${itemId}"]`);
                    if (currentItem) {
                        const fullText = currentItem.dataset.fulltext;
                        if (fullText && fullText.length > 0) {
                            this.showTooltip(currentItem, fullText);
                        }
                    }
                }
            }, CONFIG.TOOLTIP_DELAY);
        }

        /**
         * 显示 Tooltip
         */
        showTooltip(itemEl, text) {
            this.hideTooltip();

            this.tooltip = document.createElement('div');
            this.tooltip.className = 'gn-tooltip';
            this.tooltip.textContent = text;

            const rect = itemEl.getBoundingClientRect();
            const panelRect = this.panel.getBoundingClientRect();

            this.tooltip.style.left = `${rect.left - panelRect.left}px`;
            this.tooltip.style.top = `${rect.bottom - panelRect.top + 5}px`;
            this.tooltip.style.maxWidth = `${panelRect.width - 20}px`;

            this.panel.appendChild(this.tooltip);
        }

        /**
         * 隐藏 Tooltip
         */
        hideTooltip() {
            if (this.tooltipTimer) {
                clearTimeout(this.tooltipTimer);
                this.tooltipTimer = null;
            }
            if (this.tooltip) {
                this.tooltip.remove();
                this.tooltip = null;
            }
        }

        /**
         * 刷新目录
         */
        refresh() {
            // 检查对话 ID 是否变更
            const currentConvId = this.getConversationId();
            if (this.conversationId !== currentConvId) {
                this.conversationId = currentConvId;
                this.loadCustomNames();
            }

            // 确保面板在正确的 DOM 位置
            this.insertPanelIntoLayout();
            this.insertExpandButton();

            // 如果正在滚动、正在重命名或正在 AI 摘要，跳过刷新
            if (this.isScrolling || this.editingItemId || this.summarizingItemId) return;
            this.tocManager.scan();
            this.render();
        }

        /**
         * 滚动到指定项
         * 使用自定义滚动动画解决 content-visibility 导致的首次跳转不准问题
         */
        scrollToItem(id) {
            const item = this.tocManager.getItems().find((i) => i.id === id);
            if (!item || !item.element) return;

            // 检查元素是否仍在 DOM 中
            if (!item.element.isConnected) {
                this.tocManager.scan();
                const freshItem = this.tocManager.getItems().find(i => i.id === id);
                if (!freshItem?.element) return;
                item.element = freshItem.element;
            }

            this.isScrolling = true;
            this.scrollTargetId = id;
            this.scrollTargetElement = item.element;

            // 设置跳转目标指示器（小绿点）
            this.jumpTargetId = id;
            this.updateJumpIndicator(id);

            // 获取滚动容器
            const scrollContainer = document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER)
                || document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER_ALT);
            if (!scrollContainer) return;

            // 取消之前的滚动动画
            if (this.scrollAnimationId) {
                cancelAnimationFrame(this.scrollAnimationId);
            }

            this.animateScrollToElement(item.element, scrollContainer);
        }

        /**
         * 自定义滚动动画
         * 在每一帧中重新计算目标位置，适应 content-visibility 导致的布局变化
         */
        animateScrollToElement(targetElement, scrollContainer) {
            const duration = 500;
            const startTime = performance.now();
            const startScrollTop = scrollContainer.scrollTop;

            const containerRect = scrollContainer.getBoundingClientRect();
            const containerStyle = window.getComputedStyle(scrollContainer);
            const scrollPaddingTop = parseFloat(containerStyle.scrollPaddingTop) || 0;

            const getTargetScrollTop = () => {
                const elementRect = targetElement.getBoundingClientRect();
                return scrollContainer.scrollTop + elementRect.top - containerRect.top - scrollPaddingTop;
            };

            const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const easedProgress = easeOutCubic(progress);

                const currentTargetScrollTop = getTargetScrollTop();
                const newScrollTop = startScrollTop + (currentTargetScrollTop - startScrollTop) * easedProgress;

                scrollContainer.scrollTop = newScrollTop;

                if (progress < 1) {
                    this.scrollAnimationId = requestAnimationFrame(animate);
                } else {
                    const finalTargetScrollTop = getTargetScrollTop();
                    scrollContainer.scrollTop = finalTargetScrollTop;
                    this.scrollAnimationId = null;
                    this.onScrollAnimationEnd();
                }
            };

            this.scrollAnimationId = requestAnimationFrame(animate);
        }

        /**
         * 自定义滚动动画结束处理
         */
        onScrollAnimationEnd() {
            this.scrollTargetElement = null;

            if (this.scrollTargetId) {
                this.updateActiveItemUI(this.scrollTargetId);
                this.tocManager.setActiveItem(this.scrollTargetId);
                this.scrollTargetId = null;
            }

            this.isScrolling = false;
        }

        /**
         * 更新跳转目标指示器（小绿点）
         */
        updateJumpIndicator(activeId) {
            const oldIndicator = this.listContainer.querySelector('.gn-indicator-active');
            if (oldIndicator) {
                oldIndicator.classList.remove('gn-indicator-active');
            }
            const newItem = this.listContainer.querySelector(`[data-id="${activeId}"] .gn-item-indicator`);
            if (newItem) {
                newItem.classList.add('gn-indicator-active');
            }
        }

        /**
         * 通过 DOM 操作更新活跃项 UI（避免完整重新渲染）
         */
        updateActiveItemUI(activeId) {
            const oldActive = this.listContainer.querySelector('.gn-item-active');
            if (oldActive) {
                oldActive.classList.remove('gn-item-active');
            }
            const newActive = this.listContainer.querySelector(`[data-id="${activeId}"]`);
            if (newActive) {
                newActive.classList.add('gn-item-active');
            }
        }

        /**
         * 切换折叠状态
         */
        toggleCollapse() {
            this.isCollapsed = !this.isCollapsed;
            this.panel.classList.toggle('gn-collapsed', this.isCollapsed);
            this.collapseBtn.style.display = 'flex';
            this.adjustFixedElements();
            this.saveState();
        }

        /**
         * 保存状态
         */
        saveState() {
            try {
                localStorage.setItem('gemininav-collapsed', JSON.stringify(this.isCollapsed));
            } catch (e) {
                console.warn('Navigator for Gemini: 无法保存状态', e);
            }
        }

        /**
         * 恢复状态
         */
        restoreState() {
            try {
                const collapsed = localStorage.getItem('gemininav-collapsed');
                if (collapsed) {
                    this.isCollapsed = JSON.parse(collapsed);
                    if (this.isCollapsed) {
                        this.panel.classList.add('gn-collapsed');
                        this.collapseBtn.style.display = 'flex';
                    }
                }
            } catch (e) {
                console.warn('Navigator for Gemini: 无法恢复状态', e);
            }
            // 初始化时也要调整固定定位元素
            this.adjustFixedElements();
        }

        /**
         * 更新活跃项（基于滚动位置）
         * 使用滚动容器的 getBoundingClientRect 而非 window.scrollY
         */
        updateActiveByScroll() {
            if (this.isScrolling) return;

            const items = this.tocManager.getItems();
            if (items.length === 0) return;

            const scrollContainer = document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER)
                || document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER_ALT);
            if (!scrollContainer) return;

            let activeItem = null;
            const containerRect = scrollContainer.getBoundingClientRect();
            const offset = 100;

            for (const item of items) {
                if (!item.element) continue;
                // 检查元素是否仍在 DOM 中
                if (!item.element.isConnected) continue;
                const rect = item.element.getBoundingClientRect();
                const relativeTop = rect.top - containerRect.top;
                if (relativeTop <= offset) {
                    activeItem = item;
                } else {
                    break;
                }
            }

            if (activeItem && activeItem.id !== this.tocManager.getActiveItemId()) {
                this.tocManager.setActiveItem(activeItem.id);
                this.render();

                const activeEl = this.listContainer.querySelector('.gn-item-active');
                if (activeEl) {
                    activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        }

        /**
         * HTML 转义
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // ============================================================
    // 主程序
    // ============================================================
    class GeminiChatNavigator {
        constructor() {
            this.tocManager = new TocManager();
            this.tocPanel = new TocPanel(this.tocManager);
            this.observer = null;
            this.scrollHandler = null;
            this._scrollContainer = null;
            this._lastUrl = window.location.href;
        }

        /**
         * 初始化
         */
        init() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup());
            } else {
                this.setup();
            }
        }

        /**
         * 设置
         */
        async setup() {
            // 延迟执行以确保 Gemini 的 Angular 应用完全加载
            setTimeout(async () => {
                this.tocPanel.create();
                await this.tocPanel.loadCustomNames();
                this.tocPanel.refresh();
                this.setupObserver();
                this.setupScrollListener();
                this.setupUrlChangeDetection();
                console.log('Navigator for Gemini: 初始化完成');
            }, 1500);
        }

        /**
         * 设置 MutationObserver 监听 DOM 变化
         */
        setupObserver() {
            const target = document.body;

            this.observer = new MutationObserver(
                debounce(() => {
                    this.tocPanel.refresh();
                }, CONFIG.DEBOUNCE_DELAY * 2)
            );

            this.observer.observe(target, {
                childList: true,
                subtree: true,
            });
        }

        /**
         * 设置滚动监听
         * Gemini 的滚动容器是 infinite-scroller 元素
         */
        setupScrollListener() {
            // 清理旧的监听器
            if (this._scrollContainer && this.scrollHandler) {
                this._scrollContainer.removeEventListener('scroll', this.scrollHandler);
            }

            const scrollContainer =
                document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER)
                || document.querySelector(CONFIG.SELECTORS.SCROLL_CONTAINER_ALT);

            if (!scrollContainer) {
                // Angular 可能尚未渲染，延迟重试
                setTimeout(() => this.setupScrollListener(), 2000);
                return;
            }

            this.scrollHandler = throttle(() => {
                this.tocPanel.updateActiveByScroll();
            }, CONFIG.THROTTLE_DELAY);

            scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });
            this._scrollContainer = scrollContainer;
        }

        /**
         * 检测 SPA 路由变化
         * Gemini 是 SPA，切换对话不会刷新页面
         */
        setupUrlChangeDetection() {
            // URL 轮询检测
            setInterval(() => {
                if (window.location.href !== this._lastUrl) {
                    this._lastUrl = window.location.href;
                    this.onNavigationChange();
                }
            }, 500);

            // popstate 事件监听
            window.addEventListener('popstate', () => {
                this.onNavigationChange();
            });
        }

        /**
         * 路由变化处理
         */
        onNavigationChange() {
            // 延迟执行，等待 Angular 渲染新内容
            setTimeout(() => {
                this.setupScrollListener();
                this.tocPanel.refresh();
            }, 1000);
        }

        /**
         * 销毁
         */
        destroy() {
            if (this.observer) {
                this.observer.disconnect();
            }
            if (this._scrollContainer && this.scrollHandler) {
                this._scrollContainer.removeEventListener('scroll', this.scrollHandler);
            }
        }
    }

    // ============================================================
    // 启动
    // ============================================================
    const app = new GeminiChatNavigator();
    app.init();
})();
