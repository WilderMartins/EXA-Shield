require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { Firestore } = require('@google-cloud/firestore');
const cookieSession = require('cookie-session');
const path = require('path');
const Mbox = require('node-mbox');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3002;

// --- Configuração ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const API_KEY = process.env.API_KEY;
const COOKIE_SECRET_KEY_1 = process.env.COOKIE_SECRET_KEY_1 || 'super-secret-key-1';
const COOKIE_SECRET_KEY_2 = process.env.COOKIE_SECRET_KEY_2 || 'super-secret-key-2';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback';

// --- Inicialização dos Clientes ---
const firestore = new Firestore();
const ai = new GoogleGenAI({ apiKey: API_KEY });
const scheduledTasks = new Map();

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// --- Middleware ---
app.use(express.json());
app.use(
  cookieSession({
    name: 'exa-shield-session',
    keys: [COOKIE_SECRET_KEY_1, COOKIE_SECRET_KEY_2],
    maxAge: 24 * 60 * 60 * 1000 * 30,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
);

app.use(express.static(path.join(__dirname, '..')));

// --- Funções de Agendamento ---

function updateScheduler(userId, schedule) {
    if (scheduledTasks.has(userId)) {
        scheduledTasks.get(userId).stop();
        scheduledTasks.delete(userId);
    }

    if (schedule && schedule.type !== 'disabled' && cron.validate(schedule.cron)) {
        const task = cron.schedule(schedule.cron, () => {
            console.log(`[Agendador] Executando análise agendada para o usuário: ${userId}`);
            runAnalysis(userId);
        }, {
            timezone: "America/Sao_Paulo"
        });
        scheduledTasks.set(userId, task);
        console.log(`[Agendador] Análise agendada para ${userId} com a expressão: ${schedule.cron}`);
    } else {
        console.log(`[Agendador] Agendamento desativado ou inválido para o usuário: ${userId}`);
    }
}

async function initializeSchedulers() {
    console.log('[Agendador] Inicializando agendadores para todos os usuários...');
    const settingsSnapshot = await firestore.collection('settings').get();
    settingsSnapshot.forEach(doc => {
        const userId = doc.id;
        const settings = doc.data();
        if (settings.schedule) {
            updateScheduler(userId, settings.schedule);
        }
    });
    console.log('[Agendador] Agendadores inicializados.');
}

// --- Funções Auxiliares de Autenticação ---

const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Não autorizado.' });
  }
};

async function getAuthenticatedClient(userId) {
  const userDoc = await firestore.collection('users').doc(userId).get();
  if (!userDoc.exists || !userDoc.data().tokens) {
    throw new Error('Tokens não encontrados para o usuário.');
  }
  const tokens = userDoc.data().tokens;
  const client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials(tokens);
  return client;
}

// --- Funções de Análise ---

async function fetchLogsFromGoogle(client, dataSources) {
    const admin = google.admin({ version: 'reports_v1', auth: client });
    let allEvents = [];
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const fetchPromises = Object.entries(dataSources)
        .filter(([, isEnabled]) => isEnabled)
        .map(async ([sourceName]) => {
            try {
                const res = await admin.activities.list({
                    userKey: 'all',
                    applicationName: sourceName,
                    startTime: oneDayAgo,
                });
                return res.data.items || [];
            } catch (error) {
                console.error(`Erro ao buscar logs de ${sourceName}:`, error.message);
                return [];
            }
        });

    const results = await Promise.all(fetchPromises);
    allEvents = results.flat();

    if (!allEvents || allEvents.length === 0) return [];

    return allEvents.map(item => ({
        actor: item.actor.email,
        time: item.id.time,
        application: item.id.applicationName,
        eventName: item.events[0].name,
        details: item.events[0].parameters ? item.events[0].parameters.map(p => `${p.name}: ${p.value || p.multiValue}`).join('; ') : ''
    }));
}

