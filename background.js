/**
 * Navigator for Gemini - Background Service Worker
 * 负责转发 content script 的 AI 摘要请求到代理服务器
 */

import { API_BASE } from './config.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AI_SUMMARIZE') {
        handleSummarize(message.text)
            .then(sendResponse)
            .catch((e) => sendResponse({ error: e.message }));
        // 返回 true 表示异步响应
        return true;
    }
});

async function handleSummarize(text) {
    const response = await fetch(`${API_BASE}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `请求失败 (${response.status})`);
    }

    return await response.json();
}
