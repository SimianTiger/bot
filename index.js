const config = require('./src/config');
const logger = require('./src/logger');
const { Client, GatewayIntentBits } = require('discord.js');
const { handleCommands } = require('./src/commands');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const figlet = require('figlet');
const gradient = require('gradient-string');

const banner = String.raw`
    _________ _______  _______  _        _______  _______  _______  _______           _______   
    \__   __/(  ____ )(  ___  )( (    /|(  ____ \(  ____ \(  ____ )(  ____ \|\     /|(  ____ \  
       ) (   | (    )|| (   ) ||  \  ( || (    \/| (    \/| (    )|| (    \/| )   ( || (    \/  
       | |   | (____)|| (___) ||   \ | || (_____ | |      | (____)|| (__    | |   | || (__      
       | |   |     __)|  ___  || (\ \) |(_____  )| |      |     __)|  __)   ( (   ) )|  __)     
       | |   | (\ (   | (   ) || | \   |      ) || |      | (\ (   | (       \ \_/ / | (        
       | |   | ) \ \__| )   ( || )  \  |/\____) || (____/\| ) \ \__| (____/\  \   /  | (____/\  
       )_(   |/   \__/|/     \||/    )_)\_______)(_______/|/   \__/(_______/   \_/   (_______/  
`;

let readyHandled = false;

function onClientReady() {
    if (readyHandled) return;
    readyHandled = true;

    console.clear();
    // Estilo de gradiente pastel do próprio pacote
    logger.info(gradient.pastel.multiline(banner));

    logger.info(`\n✅ Bot conectado como ${ client.user.tag } \n`);
    logger.info(`Para desligar o bot, basta fechar esta janela.\n`);
}

client.once('ready', onClientReady);
client.once('clientReady', onClientReady);

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Repassa a mensagem para o gerenciador de comandos
    await handleCommands(message, client);
});

client.login(config.DISCORD_TOKEN).catch((error) => {
    logger.error('Falha ao conectar o bot Discord:', error);
});