async function parseMboxStream(stream) {
    return new Promise((resolve, reject) => {
        const mbox = new Mbox(stream, { stream: true });
        const logs = [];

        mbox.on('message', async (msgStream) => {
            try {
                const parsed = await simpleParser(msgStream);
                logs.push({
                    actor: parsed.from ? parsed.from.text : 'N/A',
                    time: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                    application: 'vault_chat_or_gmail',
                    eventName: parsed.subject || 'E-mail/Chat',
                    details: parsed.text || ''
                });
            } catch (err) {
                console.error('Erro ao analisar a mensagem de e-mail:', err);
            }
        });

        mbox.on('end', () => resolve(logs));
        mbox.on('error', (err) => reject(err));
    });
}

async function fetchLogsFromVault(client, matterId) {
    console.log(`[Vault] Iniciando coleta para o matter ID: ${matterId}`);
    if (!matterId) {
        console.log("[Vault] ID da matéria não fornecido. Pulando.");
        return [];
    }

    const vault = google.vault({ version: 'v1', auth: client });
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const exportOptions = { mboxExportOptions: { exportFormat: 'MBOX' } };
    const query = {
        corpus: 'MAIL',
        dataScope: 'ALL_DATA',
        searchMethod: 'ENTIRE_ORG',
        startTime: thirtyDaysAgo.toISOString(),
        endTime: new Date().toISOString(),
        timeZone: 'UTC',
    };

    try {
        console.log('[Vault] Criando a exportação...');
        const exportRequest = await vault.matters.exports.create({
            matterId: matterId,
            requestBody: {
                name: `Exportação EXA Shield - ${new Date().toISOString()}`,
                query,
                exportOptions
            },
        });

        const exportId = exportRequest.data.id;
        console.log(`[Vault] Exportação criada com ID: ${exportId}. Aguardando conclusão...`);

        let exportStatus;
        let isDone = false;
        while (!isDone) {
            await new Promise(resolve => setTimeout(resolve, 15000));
            const statusResponse = await vault.operations.get({ name: `operations/${exportId}` });
            isDone = statusResponse.data.done;
            if (isDone) {
                exportStatus = statusResponse.data;
            } else {
                 console.log(`[Vault] Status da exportação: IN_PROGRESS...`);
            }
        }

        if (exportStatus.response?.['@type'].includes('Export')) {
            const downloadDetails = exportStatus.response.cloudStorageSink;
            console.log(`[Vault] Exportação concluída. Baixando ${downloadDetails.files.length} arquivos...`);

            let allLogs = [];
            for (const file of downloadDetails.files) {
                 const downloadUrl = `https://storage.googleapis.com/download/storage/v1/b/${file.bucketName}/o/${file.objectName}?alt=media`;
                 const response = await axios.get(downloadUrl, {
                    headers: { 'Authorization': `Bearer ${(await client.getAccessToken()).token}` },
                    responseType: 'stream'
                 });
                 const parsedLogs = await parseMboxStream(response.data);
                 allLogs = allLogs.concat(parsedLogs);
            }
            console.log(`[Vault] Coleta concluída. ${allLogs.length} logs analisados.`);
            return allLogs;

        } else {
            console.error('[Vault] Erro na exportação:', exportStatus.error);
            throw new Error('Falha ao obter os detalhes da exportação do Vault.');
        }

    } catch (error) {
        console.error('Erro durante o processo do Vault:', error.message || error);
        return [];
    }
}

async function generateAlertsFromLogs(logs, keywords, prompt) {
    const model = ai.getGenerativeModel({
        model: "gemini-pro",
        generationConfig: {
            responseMimeType: "application/json",
        },
    });

    const fullPrompt = `${prompt}\n\nPalavras-chave de Risco para focar: ${keywords.join(', ')}\n\nLogs para Análise:\n${JSON.stringify(logs, null, 2)}`;

    try {
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();
        return JSON.parse(text) || [];
    } catch (error) {
        console.error("Erro ao gerar alertas com a IA:", error);
        return [];
    }
}

