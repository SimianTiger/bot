const config = require('./config');
const logger = require('./logger');
const { generateFinalReport } = require('./aiProcessor');
const { getVoiceConnection } = require('@discordjs/voice');
const { pushToGit } = require('./gitHelper');

// Formato das sessões:
// sessions[guildId] = { initiatorId: '...', transcriptions: [ { time: Date, user: 'João', text: 'Olá' } ] }
const sessions = {};

function startSession(guildId, initiatorId) {
    if (!sessions[guildId]) {
        sessions[guildId] = {
            initiatorId,
            transcriptions: []
        };
        logger.info(`[${guildId}] Nova sessão de gravação iniciada por ${initiatorId}`);
    } else {
        logger.info(`[${guildId}] Sessão já existia, mantendo transcrições antigas.`);
    }
}

function addTranscription(guildId, username, text) {
    if (sessions[guildId]) {
        sessions[guildId].transcriptions.push({
            time: new Date(),
            user: username,
            text: text
        });
        if (config.SHOW_LOGS) {
            logger.debug(`[${guildId}] Transcrição salva: ${username}: ${text}`);
        }
    }
}

async function stopRecordingAndProcess(author, guildId) {
    const session = sessions[guildId];
    if (!session) {
        throw new Error("Nenhuma sessão ativa.");
    }

    if (session.initiatorId !== author.id) {
        throw new Error("Apenas quem iniciou a gravação pode pará-la.");
    }

    // Desconectar do canal de voz
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
    }

    logger.info("Aguardando finalização do processamento de áudio...");
    // Aguarda um instante para garantir que os últimos buffers sejam processados
    await new Promise(r => setTimeout(r, 1000));
    
    // Importar dinamicamente para evitar dependência circular pesada se houver
    const { waitForTranscriptions } = require('./audioHandler');
    await waitForTranscriptions();

    // Processar transcrições
    const { transcriptions } = session;
    
    // Ordenar cronologicamente por garantia
    transcriptions.sort((a, b) => a.time - b.time);

    let fullTranscript = transcriptions.map(t => `[${t.time.toLocaleTimeString()}] ${t.user}: ${t.text}`).join('\n');
    
    if (!fullTranscript.trim()) {
        fullTranscript = "Nenhuma fala detectada durante a sessão.";
    }

    logger.info("Iniciando processamento com IA para gerar relatório...");
    const report = await generateFinalReport(fullTranscript);

    // Limpar sessão e encerrar o bot
    delete sessions[guildId];
    
    // Enviar arquivos para o Git automaticamente (ponto 4)
    await pushToGit(fullTranscript, report);

    logger.info("Sessão finalizada e relatório enviado. O bot continua em execução.");
}

module.exports = {
    startSession,
    addTranscription,
    stopRecordingAndProcess
};
