import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

export async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running!  More Details: https://github.com/tech-shrimp/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // OpenAI 兼容端点，保持不变
  if (
    url.pathname.endsWith('/chat/completions') ||
    url.pathname.endsWith('/completions') ||
    url.pathname.endsWith('/embeddings') ||
    url.pathname.endsWith('/models')
  ) {
    return openai.fetch(request);
  }

  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

  try {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const k = key.trim().toLowerCase();
      if (k === 'x-goog-api-key') {
        const apiKeys = value.split(',').map(s => s.trim()).filter(Boolean);
        if (apiKeys.length > 0) {
          const selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
          console.log(`Gemini Selected API Key: ${selectedKey}`);
          headers.set('x-goog-api-key', selectedKey);
        }
      } else if (k === 'content-type') {
        headers.set(key, value);
      }
      // 其他头部不转发，避免污染（保持和原逻辑一致）
    }

    console.log('Request Sending to Gemini');
    console.log('targetUrl:' + targetUrl);
    console.log(headers);

    // —— 自动为 generateContent 注入联网工具 —— //
    let forwardBody = request.body; // 默认透传
    const isJson = (headers.get('content-type') || '').includes('application/json');
    const isGenerateContent = pathname.includes(':generateContent');

    if (request.method !== 'GET' && isJson) {
      const raw = await request.clone().text(); // 读取一次
      if (raw) {
        if (isGenerateContent) {
          try {
            const obj = JSON.parse(raw);
            if (!Array.isArray(obj.tools)) {
              obj.tools = [{ google_search: {} }];
            } else if (!obj.tools.some(t => t && t.google_search !== undefined)) {
              obj.tools.push({ google_search: {} });
            }
            forwardBody = JSON.stringify(obj);
            // 防止 content-length 与新 body 不匹配
            try { headers.delete('content-length'); } catch {}
          } catch {
            // 不是合法 JSON 就原样透传
            forwardBody = raw;
          }
        } else {
          forwardBody = raw;
        }
      }
    }
    // —— 注入结束 —— //

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : forwardBody
    });

    console.log('Call Gemini Success');

    const responseHeaders = new Headers(response.headers);
    console.log('Header from Gemini:');
    console.log(responseHeaders);

    // 清理 hop-by-hop/压缩头
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('Failed to fetch:', error);
    return new Response('Internal Server Error\n' + (error?.stack || String(error)), {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
