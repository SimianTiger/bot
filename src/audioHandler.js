const config = require('./config');
const logger = require('./logger');
const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const { startSession, addTranscription } = require('./sessionManager');
const { transcribeAudio } = require('./aiProcessor');
const fs = require('fs');
const path = require('path');
const prism = require('prism-media');
const { Writable } = require('stream');

async function connectToVoiceChannel(voiceChannel, initiatorId, textChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
    });

    startSession(voiceChannel.guild.id, initiatorId);

    const receiver = connection.receiver;

    // ────────────────────────────────────────────────────────────
    // FIX DE ACORDAR A CONEXÃO (Discord Voice API Bug)
    // Às vezes o bot não recebe áudio nenhum até tocar algum som.
    // Tocamos 1 segundo de silêncio absoluto ao entrar na call.
    // ────────────────────────────────────────────────────────────
    try {
        const { createAudioPlayer, createAudioResource, StreamType } = require('@discordjs/voice');
        const { Readable } = require('stream');
        const player = createAudioPlayer();
        connection.subscribe(player);
        
        class Silence extends Readable {
            constructor() {
                super();
                this.pushed = 0;
            }
            _read() {
                if (this.pushed < 10) {
                    this.push(Buffer.alloc(960 * 2 * 2, 0)); // 20ms silence
                    this.pushed++;
                } else {
                    this.push(null);
                }
            }
        }
        player.play(createAudioResource(new Silence(), { inputType: StreamType.Raw }));
    } catch (e) { logger.error("Erro ao tocar silêncio", e); }

    // Começa a "escutar" todo mundo que já está no canal.
    for (const [memberId, member] of voiceChannel.members) {
        if (member?.user?.bot) continue;
        ensureUserCapture({
            receiver,
            guild: voiceChannel.guild,
            userId: memberId
        });
    }

    // Fallback: cria captura quando um usuário começa a falar.
    receiver.speaking.on('start', (userId) => {
        const member = voiceChannel.guild.members.cache.get(userId);
        if (!member || member.user.bot) return;
        if (config.SHOW_AUDIO_DEBUG) {
            logger.debug(`[AUDIO] usuário começou a falar: ${userId}`);
        }
        ensureUserCapture({ receiver, guild: voiceChannel.guild, userId });
    });

    // E também quem entrar depois
    const client = voiceChannel.guild.client;
    const guildId = voiceChannel.guild.id;
    const channelId = voiceChannel.id;

    // Evita múltiplos listeners se o comando !entrar for chamado mais de uma vez
    detachVoiceStateListener(guildId);
    const onVoiceStateUpdate = (oldState, newState) => {
        // Entrou no canal monitorado
        if (newState.channelId === channelId && oldState.channelId !== channelId) {
            const member = newState.member;
            if (!member || member.user.bot) return;
            ensureUserCapture({ receiver, guild: voiceChannel.guild, userId: newState.id });
        }

        // Saiu do canal monitorado
        if (oldState.channelId === channelId && newState.channelId !== channelId) {
            stopUserCapture(guildId, oldState.id, 'saiu do canal');
        }
    };

    client.on('voiceStateUpdate', onVoiceStateUpdate);
    voiceStateListeners.set(guildId, { client, handler: onVoiceStateUpdate });

    // Se a conexão cair, tenta limpar tudo
    connection.on('stateChange', (_, newState) => {
        try {
            if (newState.status === 'destroyed') {
                cleanupGuildCaptures(guildId);
            }
        } catch (_) {}
    });
}

const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const userQueues = {};

// ────────────────────────────────────────────────────────────
// Captura contínua + VAD por volume (mais robusto que receiver.speaking)
// - Também aplica ganho (AGC simples) para ajudar voz baixa
// - Segmenta por silêncio/ausência de pacotes e manda cada segmento para o Deepgram
// ────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;
const BYTES_PER_SAMPLE = 2; // int16

