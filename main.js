async function recognize(base64, lang, options) {
    const { config } = options;
    let { apiKey, model = "gemini-2.0-flash", useStream: use_stream = 'true', systemPrompt, userPrompt, requestArguments, requestPath } = config;

    if (!/https?:\/\/.+/.test(requestPath)) {
        requestPath = `https://${requestPath}`;
    }
    const apiUrl = new URL(requestPath);
    // in openai like api, /v1 is not required
    if (!apiUrl.pathname.endsWith('/chat/completions')) {
        apiUrl.pathname += apiUrl.pathname.endsWith('/') ? '' : '/';
        apiUrl.pathname += 'v1/chat/completions';
    }

    const useStream = use_stream !== "false";
    const args = JSON.parse(requestArguments ?? '{}');
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    }

    const body = {
        model,
        messages: [
            ...(systemPrompt ? [{ "role": "system", "content": systemPrompt }] : []),
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": userPrompt ? userPrompt.replaceAll("$lang", lang) : `Just recognize the text in the image. Do not offer unnecessary explanations.`,
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": `data:image/jpeg;base64,${base64}`,
                        },
                    },
                ],
            }
        ],
        stream: useStream,
        temperature: 0.1,
        top_p: 0.99,
        ...args
    }
    let res = await window.fetch(apiUrl.href, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
    });

    if (res.ok) {
        // 非流式输出
        if (!useStream) {
            let result = await res.json();
            const { choices } = result;
            if (choices) {
                let target = choices[0].message.content.trim();
                if (target) {
                    return target
                } else {
                    throw JSON.stringify(choices);
                }
            } else {
                throw JSON.stringify(result);
            }
        }

        // 流式输出
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let result = '';
        let buffer = '';  // 用于存储跨块的不完整消息

        const processLines = (lines) => {
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.choices && data.choices.length > 0) {
                            const { delta } = data.choices[0];
                            if (delta && delta.content) {
                                result += delta.content;
                                setResult(result);
                            }
                        }
                    } catch (e) {
                        console.error('解析JSON失败:', e, line);
                    }
                }
            }
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    // 确保处理完所有剩余数据
                    const remainingText = decoder.decode();
                    if (remainingText) buffer += remainingText;
                    break;
                }

                // 解码当前块并追加到缓冲区
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                // 尝试处理完整的消息
                const lines = buffer.split('\n\n');
                // 保留最后一个可能不完整的部分
                buffer = lines.pop() || '';

                processLines(lines);
            }

            // 处理buffer中剩余的任何数据
            if (buffer) {
                const lines = buffer.split('\n\n');
                processLines(lines);
            }

            return result;
        } catch (error) {
            throw `Streaming response processing error: ${error.message}`;
        }
    } else {
        const errorData = await res.json().catch(() => null);
        throw `Http Request Error\nHttp Status: ${res.status}\n${errorData ? JSON.stringify(errorData) : 'No error details available'}`;
    }
}
