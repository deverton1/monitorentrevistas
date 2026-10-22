import { config } from '../config.js';

/**
 * Chat completion com saida JSON forcada por gramatica (JSON Schema) no llama-server.
 * Retorna o objeto ja parseado. Lanca em timeout/erro de rede/JSON invalido (apos 1 retry).
 */
export async function chatJson({ system, user, schema, schemaName, maxTokens = 400, temperature = 0.1 }) {
  const body = {
    model: 'local',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    top_p: 0.9,
    max_tokens: maxTokens,
    stream: false,
    response_format: {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    },
  };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${config.llm.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.llm.timeoutMs),
      });
      if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      return JSON.parse(content);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
