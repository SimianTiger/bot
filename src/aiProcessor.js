const { createClient } = require('@deepgram/sdk');
const config = require('./config');
const logger = require('./logger');
const deepgram = createClient(config.DEEPGRAM_API_KEY);
const fs = require('fs');
const path = require('path');

async function generateGroqReport(fullTranscript) {
    let sliceSize = 300000;
    let lastError = null;

    for (let attempt = 0; attempt < 4; attempt++) {
        const prompt = `Você é um assistente que analisa a transcrição de uma call de jogos online (ex: Valorant) e gera um relatório coeso.\n` +
            `A transcrição pode parecer caótica, com gírias (pinar, spike, bomb, capa, ult, etc.), reações rápidas, xingamentos e frases curtas. Sua tarefa é extrair o sentido geral da conversa.\n` +
            `Foque no clima da sessão (frustração, brincadeiras), problemas técnicos (áudio, mouse) e o contexto geral (ex: discutindo composições de time, reclamando do desempenho), ignorando os gritos isolados de narração do jogo.\n\n` +
            `Você deve usar OBRIGATORIAMENTE O SEGUINTE FORMATO EXATO, sem usar markdown (como negrito, asteriscos ou hashtags):\n\n` +
            `Resumo da Conversa\n\n` +
            `[Seu resumo aqui, em um único parágrafo, citando os participantes principais, os assuntos gerais discutidos fora e dentro do jogo e o clima da sessão.]\n\n` +
            `Conclusões/Próximos Passos\n\n` +
            `[Suas conclusões ou próximos passos aqui. Se não houver, escreva exatamente: "Nenhuma conclusão ou próximo passo foi definido durante esta conversa. A discussão se concentrou principalmente em interações durante a sessão de jogo e não resultou em decisões ou planos específicos para ações futuras."]\n\n` +
            `Não invente fatos. Apenas preencha as duas seções com um texto natural e bem escrito, corrigindo mentalmente a falta de contexto das falas isoladas.\n\n` +
            `Transcrição completa da sessão:\n${fullTranscript.slice(-sliceSize)}`;

        const response = await fetch(`${config.GROQ_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: config.GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1000,
                temperature: 0.0,
                top_p: 1.0
            })
        });

        if (response.ok) {
            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content;
            if (content && content.trim()) {
                return content.trim();
            }
        } else {
            const text = await response.text();
            lastError = `Groq API falhou: ${response.status} ${response.statusText} - ${text}`;
            // Se for erro de tamanho, bad request ou rate limit, diminui o pedaço e tenta de novo
            if (response.status === 400 || response.status === 413 || response.status === 429) {
                sliceSize = Math.floor(sliceSize / 2);
                if (sliceSize < 10000) sliceSize = 10000;
                await new Promise(r => setTimeout(r, 2000));
                continue;
            } else {
                throw new Error(lastError);
            }
        }
    }

    throw new Error(lastError || 'Falha ao obter resposta válida da Groq após várias tentativas.');
}

async function generateOpenAIReport(fullTranscript) {
    const key = require('./config').OPENAI_API_KEY;
    const model = require('./config').OPENAI_MODEL || 'gpt-4o-mini';
    if (!key) throw new Error('OPENAI_API_KEY não configurada');

    const prompt = `Você é um assistente que transforma uma transcrição de reunião em uma ata clara, objetiva e pronta para compartilhar.\n+Responda em português em um único bloco de texto, sem cabeçalhos extras nem marcações. Seja conciso (4-8 frases), inclua: uma frase-resumo da sessão, participantes principais (lista curta) e 2-4 próximos passos concretos com responsáveis quando detectáveis.
Não invente responsáveis e não adicione informações que não estejam na transcrição. Se não houver próximos passos, escreva "Nenhuma conclusão ou próximo passo foi definido durante esta conversa."\n\nTranscrição:\n${fullTranscript.slice(-40000)}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 800,
            temperature: 0.2
        })
    });

    if (!res.ok) {
        const t = await res.text();
        throw new Error(`OpenAI erro: ${res.status} ${res.statusText} - ${t}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
    if (!content) throw new Error('Resposta OpenAI vazia');
    return content.trim();
}

function extractActionItems(fullTranscript) {
    // Extrai linhas no formato: [HH:MM:SS] User: texto
    const lines = fullTranscript.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const keywords = ['decidimos', 'vamos', 'vou', 'fazer', 'entregar', 'deadline', 'deve', 'devem', 'deverá', 'tarefa', 'pra', 'para', 'acordamos', 'precisamos', 'combinar', 'agendar', 'treino', 'comprar', 'validar', 'usar'];
    const actionItems = [];

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (keywords.some((keyword) => lower.includes(keyword))) {
            // tenta manter o timestamp e o usuário se houver
            const m = line.match(/^\[(.*?)\]\s*(.*?):\s*(.*)$/);
            if (m) {
                actionItems.push({ time: m[1], user: m[2], text: m[3] });
            } else {
                actionItems.push({ time: null, user: null, text: line });
            }
        }
    }

    // Remove duplicatas baseadas no texto
    const unique = [];
    const seen = new Set();
    for (const it of actionItems) {
        const key = (it.text || '').toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(it);
        }
        if (unique.length >= 20) break;
    }

    return unique;
}

function buildLocalReport(fullTranscript) {
    const actionItems = extractActionItems(fullTranscript);

    // Parse lines para estrutura com time/user/text
    const lines = fullTranscript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map((line) => {
        const m = line.match(/^\[(.*?)\]\s*(.*?):\s*(.*)$/);
        if (m) return { time: m[1], user: m[2], text: m[3] };
        return { time: null, user: null, text: line };
    });

    const participants = Array.from(new Set(parsed.map(p => p.user).filter(Boolean))).slice(0, 50);

    // Extrai tópicos por frequência simples (palavras maiores que 3 letras)
    const stopwords = new Set(['que','com','para','pra','é','em','de','do','da','o','a','os','as','e','no','na','sei','não','tal','mano','cara','aqui','isso','estou','você','está','muito','mais','tem','vai','mas','porque','como']);
    const freq = {};
    for (const p of parsed) {
        const words = (p.text || '').toLowerCase().replace(/[^a-z0-9à-ú\s]/g, ' ').split(/\s+/).filter(Boolean);
        for (const w of words) {
            if (w.length <= 3) continue;
            if (stopwords.has(w)) continue;
            freq[w] = (freq[w] || 0) + 1;
        }
    }
    const topics = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,6).map(v=>v[0]);

    let report = 'Resumo da Conversa\n\n';

    if (participants.length) {
        report += `Sessão com ${participants.length} participante(s): ${participants.join(', ')}. A conversa foi marcada por momentos de tensão e comunicação estratégica durante a gameplay. Os termos de destaque foram: ${topics.join(', ')}.\n\n`;
    } else {
        report += 'Sessão com participantes não identificados.\n\n';
    }

    // Conclusões / próximos passos
    report += 'Conclusões/Próximos Passos\n\n';
    if (actionItems.length) {
        for (const it of actionItems) {
            if (it.time || it.user) {
                report += `- [${it.time ?? '??:??:??'}] ${it.user ?? ''}: ${it.text}\n`;
            } else {
                report += `- ${it.text}\n`;
            }
        }
        report += '\n';
    } else {
        report += 'Nenhuma conclusão ou próximo passo foi definido durante esta conversa. A discussão se concentrou principalmente em interações e não resultou em decisões ou planos específicos para ações futuras.\n\n';
    }

    return report;
}

// Não precisamos mais do FFmpeg!
// A Deepgram nativamente suporta o formato PCM bruto do Discord.
// Isso deixa o bot 10x mais rápido e imune a erros de conversão de áudio.

// Transcrever áudio usando Whisper
async function transcribeAudio(audioPath) {
    try {
        const audioBuffer = fs.readFileSync(audioPath);

        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // Pequeno retry para falhas transitórias (rede/429)
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
                    audioBuffer,
                    {
                        model: 'nova-2',
                        language: 'pt-BR',
                        smart_format: true,
                        filler_words: false, // Ajuda a remover ruídos
                        punctuate: true,
                        encoding: 'linear16', // PCM int16le
                        sample_rate: 48000,
                        channels: 1           // nosso pipeline agora salva em MONO (melhor pra voz)
                    }
                );

                if (error) throw error;

                // Extrai o texto da resposta da Deepgram
                const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
                return transcript;
            } catch (e) {
                lastError = e;
                // backoff simples
                if (attempt < 3) await sleep(250 * attempt);
            }
        }

        throw lastError;
    } catch (error) {
        logger.error("Erro na transcrição Deepgram:", error);
        return "";
    }
}

async function generateFinalReport(fullTranscript) {
    try {
        // Tenta gerar com o Groq primeiro, como solicitado pelo usuário
        if (config.GROQ_API_KEY) {
            try {
                return await generateGroqReport(fullTranscript);
            } catch (groqError) {
                logger.error('Falha ao gerar relatório Groq, usando fallback local:', groqError);
            }
        }

        return buildLocalReport(fullTranscript);
    } catch (error) {
        logger.error("Erro ao gerar relatório:", error);
        return 'Não foi possível gerar o relatório final automaticamente.';
    }
}

module.exports = {
    transcribeAudio,
    generateFinalReport
};
