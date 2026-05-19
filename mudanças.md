MUDANÇAS 12/05/2026

• Configuração centralizada com config.js
• Validação automática de variáveis obrigatórias
• Novas opções configuráveis no .env
• Controle de parâmetros de áudio sem alterar código
• Atualização completa do .env.example
• Sistema de logs padronizado com logger.js
• Melhorias visuais no terminal com figlet + gradient
• Reformulação dos comandos do bot no Discord
• Embeds mais organizados e amigáveis
• Comando !entrar melhorado
• Comando !audio mostrando status detalhado do áudio
• Comando !calibrar com análise automática de RMS
• Comando !parar com feedback visual de processamento
• Implementação de VAD baseado em RMS
• Segmentação automática de áudio por silêncio/sinal
• Captura contínua de voz mais estável
• Auto Gain Control (AGC) básico para vozes baixas
• Melhor gerenciamento de buffers de áudio
• Redução de falsos positivos na detecção de voz
• Calibração individual por usuário
• Sistema de auto calibração opcional
• Adaptação automática ao volume de cada usuário
• Normalização de áudio por usuário
• Controle de ganho mínimo e limite de clipping
• Prevenção de distorção de áudio
• Melhor equilíbrio entre microfones altos e baixos
• Áudio mais limpo para transcrição
• Salvamento de segmentos em PCM
• Sistema de fila de transcrição por usuário
• Integração organizada com Deepgram
• Filtro para remover transcrições sem sentido/ruído
• Melhor estabilidade geral do fluxo de áudio
• Melhor experiência de uso no Discord
• Estrutura mais profissional e fácil de manter

1. Configuração centralizada (config.js)
O que mudou: Criado sistema de validação de variáveis obrigatórias e padrões para todas as opções.
Impacto: Elimina erros de configuração, facilita manutenção e permite ajustes sem tocar no código. O bot agora é mais confiável em produção.

2. Interface Discord profissional (commands.js)
O que mudou: Comandos respondem com embeds ricos em vez de texto simples.
Impacto: UX muito melhor no Discord - mensagens organizadas, cores e campos claros. Faz o bot parecer mais "profissional" e fácil de usar.

3. Detecção de voz inteligente (audioHandler.js)
O que mudou: Implementado VAD por RMS com AGC automático.
Impacto: Captura voz de forma mais precisa, reduz falsos positivos e funciona melhor com microfones variados. Core do bot ficou mais robusto.

4. Calibração automática por usuário (audioHandler.js)
O que mudou: Sistema opcional que adapta limiares baseado no áudio real das chamadas.
Impacto: "Aprende" com o uso - usuários com volume diferente são detectados melhor automaticamente. Reduz necessidade de ajustes manuais.

5. Normalização de áudio equilibrada (audioHandler.js)
O que mudou: Ganho dinâmico por usuário com limitador de pico.
Impacto: Equilibra vozes altas e baixas, evitando distorção. Transcrições ficam mais uniformes e claras em reuniões com participantes variados.

6. Correção de depreciação (index.js)
O que mudou: Atualizado evento Discord de 'ready' para 'clientReady'.
Impacto: Remove warnings irritantes no terminal, deixando a execução mais limpa.

Adicionar extensão para linux.