const VAD_RMS_THRESHOLD = config.AUDIO_VAD_RMS_THRESHOLD; // mais baixo = mais sensível
const SEGMENT_END_MS = config.SEGMENT_END_MS;
const MAX_SEGMENT_MS = config.MAX_SEGMENT_MS;
const MIN_SEGMENT_MS = config.MIN_SEGMENT_MS;
const TARGET_RMS = config.TARGET_RMS;
const MIN_GAIN = config.AUDIO_MIN_GAIN;
const MAX_GAIN = config.MAX_GAIN; // 4x ≈ +12dB
const CLIP_THRESHOLD = config.AUDIO_CLIP_THRESHOLD;

const voiceStateListeners = new Map(); // guildId -> { client, handler }
const activeCaptures = new Map(); // key `${guildId}:${userId}` -> capture
const audioDebug = new Map(); // key `${guildId}:${userId}` -> stats
const userThresholds = new Map(); // key `${guildId}:${userId}` -> calibrated threshold
const userCalibration = new Map(); // key `${guildId}:${userId}` -> adaptive calibration stats

function setUserThreshold(guildId, userId, threshold) {
    userThresholds.set(getKey(guildId, userId), threshold);
}

function getUserThreshold(guildId, userId) {
    return userThresholds.get(getKey(guildId, userId));
}

function getUserCalibration(guildId, userId) {
    return userCalibration.get(getKey(guildId, userId));
}

function updateUserCalibration(guildId, userId, rms) {
    if (!config.ENABLE_AUTO_CALIBRATION) return null;

    const key = getKey(guildId, userId);
    const previous = getUserCalibration(guildId, userId);
    const alpha = 0.12;
    const avgRms = previous?.avgRms ? (previous.avgRms * (1 - alpha) + rms * alpha) : rms;
    const calculated = Math.max(VAD_RMS_THRESHOLD, Math.round(avgRms * 1.2));
    const maxThreshold = VAD_RMS_THRESHOLD * 3;
    const threshold = Math.min(calculated, maxThreshold);

    const targetRms = Math.max(TARGET_RMS, Math.round(avgRms * 1.1));
    const calibration = { avgRms, threshold, targetRms };
    userCalibration.set(key, calibration);
    return calibration;
}

function detachVoiceStateListener(guildId) {
    const existing = voiceStateListeners.get(guildId);
    if (!existing) return;
    try {
        existing.client.off('voiceStateUpdate', existing.handler);
    } catch (_) {}
    voiceStateListeners.delete(guildId);
}

function getKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function getAudioDebugInfo(guildId, userId) {
    return audioDebug.get(getKey(guildId, userId)) || null;
}

function getCalibrationThreshold(guildId, userId) {
    const manualThreshold = getUserThreshold(guildId, userId);
    if (manualThreshold) return manualThreshold;
    if (!config.ENABLE_AUTO_CALIBRATION) return VAD_RMS_THRESHOLD;

    const calibration = getUserCalibration(guildId, userId);
    return calibration?.threshold ?? VAD_RMS_THRESHOLD;
}

function cleanupGuildCaptures(guildId) {
    detachVoiceStateListener(guildId);
    for (const key of Array.from(activeCaptures.keys())) {
        if (!key.startsWith(`${guildId}:`)) continue;
        const [, userId] = key.split(':');
        stopUserCapture(guildId, userId, 'cleanup guild');
    }
}

function stopUserCapture(guildId, userId, reason) {
    const key = getKey(guildId, userId);
    const cap = activeCaptures.get(key);
    if (!cap) return;
    try {
        cap.finalizeSegment(`stop (${reason})`);
    } catch (_) {}
    try {
        cap.cleanup();
    } catch (_) {}
    activeCaptures.delete(key);
}

