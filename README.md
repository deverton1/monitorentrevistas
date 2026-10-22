# Monitor de Entrevistas — Checagem de Fatos em Tempo Real

Aplicação web para checagem em tempo real de afirmações e perguntas em entrevistas e debates políticos, com transcrição de áudio via **Whisper local**, análise por **Qwen local** e consulta a fontes confiáveis (**Google Fact Check Tools API** e **GNews**).

---

## Recursos

- **Transcrição em tempo real**: faster-whisper (`large-v3-turbo` com aceleração por GPU RTX) + VAD Silero.
- **IA Local**: `llama-server` rodando o modelo `Qwen3-4B-Instruct` com JSON Schema estrito forçado por gramática.
- **Checagem de Fatos**: Consulta automática à Google Fact Check Tools API (checagens publicadas por *Aos Fatos*, *Estadão Verifica*, *UOL*, etc.) e GNews.
- **Guardrails e Regras Determinísticas**: Filtro anti-alucinação, descarte de opiniões/promessas, e rating baseado nas agências de checagem.
- **Interface**:
  - Seleção de dispositivos de câmera, entrada e saída de áudio (`setSinkId`).
  - Suporte a microfone, áudio da tela compartilhada ou ambos mixados.
  - Banner em destaque para perguntas propostas pelo entrevistador.
  - Pilha de cards com animação, selo de veredito, links clicáveis das fontes e opção de fixar.
  - Campo de texto para testes manuais.

---

## Como Rodar

1. **Dependências do Node**:
   ```bash
   npm install
   ```

2. **Ambiente do Whisper (Python)**:
   ```bash
   npm run setup:stt
   ```

3. **Iniciar a aplicação**:
   ```bash
   npm start
   ```
   Acesse no navegador: **`http://localhost:3000`**

---

## Testes

- **Testes unitários e determinísticos**:
  ```bash
  npm run test:unit
  ```
- **Testes com o modelo Qwen local e pipeline completo**:
  ```bash
  npm test
  ```
