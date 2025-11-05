
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

const OAUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
const REQUIRED_APIS = [
    'admin.googleapis.com',
    'people.googleapis.com',
    'generativelanguage.googleapis.com',
    'firestore.googleapis.com',
    'iam.googleapis.com',
    'cloudresourcemanager.googleapis.com',
    'iap.googleapis.com'
];

const logStream = createWriteStream('setup-gcp.log', { flags: 'a' });

const log = (message) => {
    logStream.write(`${new Date().toISOString()}: ${message}\n`);
};

async function executeCommand(command) {
    log(`Executando comando: ${command}`);
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (stdout) log(`STDOUT: ${stdout}`);
            if (stderr) log(`STDERR: ${stderr}`);

            if (error) {
                log(`EXEC ERROR: ${error.message}`);
                if (command.includes('gcloud auth application-default login')) {
                    resolve(stderr);
                } else {
                    reject(new Error(`O comando falhou: ${command}\n${stderr || error.message}`));
                }
                return;
            }
            resolve(stdout.trim());
        });
    });
}

async function getAuthenticatedClient() {
    console.log(chalk.blue('Para autenticar, por favor, siga estes passos:'));
    console.log(chalk.yellow('1. Abra um NOVO terminal. Não feche este.'));
    console.log(chalk.yellow('2. No novo terminal, execute o seguinte comando:'));
    console.log(chalk.bold.white('   gcloud auth application-default login'));
    console.log(chalk.yellow('3. Siga as instruções no navegador para fazer o login e autorizar o acesso.'));
    console.log(chalk.yellow('4. Após a conclusão, volte para este terminal.'));

    await inquirer.prompt([
        {
            type: 'input',
            name: 'continue',
            message: 'Pressione Enter aqui quando tiver concluído a autenticação no outro terminal...',
        },
    ]);

    try {
        console.log(chalk.blue('Verificando status da autenticação...'));
        const auth = new google.auth.GoogleAuth({
            scopes: OAUTH_SCOPES,
        });
        const client = await auth.getClient();
        console.log(chalk.green('Autenticação bem-sucedida!'));
        return client;
    } catch (error) {
        console.error(chalk.red('Falha na autenticação. Verifique se o processo foi concluído corretamente no outro terminal.'));
        console.error(chalk.cyan('Consulte o arquivo `setup-gcp.log` para mais detalhes.'));
        throw error;
    }
}

async function selectOrCreateProject(authClient) {
    const resourceManager = google.cloudresourcemanager('v1');

    console.log(chalk.blue('Buscando seus projetos existentes no Google Cloud...'));
    const { data: { projects } } = await resourceManager.projects.list({ auth: authClient });

    const choices = [
        new inquirer.Separator(),
        { name: 'Criar um novo projeto', value: 'CREATE_NEW' },
        new inquirer.Separator(),
        ...(projects ? projects.map(p => ({ name: `${p.name} (${p.projectId})`, value: p.projectId })) : [])
    ];

    const { projectId } = await inquirer.prompt([
        {
            type: 'list',
            name: 'projectId',
            message: 'Selecione um projeto do Google Cloud ou crie um novo:',
            choices: choices,
            pageSize: 15,
        },
    ]);

    if (projectId === 'CREATE_NEW') {
        const { newProjectId } = await inquirer.prompt([
            {
                type: 'input',
                name: 'newProjectId',
                message: 'Digite um ID único para o novo projeto (ex: exa-shield-app):',
                validate: input => !!input,
            }
        ]);

        console.log(chalk.blue(`Criando o projeto "${newProjectId}"...`));
        await resourceManager.projects.create({
            requestBody: { projectId: newProjectId, name: `${newProjectId} App` },
            auth: authClient,
        });
        console.log(chalk.green('Projeto criado com sucesso!'));
        return newProjectId;
    }

    return projectId;
}

async function enableAPIs(projectId) {
    console.log(chalk.blue('Ativando as APIs necessárias... Isso pode levar alguns minutos.'));

    for (const api of REQUIRED_APIS) {
        try {
            await executeCommand(`gcloud services enable ${api} --project=${projectId}`);
            console.log(chalk.green(`- API ${api} ativada com sucesso.`));
        } catch(e) {
            console.log(chalk.yellow(`- API ${api} já estava ativada ou falhou ao ativar. Verifique os logs.`));
            log(`Falha ao ativar a API ${api}: ${e.message}`);
        }
    }
}

async function deployFirestoreIndexes(projectId) {
    console.log(chalk.blue('Criando os índices do Firestore para otimizar as consultas...'));
    const indexFilePath = path.join(__dirname, 'backend', 'firestore.indexes.json');
    try {
        await executeCommand(`gcloud firestore indexes composite create --project=${projectId} --database='(default)' ${indexFilePath}`);
        console.log(chalk.green('Índices do Firestore criados com sucesso!'));
    } catch (error) {
        if (error.message.includes('already exists')) {
            console.log(chalk.yellow('Os índices do Firestore já existem.'));
        } else {
            console.error(chalk.red('Falha ao criar os índices do Firestore.'), error.message);
            console.log(chalk.yellow('Você pode precisar criar o índice manualmente no console do Firebase.'));
        }
    }
}

