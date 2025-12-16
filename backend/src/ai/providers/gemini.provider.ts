import { Injectable, InternalServerErrorException } from '@nestjs/common';

// Why: express retryability upstream by exposing status/body instead of obscuring inside HttpException.
export class GeminiProviderError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Gemini error ${status}`);
  }
}

/**
 * Thin wrapper around Gemini HTTP API. Keeps raw request/response for audit purposes.
 */
@Injectable()
export class GeminiProvider {
  async generate(prompt: string, model: string, temperature: number) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException({ code: 'AI_PROVIDER_ERROR', message: 'GEMINI_API_KEY is not configured' });
    }

    // Accept both "gemini-3-pro-preview" and "models/gemini-3-pro-preview".
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }]}],
      generationConfig: {
        temperature,
        maxOutputTokens: 2048,
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new GeminiProviderError(res.status, text);
    }

    try {
      const parsed = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const candidate = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return { rawText: candidate || text, rawResponse: parsed, request: requestBody };
    } catch {
      // If response body is not JSON, return raw text to allow pipeline parsing/backoff.
      return { rawText: text, rawResponse: text, request: requestBody };
    }
  }
}