function ensureUserCapture({ receiver, guild, userId }) {
    const key = getKey(guild.id, userId);
    if (activeCaptures.has(key)) return;

    if (config.SHOW_AUDIO_DEBUG) {
        logger.debug(`[AUDIO] Iniciando captura de voz para ${userId} no servidor ${guild.id}`);
    }

    const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Manual }
    });

    // Criar decoder com error resilience: ignora frames corrompidos e continua
    const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: 2, frameSize: 960 });
    let decoderErrorCount = 0;
    const MAX_DECODER_ERRORS = 15; // limite antes de tentar reconectar

    decoder.on('error', (err) => {
        decoderErrorCount++;
        // Silencia erros repetitivos; loga só os primeiros
        if (decoderErrorCount <= 3) {
            logger.warn(`[AUDIO] Decoder do usuário ${userId}: frame corrompido (${decoderErrorCount}/${MAX_DECODER_ERRORS} limite) - erro: ${err?.message || 'desconhecido'}`);
        } else if (decoderErrorCount === 5 || decoderErrorCount === 10) {
            logger.warn(`[AUDIO] Decoder do usuário ${userId}: acumulou ${decoderErrorCount} erros...`);
        }
        
        // Se ultrapassar limite, tenta reconectar
        if (decoderErrorCount >= MAX_DECODER_ERRORS) {
            logger.warn(`[AUDIO] Muitos erros do decoder para ${userId}. Tentando reconectar...`);
            // Força limpeza e reconexão
            stopUserCapture(guild.id, userId, 'decoder_errors_limit');
            // Agenda reconexão após 500ms
            setTimeout(() => {
                ensureUserCapture({ receiver, guild, userId });
            }, 500);
            return;
        }
        // NÃO para o stream; continua processando mesmo com erros
    });

    const capture = createContinuousCapture({
        guild,
        userId,
        onSegment: (pcmPath) => queueTranscription({ guild, userId, pcmPath })
    });

    opusStream.on('error', (err) => {
        logger.warn(`[AUDIO] Stream Opus do usuário ${userId}:`, err.message || 'desconexão/erro');
    });
    opusStream.on('data', () => {
        if (config.SHOW_AUDIO_DEBUG) {
            logger.debug(`[AUDIO] pacote de áudio recebido para ${userId}`);
        }
    });

    // Piping com tratamento seguro
    try {
        opusStream.pipe(decoder).pipe(capture.writable);
    } catch (pipeErr) {
        logger.error(`[AUDIO] Erro ao conectar pipeline para ${userId}:`, pipeErr);
        return;
    }

    activeCaptures.set(key, {
        finalizeSegment: capture.finalizeSegment,
        cleanup: () => {
            capture.cleanup();
            try { opusStream.destroy(); } catch (_) {}
            try { decoder.destroy(); } catch (_) {}
        }
    });
}

