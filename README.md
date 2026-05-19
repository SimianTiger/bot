# Transcreve

Bot Discord para gravação de áudio, transcrição com Deepgram, geração de relatório local e envio automático para Git.

## Instalação

1. Clone o repositório.
2. Rode `npm install`.
3. Copie `.env.example` para `.env` e preencha os valores.
4. Execute `npm start` no Windows ou `bash start-linux.sh` no Linux.

### Iniciando no Linux

- Use `bash start-linux.sh` ou `npm run start:linux`.

## Variáveis de ambiente obrigatórias

No arquivo `.env`, configure:

- `DISCORD_TOKEN`: token do bot Discord.
- `DEEPGRAM_API_KEY`: chave da API Deepgram.
- `GROQ_API_KEY`: chave da API Groq.

## Variáveis de ambiente opcionais

- `GIT_REPO_URL`: URL do repositório remoto para enviar transcrições e relatórios.
- `GIT_AUTHOR_NAME`: nome de autor usado nos commits do Git.
- `GIT_AUTHOR_EMAIL`: e-mail do autor usado nos commits do Git.
- `GROQ_API_KEY`: chave da API Groq para gerar sumários/atas melhores.
- `GROQ_MODEL`: modelo Groq a ser usado para resumos (padrão: `llama-3.3-70b-versatile`).
- `SHOW_LOGS`: `true` para logs de debug extras gerais.
- `SHOW_AUDIO_DEBUG`: `true` para ativar logs detalhados do fluxo de áudio.
- `COMMAND_PREFIX`: prefixo de comando usado no bot (padrão: `!`).
- `AUDIO_VAD_RMS_THRESHOLD`: limiar RMS para detectar voz (padrão: `220`).
- `AUDIO_SEGMENT_END_MS`: tempo de fim de segmento por silêncio (padrão: `1200`).
- `AUDIO_MAX_SEGMENT_MS`: duração máxima de segmento em ms (padrão: `25000`).
- `AUDIO_MIN_SEGMENT_MS`: duração mínima de segmento em ms (padrão: `300`).
- `AUDIO_TARGET_RMS`: RMS alvo para AGC (padrão: `1800`).
- `AUDIO_MAX_GAIN`: ganho máximo aplicado ao áudio (padrão: `4.0`).

## Comandos do bot

- `!entrar`: o bot entra no canal de voz e começa a gravação.
- `!audio`: mostra status de áudio do usuário.
- `!calibrar`: faz calibração de volume por 5 segundos.
- `!parar`: finaliza a sessão, gera a ata e tenta enviar para o Git.

## Avisos importantes

- O bot valida `DISCORD_TOKEN` e `DEEPGRAM_API_KEY` na inicialização.
- Se faltar alguma variável obrigatória, o bot vai falhar rápido e explicar o motivo.

## Melhorias sugeridas

- Adicionar testes automatizados para os módulos de áudio e comandos.
- Substituir `process.exit(0)` em `src/sessionManager.js` por um encerramento mais controlado, para o bot não terminar forçadamente em casos de erro.
- Criar um canal de logs dedicado ou usar uma biblioteca de logging para facilitar análise de problemas.
- Separar a lógica de voz e a lógica de transcrição em serviços independentes para facilitar a manutenção.
- Melhorar o tratamento de erros do Git para avisar quando não for possível fazer push ou gerar o relatório.