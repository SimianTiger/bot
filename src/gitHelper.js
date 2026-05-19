const config = require('./config');
const logger = require('./logger');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '..', '.uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Inicializa o simple-git na pasta raiz do projeto (onde fica o .git, se já existir)
// Se o usuário quiser criar um repositório isolado só para .uploads, mudamos isso.
// Mas normalmente ele vai querer adicionar tudo no próprio repositório do bot.
const git = simpleGit();

/**
 * Salva a transcrição e o relatório na pasta .uploads e envia para o Git.
 * @param {string} fullTranscript 
 * @param {string} report 
 */
async function pushToGit(fullTranscript, report) {
    const repoUrl = config.GIT_REPO_URL;
    if (!repoUrl) {
        logger.info('[GIT] GIT_REPO_URL não configurado no .env. Ignorando upload automático.');
        return;
    }

    try {
        logger.info('[GIT] Preparando para enviar arquivos...');
        
        // Formatar nome dos arquivos com data e hora
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
        const transcriptPath = path.join(uploadDir, `BRUTO_${dateStr}.md`);
        const reportPath = path.join(uploadDir, `RELATORIO_${dateStr}.md`);

        // Salva os arquivos localmente
        fs.writeFileSync(transcriptPath, fullTranscript, 'utf-8');
        fs.writeFileSync(reportPath, report, 'utf-8');

        // Verifica se é um repositório git, se não for, inicializa
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            logger.info('[GIT] Inicializando repositório Git...');
            await git.init();
        }

        // Garante que a branch atual se chama 'main'
        await git.checkoutLocalBranch('main').catch(() => {});

        // Configura remotos e autor, se necessário
        const remotes = await git.getRemotes(true);
        const hasOrigin = remotes.some(r => r.name === 'origin');
        
        if (!hasOrigin) {
            logger.info(`[GIT] Adicionando remote origin: ${repoUrl}`);
            await git.addRemote('origin', repoUrl);
        } else {
            // Atualiza a URL do origin para garantir que está com a URL certa
            await git.remote(['set-url', 'origin', repoUrl]);
        }

        const authorName = config.GIT_AUTHOR_NAME;
        const authorEmail = config.GIT_AUTHOR_EMAIL;

        // Configura o autor localmente para este commit
        await git.addConfig('user.name', authorName);
        await git.addConfig('user.email', authorEmail);

        logger.info('[GIT] Adicionando arquivos...');
        await git.add(['.uploads/*']);

        logger.info('[GIT] Realizando commit...');
        await git.commit(`Nova transcrição gerada em ${new Date().toLocaleString()}`);

        logger.info('[GIT] Sincronizando com o repositório remoto (pull)...');
        try {
            // Tenta puxar as alterações remotas (ex: README criado no github)
            await git.pull('origin', 'main', { '--allow-unrelated-histories': null });
        } catch (pullError) {
            logger.warn('[GIT] Aviso no pull (pode ser repositório vazio):', pullError.message);
        }

        logger.info('[GIT] Enviando para o repositório (push)...');
        await git.push('origin', 'main', { '--set-upstream': null });
        
        logger.info('[GIT] ✅ Upload para o Git concluído com sucesso!');
    } catch (error) {
        logger.error('[GIT] ❌ Erro ao enviar para o Git:', error);
    }
}

module.exports = {
    pushToGit
};