function createContinuousCapture({ guild, userId, onSegment }) {
    const key = getKey(guild.id, userId);

    let buffers = [];
    let segmentStartAt = null;
    let lastVoiceAt = 0;
    let lastPacketAt = 0;
    let gain = 1.0;
    let peakRmsInSegment = 0;

    function updateDebug(partial = {}) {
        const prev = audioDebug.get(key) || {};
        audioDebug.set(key, {
            guildId: guild.id,
            userId,
            lastPacketAt: prev.lastPacketAt || null,
            lastRms: prev.lastRms ?? null,
            lastVoiceAt: prev.lastVoiceAt || null,
            inSegment: prev.inSegment || false,
            gain: prev.gain || 1.0,
            peakRmsInSegment: prev.peakRmsInSegment || 0,
            ...partial
        });
    }

    function finalizeSegment(reason) {
        if (!buffers.length || !segmentStartAt) {
            buffers = [];
            segmentStartAt = null;
            peakRmsInSegment = 0;
            updateDebug({ inSegment: false, peakRmsInSegment: 0 });
            return;
        }

        const audioBuf = Buffer.concat(buffers);
        buffers = [];

        const durationMs = Math.round((audioBuf.length / (BYTES_PER_SAMPLE * SAMPLE_RATE)) * 1000);
        const shouldDiscard = durationMs < MIN_SEGMENT_MS;

        segmentStartAt = null;
        peakRmsInSegment = 0;
        updateDebug({ inSegment: false, peakRmsInSegment: 0 });

        if (shouldDiscard) return;

        const timestamp = Date.now();
        const pcmPath = path.join(tempDir, `${userId}-${timestamp}.pcm`);
        fs.writeFileSync(pcmPath, audioBuf);

        // Ajuda no debug: sabemos se a segmentação está disparando
        if (config.SHOW_AUDIO_DEBUG) {
            logger.debug(`[ÁUDIO] Segmento salvo (${durationMs}ms) user=${userId} motivo=${reason} arquivo=${path.basename(pcmPath)}`);
        }

        onSegment(pcmPath);
    }

    // Timer para fechar segmento mesmo quando param de vir pacotes (silêncio vira "gap")
    const interval = setInterval(() => {
        if (!segmentStartAt) return;
        const now = Date.now();

        // Se não chegou pacote há tempo suficiente, encerra
        if (now - lastPacketAt > SEGMENT_END_MS && now - lastVoiceAt > SEGMENT_END_MS) {
            finalizeSegment('gap/silêncio');
            return;
        }

        // Segurança: não deixa segmento gigante
        if (now - segmentStartAt > MAX_SEGMENT_MS) {
            finalizeSegment('max_segment_ms');
        }
    }, 200);

    const writable = new Writable({
        write(chunk, _enc, cb) {
            try {
                // Validar tamanho do chunk (deve ser múltiplo de 4: L+R em int16le)
                if (!chunk || chunk.length === 0 || chunk.length % 4 !== 0) {
                    if (config.SHOW_AUDIO_DEBUG && chunk?.length) {
                        logger.debug(`[AUDIO] Chunk inválido (tamanho ${chunk.length}, esperado múltiplo de 4)`);
                    }
                    return cb();
                }

                const now = Date.now();
                lastPacketAt = now;

                // chunk: PCM int16le estéreo (L,R intercalado) → vamos converter para MONO e aplicar ganho
                const mono = Buffer.allocUnsafe(chunk.length / 2);
                const samples = mono.length / 2;

                let sumSquares = 0;
                let peakSample = 0;
                for (let i = 0; i < samples; i++) {
                    const inOffset = i * 4; // 2 bytes L + 2 bytes R
                    const l = chunk.readInt16LE(inOffset);
                    const r = chunk.readInt16LE(inOffset + 2);
                    let v = (l + r) / 2;

                    peakSample = Math.max(peakSample, Math.abs(v));

                    // RMS pré-ajuste (para AGC)
                    // (usamos o v antes do ganho para não "explodir" ruído)
                    sumSquares += v * v;

                    // Escreve provisoriamente (vai aplicar ganho depois)
                    mono.writeInt16LE(v, i * 2);
                }

                const rms = Math.sqrt(sumSquares / samples);
                peakRmsInSegment = Math.max(peakRmsInSegment, rms);

                // Validar RMS (evita NaN/Infinity que podem quebrar AGC)
                if (!Number.isFinite(rms)) {
                    if (config.SHOW_AUDIO_DEBUG) {
                        logger.debug(`[AUDIO] RMS inválido para ${userId}: ${rms} (chunk corrompido?)`);
                    }
                    return cb();
                }

                const calibration = getUserCalibration(guild.id, userId);
                const targetRms = calibration?.targetRms ?? TARGET_RMS;
                let desiredGain = rms > 0 ? Math.min(MAX_GAIN, Math.max(MIN_GAIN, targetRms / rms)) : MAX_GAIN;

                // Se o áudio estiver muito alto, força redução para evitar estourar o PCM
                if (peakSample > CLIP_THRESHOLD) {
                    desiredGain = Math.min(desiredGain, CLIP_THRESHOLD / peakSample);
                }

                gain = (gain * 0.85) + (desiredGain * 0.15); // suaviza mudanças rápidas

                // Validar gain antes de aplicar
                if (!Number.isFinite(gain)) {
                    gain = 1.0;
                }

                if (Math.abs(gain - 1.0) > 0.01) {
                    for (let i = 0; i < samples; i++) {
                        const v = mono.readInt16LE(i * 2);
                        let out = Math.round(v * gain);
                        if (out > 32767) out = 32767;
                        if (out < -32768) out = -32768;
                        mono.writeInt16LE(out, i * 2);
                    }
                }

                // RMS pós-ganho para decidir VAD (mais justo pra voz baixa)
                let sumSquares2 = 0;
                for (let i = 0; i < samples; i++) {
                    const v = mono.readInt16LE(i * 2);
                    sumSquares2 += v * v;
                }
                const rmsAfter = Math.sqrt(sumSquares2 / samples);
                const threshold = getCalibrationThreshold(guild.id, userId);
                const isVoice = rmsAfter >= threshold;
                updateDebug({
                    lastPacketAt: new Date(now),
                    lastRms: Math.round(rmsAfter),
                    lastVoiceAt: isVoice ? new Date(now) : (audioDebug.get(key)?.lastVoiceAt || null),
                    inSegment: Boolean(segmentStartAt),
                    gain: Number(gain.toFixed(2)),
                    threshold,
                    peakRmsInSegment: Math.round(Math.max(peakRmsInSegment, rmsAfter))
                });

                if (isVoice) {
                    lastVoiceAt = now;
                    if (!segmentStartAt) {
                        segmentStartAt = now;
                        peakRmsInSegment = rmsAfter;
                        updateDebug({ inSegment: true });
                    }
                    updateUserCalibration(guild.id, userId, rmsAfter);
                    buffers.push(mono);
                } else {
                    // Se já estamos dentro de um segmento, ainda guardamos um pouco de "cauda"
                    // para não cortar palavras (100ms)
                    if (segmentStartAt && now - lastVoiceAt < 100) {
                        buffers.push(mono);
                    }
                }
            } catch (e) {
                // Nunca derruba o pipeline por erro de chunk
            } finally {
                cb();
            }
        }
    });

    updateDebug({
        lastPacketAt: null,
        lastRms: null,
        lastVoiceAt: null,
        inSegment: false,
        gain: 1.0,
        peakRmsInSegment: 0
    });

    return {
        writable,
        finalizeSegment,
        cleanup: () => {
            clearInterval(interval);
            try { writable.end(); } catch (_) {}
        }
    };
}

