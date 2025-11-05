import { exec } from 'child_process';
import { google } from 'googleapis';
import { writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { randomBytes } from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reinicia o arquivo de log para esta execução
const logStream = createWriteStream('setup-gcp.log');

const log = (message, level = 'INFO') => {
    const logMessage = `${new Date().toISOString()} [${level}]: ${message}\n`;
    process.stdout.write(logMessage); // Escreve também no console
    logStream.write(logMessage);
};

const OAUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const REQUIRED_APIS = [
    'admin.googleapis.com', 'people.googleapis.com', 'generativelanguage.googleapis.com',
    'firestore.googleapis.com', 'iam.googleapis.com', 'cloudresourcemanager.googleapis.com',
    'iap.googleapis.com', 'billingbudgets.googleapis.com'
];

const logStream = createWriteStream('setup-gcp.log', { flags: 'a' });

const log = (message) => {
    logStream.write(`${new Date().toISOString()}: ${message}\n`);
};

async function executeCommand(command) {
    log(`Executando comando: ${command}`);
    return new Promise((resolve, reject) => {
        const proc = exec(command, (error, stdout, stderr) => {
            if (stdout) log(`STDOUT: ${stdout}`);
            if (stderr) log(`STDERR: ${stderr}`, 'WARN');
            if (error) {
                log(`EXEC ERROR: ${error.message}`, 'ERROR');
                reject(new Error(`O comando falhou: ${command}\n${stderr || error.message}`));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

async function getAuthenticatedClient() {
    log('Iniciando o processo de autenticação do usuário.');
    console.log(chalk.blue('Passo 1: Autenticação com o Google Cloud'));
    console.log(chalk.yellow('O EXA Shield precisa de permissão para gerenciar recursos do GCP em seu nome.'));

    try {
        await executeCommand('gcloud auth application-default login --quiet');
        log('Comando de login do gcloud executado.');
    } catch (e) {
        log(`O comando de login inicial falhou. Isso pode acontecer se o usuário interromper o fluxo. Erro: ${e.message}`, 'WARN');
    }

    log('Verificando o status da autenticação.');
    try {
        const user = await executeCommand('gcloud config get-value account');
        if (!user) {
             throw new Error('Nenhum usuário autenticado encontrado.');
        }
        log(`Autenticação verificada para o usuário: ${user}`);
        console.log(chalk.green(`\n✓ Autenticado com sucesso como: ${user}`));

        const auth = new google.auth.GoogleAuth({ scopes: OAUTH_SCOPES });
        const client = await auth.getClient();
        log('Cliente de autenticação do Google obtido com sucesso.');
        return client;

    } catch (error) {
        log(`Falha na verificação da autenticação: ${error.stack}`, 'ERROR');
        console.error(chalk.red('Falha na autenticação. Verifique se você completou o login no navegador.'));
        console.error(chalk.cyan('Consulte o arquivo `setup-gcp.log` para detalhes.'));
        throw error;
    }
}

async function selectOrCreateProject(authClient) {
    log('Iniciando a seleção ou criação de projeto.');
    const resourceManager = google.cloudresourcemanager('v1');

    console.log(chalk.blue('\nPasso 2: Seleção do Projeto no Google Cloud'));
    console.log(chalk.yellow('Buscando seus projetos existentes...'));

    let projects = [];
    try {
        const response = await resourceManager.projects.list({ auth: authClient });
        projects = response.data.projects || [];
        log(`Encontrados ${projects.length} projetos.`);
    } catch (e) {
        log(`Não foi possível listar os projetos: ${e.message}`, 'ERROR');
        console.log(chalk.red('Não foi possível buscar seus projetos. Verifique suas permissões.'));
    }

    const choices = [
        new inquirer.Separator(),
        { name: 'Criar um novo projeto', value: 'CREATE_NEW' },
        new inquirer.Separator(),
        ...projects.map(p => ({ name: `${p.name} (${p.projectId})`, value: p.projectId }))
    ];

    const { projectId } = await inquirer.prompt([{
        type: 'list', name: 'projectId',
        message: 'Selecione um projeto existente ou crie um novo:',
        choices: choices, pageSize: 15,
    }]);

    if (projectId === 'CREATE_NEW') {
        const { newProjectId } = await inquirer.prompt([{
            type: 'input', name: 'newProjectId',
            message: 'Digite um ID único para o novo projeto (ex: exa-shield-1234):',
            validate: input => /^[a-z][a-z0-9-]{5,29}$/.test(input) ? true : 'ID inválido. Use letras minúsculas, números e hífens.',
        }]);

        log(`Tentando criar o projeto com ID: ${newProjectId}`);
        console.log(chalk.blue(`Criando o projeto "${newProjectId}"...`));
        log(`Iniciando a criação do projeto com ID: ${newProjectId}`);
        await resourceManager.projects.create({
            requestBody: { projectId: newProjectId, name: `EXA Shield (${newProjectId})` },
            auth: authClient,
        });
        log(`Projeto ${newProjectId} criado com sucesso.`);
        console.log(chalk.green('✓ Projeto criado com sucesso!'));
        return newProjectId;
    }

    log(`Projeto selecionado: ${projectId}`);
    return projectId;
}

async function linkBilling(projectId) {
    log(`Iniciando o processo de vinculação de faturamento para ${projectId}.`);
    console.log(chalk.blue('\nPasso 3: Vinculação de Faturamento'));

    try {
        const billingAccounts = await executeCommand('gcloud beta billing accounts list --format="value(ACCOUNT_ID, DISPLAY_NAME)"');
        if (!billingAccounts) {
            log('Nenhuma conta de faturamento encontrada.', 'ERROR');
            throw new Error('Nenhuma conta de faturamento encontrada.');
        }

        const choices = billingAccounts.split('\n').map(line => {
            const [id, name] = line.split('\t');
            return { name: `${name} (${id})`, value: id };
        });

        const { billingId } = await inquirer.prompt([{
            type: 'list', name: 'billingId',
            message: 'Selecione a conta de faturamento para associar a este projeto:',
            choices: choices,
        }]);

        log(`Vinculando projeto ${projectId} à conta ${billingId}.`);
        await executeCommand(`gcloud beta billing projects link ${projectId} --billing-account=${billingId}`);
        log('Vinculação de faturamento bem-sucedida.');
        console.log(chalk.green('✓ Faturamento vinculado com sucesso!'));

    } catch (e) {
         log(`Falha ao vincular o faturamento: ${e.message}.`, 'WARN');
         console.log(chalk.yellow('Não foi possível vincular o faturamento automaticamente. Verifique se o projeto já está associado a uma conta no console do GCP.'));
    }
}

async function enableAPIs(projectId) {
    log(`Iniciando a ativação das APIs para ${projectId}.`);
    console.log(chalk.blue('\nPasso 4: Ativando as APIs necessárias... (Isso pode levar vários minutos)'));

    for (const [index, api] of REQUIRED_APIS.entries()) {
        log(`Ativando API: ${api} (${index + 1}/${REQUIRED_APIS.length})`);
        try {
            await executeCommand(`gcloud services enable ${api} --project=${projectId}`);
            console.log(chalk.green(`  ✓ ${api}`));
        } catch (e) {
            log(`Falha ao ativar ${api}: ${e.message}`, 'WARN');
            console.log(chalk.yellow(`  - ${api} (já ativada ou falhou)`));
        }
    }
    log('Ativação de APIs concluída.');
}

async function createFirestore(projectId) {
    log(`Iniciando a criação do Firestore para ${projectId}.`);
    console.log(chalk.blue('\nPasso 5: Configurando o Banco de Dados Firestore'));

    const { location } = await inquirer.prompt([{
        type: 'list', name: 'location',
        message: 'Selecione a região para o banco de dados:',
        choices: ['nam5 (United States)', 'eur3 (Europe)', 'southamerica-east1 (São Paulo)'],
        default: 'southamerica-east1 (São Paulo)',
    }]);

    const locationId = location.split(' ')[0];
    log(`Região selecionada: ${locationId}`);

    try {
        await executeCommand(`gcloud firestore databases create --project=${projectId} --location=${locationId} --type=firestore-native --quiet`);
        log('Banco de dados Firestore criado com sucesso.');
        console.log(chalk.green('✓ Banco de dados criado com sucesso!'));
    } catch (error) {
        if (error.message.includes('already exists')) {
             log('O banco de dados Firestore já existe.', 'INFO');
             console.log(chalk.yellow('✓ O banco de dados Firestore já existe.'));
        } else {
            log(`Erro ao criar o banco de dados: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    log('Implantando índices do Firestore.');
    const indexFilePath = path.join(__dirname, 'backend', 'firestore.indexes.json');
    try {
        await executeCommand(`gcloud firestore indexes composite create --project=${projectId} --database='(default)' ${indexFilePath}`);
        log('Índices do Firestore implantados com sucesso.');
        console.log(chalk.green('✓ Índices do banco de dados otimizados!'));
    } catch (error) {
        if (error.message.includes('already exists')) {
            log('Os índices do Firestore já existem.', 'INFO');
            console.log(chalk.yellow('✓ Índices já otimizados.'));
        } else {
             log(`Erro ao criar índices: ${error.message}`, 'ERROR');
        }
    }
}

async function createCredentials(projectId, authClient) {
    log(`Iniciando a criação de credenciais para ${projectId}.`);
    const iap = google.iap({ version: 'v1', auth: authClient });
    const redirectUri = 'http://localhost:3001/api/auth/google/callback';

    console.log(chalk.blue('\nPasso 6: Criando Credenciais de Acesso'));

    // 1. Tela de Consentimento OAuth
    let brandName;
    try {
        log('Criando a tela de consentimento OAuth.');
        const supportEmail = await executeCommand('gcloud config get-value account');
        const { data } = await iap.projects.brands.create({
            parent: `projects/${projectId}`,
            requestBody: { supportEmail: supportEmail.trim(), applicationTitle: 'EXA Shield' },
        });
        brandName = data.name;
        log(`Tela de consentimento criada: ${brandName}`);
        console.log(chalk.green('  ✓ Tela de Consentimento OAuth criada.'));
    } catch (error) {
        if (error.code === 409) {
            log('A tela de consentimento já existe, buscando...', 'INFO');
            const { data } = await iap.projects.brands.list({ parent: `projects/${projectId}` });
            brandName = data.brands[0].name;
            console.log(chalk.yellow('  ✓ Tela de Consentimento OAuth já existe.'));
        } else {
            log(`Erro ao criar tela de consentimento: ${error.message}`, 'ERROR');
            throw error;
        }
    }

    // 2. Cliente OAuth
    let clientId, clientSecret;
    try {
        log(`Criando o cliente OAuth sob a marca: ${brandName}`);
        const { data } = await iap.projects.brands.identityAwareProxyClients.create({
            parent: brandName,
            requestBody: { displayName: 'EXA Shield Web Client' }
        });
        clientId = data.name.split('/')[3];
        clientSecret = data.secret;
        log(`Cliente OAuth criado: ${clientId}`);
        console.log(chalk.green('  ✓ Cliente OAuth 2.0 criado.'));
    } catch(e) {
        log(`Erro ao criar cliente OAuth: ${e.message}`, 'ERROR');
        throw e;
    }

    // 3. Chave de API Gemini
    let apiKey;
    try {
        log('Criando chave de API para o Gemini.');
        const res = await executeCommand(`gcloud alpha services api-keys create --project=${projectId} --display-name="Gemini API Key"`);
        const keyMatch = res.match(/key:\s*(\S+)/);
        if(!keyMatch) throw new Error("Não foi possível extrair a chave de API da resposta.");
        apiKey = keyMatch[1];
        log('Chave de API do Gemini criada.');
        console.log(chalk.green('  ✓ Chave de API do Gemini criada.'));
    } catch (error) {
        log(`Erro ao criar chave de API: ${error.stack}`, 'ERROR');
        throw error;
    }

    return { clientId, clientSecret, redirectUri, apiKey };
}


async function main() {
    log('---=== Iniciando o Assistente de Configuração do EXA Shield ===---');
    console.log(chalk.bold.yellow('\n---=== 🛡️  Assistente de Configuração do EXA Shield  ===---'));
    console.log(chalk.gray('Este assistente irá guiá-lo na configuração do seu ambiente no Google Cloud.'));
    console.log(chalk.gray('Um log detalhado será salvo em `setup-gcp.log`\n'));

    try {
        const authClient = await getAuthenticatedClient();
        const projectId = await selectOrCreateProject(authClient);

        await linkBilling(projectId);
        await enableAPIs(projectId);

        console.log(chalk.blue('\n...Aguardando 60 segundos para que as APIs sejam provisionadas...'));
        log('Aguardando 60 segundos...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        log('Aguarde concluído.');

        await createFirestore(projectId);
        const { clientId, clientSecret, redirectUri, apiKey } = await createCredentials(projectId, authClient);

        log('Gerando o arquivo .env.');
        const envContent = `
# Credenciais geradas pelo assistente de configuração do EXA Shield
GCP_PROJECT_ID=${projectId}
GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
API_KEY=${apiKey}
REDIRECT_URI=${redirectUri}

# Chaves de segurança para os cookies da sessão (não altere)
COOKIE_SECRET_KEY_1=${randomBytes(32).toString('hex')}
COOKIE_SECRET_KEY_2=${randomBytes(32).toString('hex')}
`.trim();

        await writeFile(path.join(__dirname, '.env'), envContent);
        log('Arquivo .env criado com sucesso.');

        console.log(chalk.bold.green('\n🎉 Configuração concluída com sucesso! 🎉'));
        console.log(chalk.cyan('O arquivo `.env` foi criado na raiz do projeto.'));
        console.log(chalk.yellow('\nPara iniciar a aplicação, execute:'));
        console.log(chalk.white('npm install && npm run dev'));

    } catch (error) {
        log(`ERRO FATAL: ${error.stack || error}`, 'FATAL');
        console.error(chalk.red.bold('\n❌ Ocorreu um erro crítico durante a configuração:'));
        console.error(chalk.white(error.message));
        console.error(chalk.cyan('Consulte o arquivo `setup-gcp.log` para um diagnóstico detalhado.'));
        process.exit(1);
    } finally {
        logStream.end();
    }
}

main();