async function storeAlertsInFirestore(alerts, userId) {
    if (!Array.isArray(alerts) || alerts.length === 0) return;

    const batch = firestore.batch();
    alerts.forEach(alert => {
        const alertRef = firestore.collection('alerts').doc();
        const alertData = {
          ...alert,
          evidence: JSON.stringify(alert.evidence || []),
          userId,
          createdAt: new Date().toISOString()
        };
        batch.set(alertRef, alertData);
    });
    await batch.commit();
    console.log(`${alerts.length} novos alertas detalhados foram gerados para ${userId}.`);
}


async function runAnalysis(userId) {
    console.log(`[Análise] Iniciando para o usuário: ${userId}`);
    const settingsRef = firestore.collection('settings').doc(userId);

    try {
        await settingsRef.update({ isAnalysisRunning: true, lastRunTimestamp: new Date().toISOString() });

        const settingsDoc = await settingsRef.get();
        if (!settingsDoc.exists) throw new Error('Configurações não encontradas.');
        const settings = settingsDoc.data();

        const client = await getAuthenticatedClient(userId);

        const adminLogs = await fetchLogsFromGoogle(client, settings.dataSources);

        let vaultLogs = [];
        if (settings.vaultEnabled) {
            vaultLogs = await fetchLogsFromVault(client, settings.vaultMatterId);
        }

        const allLogs = [...adminLogs, ...vaultLogs];

        if (allLogs.length === 0) {
            console.log("[Análise] Nenhum evento encontrado.");
            await settingsRef.update({ isAnalysisRunning: false });
            return;
        }

        console.log(`[Filtro] ${allLogs.length} logs totais. Filtrando com ${settings.keywords.length} palavras-chave.`);

        const filteredLogs = allLogs.filter(log => {
            const searchText = `${log.eventName} ${log.details}`.toLowerCase();
            return settings.keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
        });

        if (filteredLogs.length === 0) {
            console.log("[Filtro] Nenhum log correspondeu. Análise concluída sem chamar a IA.");
            await settingsRef.update({ isAnalysisRunning: false });
            return;
        }

        console.log(`[Filtro] ${filteredLogs.length} logs enviados para a IA.`);

        const alerts = await generateAlertsFromLogs(filteredLogs, settings.keywords, settings.aiPrompt);
        await storeAlertsInFirestore(alerts, userId);

    } catch (error) {
        console.error('Erro durante a análise:', error);
    } finally {
        await settingsRef.update({ isAnalysisRunning: false });
        console.log(`[Análise] Finalizada para: ${userId}`);
    }
}

// --- Endpoints da API ---

app.get('/api/auth/google', (req, res) => {
  try {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/admin.reports.audit.readonly',
      'https://www.googleapis.com/auth/ediscovery',
    ];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
    res.json({ authUrl });
  } catch (error) {
    console.error('Erro ao gerar URL de autenticação:', error);
    res.status(500).json({ message: 'Erro ao gerar URL de autenticação.' });
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const people = google.people({ version: 'v1', auth: oauth2Client });
    const profile = await people.people.get({
      resourceName: 'people/me',
      personFields: 'names,emailAddresses,photos',
    });

    const userId = profile.data.emailAddresses[0].value;
    const userData = {
      name: profile.data.names[0].displayName,
      email: userId,
      picture: profile.data.photos[0].url,
    };

    await firestore.collection('users').doc(userId).set({
        profile: userData,
        tokens: tokens,
    }, { merge: true });

    req.session.userId = userId;

    res.redirect('/');
  } catch (error) {
    console.error('Erro no callback do Google Auth:', error);
    res.status(500).send('Falha na autenticação.');
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.status(204).send();
});


app.get('/api/auth/status', (req, res) => {
  res.json({ hasToken: !!req.session.userId });
});