function queueTranscription({ guild, userId, pcmPath }) {
    const queueKey = `${guild.id}:${userId}`;
    if (!userQueues[queueKey]) userQueues[queueKey] = Promise.resolve();

    userQueues[queueKey] = userQueues[queueKey].then(async () => {
        try {
            if (!fs.existsSync(pcmPath)) return;

            const stats = fs.statSync(pcmPath);
            // descarta muito pequeno (normalmente ruído)
            if (stats.size < (SAMPLE_RATE * BYTES_PER_SAMPLE * 0.25)) {
                fs.unlinkSync(pcmPath);
                return;
            }

            const text = await transcribeAudio(pcmPath);

            if (text && text.trim().length > 0) {
                const cleanText = text.trim().toLowerCase().replace(/[.,!?\s]/g, '');
                const alucinacoes = ['tchau', 'obrigado', 'obrigada', 'atum', 'oi', 'né', 'ne', 'bom', 'hum'];

                if (alucinacoes.includes(cleanText)) {
                    if (config.SHOW_LOGS) {
                        logger.debug(`[ALUCINAÇÃO DESCARTADA] Deepgram: "${text.trim()}"`);
                    }
                } else {
                    let username = "Desconhecido";
                    try {
                        const member = await guild.members.fetch(userId);
                        username = member.displayName || member.user.username;
                    } catch (e) {}

                    if (config.SHOW_LOGS) {
                        logger.debug(`[TRANSCRIÇÃO] ${username}: ${text.trim()}`);
                    }
                    addTranscription(guild.id, username, text.trim());
                }
            }
        } catch (err) {
            logger.error(`Erro ao processar áudio do usuário ${userId}:`, err);
        } finally {
            try {
                if (fs.existsSync(pcmPath)) fs.unlinkSync(pcmPath);
            } catch (_) {}
        }
    });
}

async function waitForTranscriptions() {
    const promises = Object.values(userQueues);
    if (promises.length > 0) {
        await Promise.allSettled(promises);
    }
}

module.exports = {
    connectToVoiceChannel,
    getAudioDebugInfo,
    cleanupGuildCaptures,
    waitForTranscriptions,
    setUserThreshold
};
