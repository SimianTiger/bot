const config = require('./config');
const logger = require('./logger');
const { EmbedBuilder } = require('discord.js');
const { connectToVoiceChannel, getAudioDebugInfo, setUserThreshold } = require('./audioHandler');
const { stopRecordingAndProcess } = require('./sessionManager');

function makeEmbed({ title, description, color = 0x2f3136, fields = [] }) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .addFields(fields)
        .setTimestamp();
}

function formatTimeAgo(ms) {
    if (ms === null) return 'nunca';
    if (ms < 1000) return `${Math.round(ms)}ms atrás`;
    return `${Math.round(ms / 1000)}s atrás`;
}

async function handleCommands(message, client) {
    if (!message.content.startsWith(config.COMMAND_PREFIX)) return;

    const args = message.content.slice(config.COMMAND_PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'entrar') {
        if (!message.member.voice.channel) {
            return message.reply('❌ Você precisa estar em um canal de voz primeiro!');
        }

        try {
            await connectToVoiceChannel(message.member.voice.channel, message.author.id, message.channel);
            const embed = makeEmbed({
                title: '✅ Gravação iniciada',
                description: `Vou gravar e transcrever o áudio no canal **${message.member.voice.channel.name}**. Use **!audio** para ver o status e **!parar** para finalizar.`,
                color: 0x22c55e,
                fields: [
                    { name: 'Dica rápida', value: 'Fale normalmente e evite ruídos de fundo para melhor qualidade.' }
                ]
            });
            return message.reply({ embeds: [embed] });
        } catch (error) {
            logger.error(error);
            return message.reply({ content: '❌ Ocorreu um erro ao tentar entrar no canal.' });
        }
    }

    if (command === 'audio') {
        try {
            const info = getAudioDebugInfo(message.guild.id, message.author.id);
            if (!info) {
                return message.reply('ℹ️ Ainda não tenho estatísticas desse usuário. Entre no canal e use `!entrar`.');
            }

            const now = Date.now();
            const lastPacketAgo = info.lastPacketAt ? Math.max(0, now - new Date(info.lastPacketAt).getTime()) : null;
            const lastVoiceAgo = info.lastVoiceAt ? Math.max(0, now - new Date(info.lastVoiceAt).getTime()) : null;

            const embed = makeEmbed({
                title: '🎙️ Status de áudio',
                description: 'Informações em tempo real do seu fluxo de voz.',
                color: 0x60a5fa,
                fields: [
                    { name: 'Último pacote', value: formatTimeAgo(lastPacketAgo), inline: true },
                    { name: 'Última voz detectada', value: formatTimeAgo(lastVoiceAgo), inline: true },
                    { name: 'RMS atual', value: `${info.lastRms ?? '—'} (limiar ${info.threshold ?? config.AUDIO_VAD_RMS_THRESHOLD})`, inline: false },
                    { name: 'Ganho (AGC)', value: `${info.gain ?? '—'}x`, inline: true },
                    { name: 'Em segmento', value: info.inSegment ? '✅ Sim' : '❌ Não', inline: true },
                    { name: 'Auto-calibração', value: config.ENABLE_AUTO_CALIBRATION ? '✅ Ativa' : '❌ Desligada', inline: true }
                ]
            });
            return message.reply({ embeds: [embed] });
        } catch (e) {
            logger.error(e);
            return message.reply('❌ Erro ao consultar status de áudio.');
        }
    }

    if (command === 'calibrar') {
        if (!message.member.voice.channel) {
            return message.reply('❌ Você precisa estar em um canal de voz para calibrar.');
        }

        try {
            await message.reply('⏳ Calibrando por 5 segundos... fale normalmente (e depois bem baixinho).');

            const samples = [];
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            for (let i = 0; i < 10; i++) {
                const info = getAudioDebugInfo(message.guild.id, message.author.id);
                if (info?.lastRms != null) samples.push(info.lastRms);
                await sleep(500);
            }

            if (!samples.length) {
                return message.reply(
                    '❌ Não consegui medir seu áudio. ' +
                    'Verifique se o Discord está enviando entrada (input volume/sensibilidade) e tente de novo.'
                );
            }

            const max = Math.max(...samples);
            const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
            const suggestedThreshold = Math.max(config.AUDIO_VAD_RMS_THRESHOLD, Math.round(avg * 1.25));
            setUserThreshold(message.guild.id, message.author.id, suggestedThreshold);

            let verdict = '✅ Volume OK.';
            if (max < 400) verdict = '⚠️ Volume muito baixo (o Discord/entrada pode não estar captando bem).';
            else if (max < 800) verdict = '⚠️ Volume baixo (pode falhar em alguns trechos).';

            const embed = makeEmbed({
                title: '🎧 Calibração concluída',
                description: `Seu novo limiar de voz foi ajustado para **${suggestedThreshold}**.`,
                color: 0xf59e0b,
                fields: [
                    { name: 'RMS médio', value: String(avg), inline: true },
                    { name: 'RMS pico', value: String(max), inline: true },
                    { name: 'Observação', value: verdict, inline: false },
                    { name: 'Próximo passo', value: 'Se o resultado estiver baixo, aumente o volume de entrada e desative a sensibilidade automática no Discord.' }
                ]
            });
            return message.reply({ embeds: [embed] });
        } catch (e) {
            logger.error(e);
            return message.reply('❌ Erro ao calibrar áudio.');
        }
    }

    if (command === 'parar') {
        try {
            await message.reply({ embeds: [makeEmbed({
                title: '⏳ Finalizando sessão',
                description: 'Parando a gravação e gerando o resumo. Isso pode levar alguns minutos.',
                color: 0x8b5cf6
            })] });
            await stopRecordingAndProcess(message.author, message.guild.id);
            await message.channel.send({ embeds: [makeEmbed({
                title: '✅ Resumo concluído',
                description: 'A ata foi gerada e o upload para o Git foi iniciado.',
                color: 0x22c55e
            })] });
        } catch (error) {
            logger.error(error);
            message.reply('❌ Não há sessão ativa neste servidor ou ocorreu um erro.');
        }
    }
}

module.exports = { handleCommands };