app.get('/api/user', isAuthenticated, async (req, res) => {
    try {
        const userDoc = await firestore.collection('users').doc(req.session.userId).get();
        if(!userDoc.exists) return res.status(404).json({ message: 'Usuário não encontrado.' });
        res.json(userDoc.data().profile);
    } catch(error) {
        res.status(500).json({ message: error.message });
    }
});

app.get('/api/settings', isAuthenticated, async (req, res) => {
  try {
    const settingsRef = firestore.collection('settings').doc(req.session.userId);
    const doc = await settingsRef.get();
    if (!doc.exists) {
      const defaultSettings = {
        dataSources: { drive: true, login: true, chat: false },
        keywords: ['confidencial', 'privado', 'senha', 'salário'],
        isAnalysisRunning: false,
        lastRunTimestamp: null,
        schedule: { type: 'disabled', cron: '', time: '02:00', minute: '0' },
        vaultEnabled: false,
        vaultMatterId: '',
        aiPrompt: `### FUNÇÃO E OBJETIVO
Você é o EXA Shield, um especialista sênior em contra-inteligência e segurança corporativa. Sua função principal é analisar logs estruturados do Google Workspace para identificar proativamente ameaças internas. Seu foco é a detecção de riscos como insatisfação de funcionários, conflito de interesses, fraude, e vazamento de dados, com a máxima precisão para minimizar falsos positivos. Você deve basear-se estritamente nos logs fornecidos, correlacionando eventos para identificar padrões de risco.

### DIRETRIZES DE ANÁLISE
Analise os logs buscando por indicadores das seguintes categorias de risco. Avalie o contexto cuidadosamente. Uma única ação pode ser inofensiva, mas uma sequência de ações pode indicar uma ameaça.

**Categorias de Risco e Indicadores Chave:**

*   **1. Risco Trabalhista/Insatisfação:**
    *   **Descrição:** Comentários negativos sobre a empresa, gestão, ou condições de trabalho; menções a procurar outros empregos ou ações legais.
    *   **Indicadores em Logs:** Ações como \`delete_document\` ou \`download_multiple_files\` por um usuário que também expressou insatisfação (se os logs de comunicação estiverem disponíveis). Um pico de atividade de download de arquivos por um funcionário em vias de sair.
    *   **Palavras-chave (para logs de comunicação):** \`odeio, péssimo, injusto, processo trabalhista, procurando outro emprego, vou pedir demissão, empresa de merda, entrevista, proposta de emprego\`.

*   **2. Risco de Segunda Jornada (Conflito de Interesses):**
    *   **Descrição:** Atividades que sugiram trabalho para concorrentes, uso de recursos da empresa para projetos paralelos ou ociosidade deliberada.
    *   **Indicadores em Logs:** Compartilhar arquivos (\`share_document\`) com domínios externos não reconhecidos, especialmente se os nomes dos arquivos contiverem termos como "freelance", "projeto pessoal" ou nomes de clientes externos.

*   **3. Risco Comportamental (Assédio/Linguagem Inapropriada):**
    *   **Descrição:** Uso de linguagem hostil, discriminatória ou assédio em plataformas de comunicação corporativas.
    *   **Indicadores em Logs:** Análise de conteúdo em logs de \`google_chat\` que contenham linguagem ofensiva ou direcionada a indivíduos específicos.

*   **4. Risco de Segurança da Informação (Vazamento/Acesso Indevido):**
    *   **Descrição:** Tentativas de copiar, mover, ou exfiltrar dados sensíveis da empresa para locais não autorizados.
    *   **Indicadores em Logs:** Sequências de ações como \`download_multiple_files\` seguido de \`upload_to_personal_drive\`, ou \`change_document_visibility\` de "restrito" para "público". Concessão de acesso (\`grant_access\`) a emails pessoais. Tentativas de login falhas (\`login_failure\`) de locais incomuns, seguidas por um login bem-sucedido (\`login_success\`) e alta atividade de download.
    *   **Palavras-chave (em nomes de arquivos/eventos):** \`exportar contatos, copiar base de dados, plano de negócios, código-fonte, enviar para email pessoal, backup de senhas, apagar logs, desativar monitoramento\`.

*   **5. Risco de Fraude e Ética:**
    *   **Descrição:** Ações que sugiram manipulação de dados financeiros, falsificação de informações ou violação do código de ética.
    *   **Indicadores em Logs:** Alteração de permissões em planilhas financeiras (\`change_document_permissions\` em arquivos com nomes como "Relatório de Despesas", "Comissões"), seguida por edições (\`edit_document\`) por usuários não autorizados.

*   **6. Risco Criminal/Físico:**
    *   **Descrição:** Ameaças diretas à integridade física de colaboradores ou à propriedade da empresa.
    *   **Indicadores em Logs:** Análise de conteúdo em logs de \`google_chat\` contendo ameaças explícitas ou menções a endereços pessoais de executivos.

### FORMATO DA RESPOSTA
Sua resposta DEVE ser um array de objetos JSON, seguindo estritamente este formato. Se nenhuma ameaça for encontrada, retorne um array vazio \`[]\`.

\`\`\`json
[
  {
    "title": "string (Um título curto e impactante para o alerta)",
    "summary": "string (Um resumo de uma frase explicando a ameaça)",
    "severity": "string ('Baixa', 'Média', ou 'Alta')",
    "user": "string (O e-mail do usuário/ator principal envolvido)",
    "timestamp": "string (O timestamp ISO 8601 do evento principal ou mais recente da ameaça)",
    "reasoning": "string (Uma explicação detalhada em markdown do PORQUÊ esta sequência de atividades é considerada uma ameaça, correlacionando os eventos)",
    "evidence": [
      {
        "actor": "string",
        "time": "string",
        "application": "string",
        "eventName": "string",
        "details": "string"
      }
    ]
  }
]
\`\`\`

### CONTEÚDO PARA ANÁLISE
A seguir, uma lista de logs de eventos do Google Workspace em formato JSON. Cada objeto representa uma ação executada por um usuário. Analise estes logs para encontrar as ameaças.
`,
        apiKey: '',
        notifications: {
          ses: {
            enabled: false,
            fromAddress: '',
            toAddress: '',
          },
        },
      };
      await settingsRef.set(defaultSettings);
      res.json(defaultSettings);
    } else {
      res.json(doc.data());
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/settings', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    const settingsRef = firestore.collection('settings').doc(userId);
    const newSettings = req.body;

    await settingsRef.update(newSettings);

    if (newSettings.schedule) {
        updateScheduler(userId, newSettings.schedule);
    }

    res.status(200).json({ message: 'Configurações salvas.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/alerts', isAuthenticated, async (req, res) => {
    try {
        const snapshot = await firestore.collection('alerts')
            .where('userId', '==', req.session.userId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const alerts = snapshot.docs.map(doc => {
          const data = doc.data();
          try {
            data.evidence = JSON.parse(data.evidence || '[]');
          } catch(e) {
            data.evidence = [];
          }
          return { id: doc.id, ...data };
        });
        res.json({ alerts });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

app.post('/api/run-analysis', isAuthenticated, (req, res) => {
    runAnalysis(req.session.userId).catch(err => {
        console.error("Falha na execução da análise em segundo plano:", err);
    });
    res.status(202).json({ message: 'A análise foi iniciada.' });
});

app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- Iniciar Servidor ---
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && API_KEY) {
    app.listen(port, () => {
      console.log(`Backend do EXA Shield rodando na porta ${port}`);
      initializeSchedulers();
    });
} else {
    console.error('ERRO FATAL: As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e API_KEY devem ser definidas.');
    process.exit(1);
}
