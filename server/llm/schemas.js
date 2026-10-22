export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segment_type', 'question_text', 'claims'],
  properties: {
    segment_type: { enum: ['pergunta', 'afirmacao', 'opiniao', 'conversa', 'ruido'] },
    question_text: { type: 'string', maxLength: 240 },
    claims: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'kind', 'checkworthy', 'reason', 'search_query'],
        properties: {
          claim: { type: 'string', maxLength: 240 },
          kind: { enum: ['estatistica', 'acusacao', 'fato_historico', 'atribuicao', 'promessa', 'previsao', 'opiniao', 'outro'] },
          checkworthy: { type: 'boolean' },
          reason: { type: 'string', maxLength: 120 },
          search_query: { type: 'string', maxLength: 120 },
        },
      },
    },
  },
};

export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'summary', 'used_evidence_ids', 'reasoning_short'],
  properties: {
    verdict: { enum: ['VERDADEIRO', 'FALSO', 'ENGANOSO', 'SEM_EVIDENCIA', 'INCONCLUSIVO'] },
    confidence: { enum: ['alta', 'media', 'baixa'] },
    summary: { type: 'string', maxLength: 280 },
    used_evidence_ids: { type: 'array', items: { type: 'integer' }, maxItems: 4 },
    reasoning_short: { type: 'string', maxLength: 160 },
  },
};