async function createFirestoreDatabase(projectId) {
    console.log(chalk.blue('Configurando o banco de dados Firestore...'));

    const { location } = await inquirer.prompt([
        {
            type: 'list',
            name: 'location',
            message: 'Selecione a região para o seu banco de dados Firestore:',
            choices: [
                'nam5 (United States)',
                'eur3 (Europe)',
                'southamerica-east1 (São Paulo, Brazil)',
                'asia-south1 (Mumbai, India)'
            ],
            default: 'southamerica-east1 (São Paulo, Brazil)',
        },
    ]);

    try {
        await executeCommand(`gcloud firestore databases create --project=${projectId} --location=${location.split(' ')[0]} --type=firestore-native`);
        console.log(chalk.green('Banco de dados Firestore criado com sucesso!'));
    } catch(error) {
        if(error.message.includes('already exists')) {
             console.log(chalk.yellow('Banco de dados Firestore já existe neste projeto.'));
        } else {
            console.error(chalk.red('Falha ao criar o banco de dados Firestore.'), error.message);
            throw error;
        }
    }
}

async function createOAuthCredentials(projectId, authClient) {
    console.log(chalk.blue('Criando as credenciais de acesso OAuth 2.0...'));
    const iap = google.iap({ version: 'v1', auth: authClient });
    const redirectUri = 'http://localhost:3001/api/auth/google/callback';

    try {
        const { billingId } = await inquirer.prompt([
            {
                type: 'input',
                name: 'billingId',
                message: 'Digite o ID da sua conta de faturamento do Google Cloud:',
                validate: input => !!input,
            }
        ]);
        await executeCommand(`gcloud billing projects link ${projectId} --billing-account=${billingId}`);
    } catch (e) {
         console.log(chalk.yellow('O faturamento já parece estar configurado. Pulando esta etapa.'));
    }

    // Create or get the OAuth Consent Screen (brand)
    let brandName;
    try {
        console.log(chalk.blue('Criando a tela de consentimento OAuth...'));
        const supportEmail = await executeCommand('gcloud config get-value account');
        const { data: newBrand } = await iap.projects.brands.create({
            parent: `projects/${projectId}`,
            requestBody: {
                supportEmail: supportEmail.trim(),
                applicationTitle: 'EXA Shield',
            },
        });
        brandName = newBrand.name;
        console.log(chalk.green('Tela de consentimento criada com sucesso.'));
    } catch (error) {
        if (error.code === 409) { // 409 Conflict means it already exists
            console.log(chalk.yellow('A tela de consentimento já existe, buscando...'));
            const { data: { brands } } = await iap.projects.brands.list({
                parent: `projects/${projectId}`,
            });
            if (brands && brands.length > 0) {
                brandName = brands[0].name;
            } else {
                 throw new Error('Falha: A tela de consentimento existe mas não foi encontrada.');
            }
        } else {
            console.error(chalk.red('Falha ao criar ou buscar a tela de consentimento.'), error.message);
            throw error;
        }
    }

    if (!brandName) {
        throw new Error('Não foi possível determinar o nome da tela de consentimento (brand).');
    }

    console.log(chalk.blue('Criando o cliente OAuth...'));
    const { data } = await iap.projects.brands.identityAwareProxyClients.create({
        parent: brandName, // Use the dynamically retrieved brand name
        requestBody: {
            displayName: 'EXA Shield Web Client'
        }
    });

    return { clientId: data.name.split('/')[3], clientSecret: data.secret, redirectUri };
}

async function createApiKey(projectId) {
    console.log(chalk.blue('Gerando a chave de API para o Gemini...'));
    try {
        const result = await executeCommand(`gcloud alpha services api-keys create --project=${projectId} --display-name="Gemini API Key"`);
        const apiKey = result.substring(result.indexOf('key:') + 4).trim();
        console.log(chalk.green('Chave de API gerada com sucesso.'));
        return apiKey;
    } catch (error) {
        console.error(chalk.red('Falha ao criar a chave de API.'), error);
        throw error;
    }
}

async function main() {
    log('---=== Iniciando o Assistente de Configuração do EXA Shield ===---');
    console.log(chalk.bold.yellow('---=== 🛡️  Assistente de Configuração do EXA Shield  ===---'));
    console.log(chalk.gray('Um log detalhado será salvo em `setup-gcp.log`'));

    try {
        const authClient = await getAuthenticatedClient();
        const projectId = await selectOrCreateProject(authClient);

        await enableAPIs(projectId);

        console.log(chalk.blue('\nAguardando 60 segundos para que os serviços do Google Cloud sejam provisionados...'));
        await new Promise(resolve => setTimeout(resolve, 60000));

        await createFirestoreDatabase(projectId);
        await deployFirestoreIndexes(projectId);

        const { clientId, clientSecret, redirectUri } = await createOAuthCredentials(projectId, authClient);
        const apiKey = await createApiKey(projectId);

        const envContent = `
# Credenciais geradas pelo assistente de configuração do EXA Shield
GCP_PROJECT_ID=${projectId}
GOOGLE_CLIENT_ID=${clientId}
GOOGLE_CLIENT_SECRET=${clientSecret}
API_KEY=${apiKey}
REDIRECT_URI=${redirectUri}

# Chaves de segurança para os cookies da sessão
COOKIE_SECRET_KEY_1=${randomBytes(32).toString('hex')}
COOKIE_SECRET_KEY_2=${randomBytes(32).toString('hex')}
`.trim();

        await writeFile(path.join(__dirname, '.env'), envContent);

        console.log(chalk.bold.green('\n🎉 Configuração concluída com sucesso! 🎉'));
        console.log(chalk.cyan('O arquivo `.env` foi criado em `.env` com suas credenciais.'));
        console.log(chalk.yellow('\nPara iniciar a aplicação, execute:'));
        console.log(chalk.white('npm install && npm run dev'));

    } catch (error) {
        log(`ERRO FATAL: ${error.stack || error}`);
        console.error(chalk.red.bold('\nOcorreu um erro durante a configuração:'));
        console.error(error.message);
        console.error(chalk.cyan('Consulte o arquivo `setup-gcp.log` para mais detalhes.'));
        process.exit(1);
    } finally {
        logStream.end();
    }
}

main();
