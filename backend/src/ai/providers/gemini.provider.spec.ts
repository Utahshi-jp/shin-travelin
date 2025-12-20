import { InternalServerErrorException } from '@nestjs/common';
import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  const originalEnv = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, GEMINI_API_KEY: 'test-key' };
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '{"title":"ok"}',
                    },
                  ],
                },
              },
            ],
          }),
        ),
    });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchMock.mockReset();
  });

  it('strips inline comments and whitespace from model values', async () => {
    const provider = new GeminiProvider();
    await provider.generate('prompt', 'models/gemini-3-flash   # 任意', 0.3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=test-key',
    );
  });

  it('throws when sanitized model name is empty', async () => {
    const provider = new GeminiProvider();
    await expect(
      provider.generate('prompt', '   # comment only', 0.3),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
