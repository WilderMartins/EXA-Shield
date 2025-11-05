const express = require('express');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const { Firestore } = require('@google-cloud/firestore');
const cookieSession = require('cookie-session');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

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
    maxAge: 24 * 60 * 60 * 1000 * 30, // 30 dias
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
);

app.use(express.static(path.join(__dirname, '..')));

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


// --- Funções de Análise (Refatorado) ---

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

    if (allEvents.length === 0) return [];

    return allEvents.map(item => ({
        actor: item.actor.email,
        time: item.id.time,
        application: item.id.applicationName,
        eventName: item.events[0].name,
        details: item.events[0].parameters.map(p => `${p.name}: ${p.value || p.multiValue}`).join('; ')
    }));
}

async function generateAlertsFromLogs(logs, keywords) {
    const prompt = `
        Você é o EXA Shield, um analista de segurança de IA de elite. Sua missão é analisar logs do Google Workspace para identificar ameaças internas e vazamento de dados, focando nas palavras-chave de risco: ${keywords.join(', ')}.

        Analise os logs abaixo. Para cada ameaça identificada, gere um alerta detalhado. Se nenhuma ameaça for encontrada, retorne um array vazio.

        Logs para Análise:
        ${JSON.stringify(logs.slice(0, 150), null, 2)}
    `;
    
    const responseSchema = {
        type: 'ARRAY',
        items: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING', description: 'Um título curto e impactante para o alerta.' },
                summary: { type: 'STRING', description: 'Um resumo de uma frase explicando a ameaça.' },
                severity: { type: 'STRING', description: "A severidade do risco ('Baixa', 'Média', ou 'Alta')." },
                user: { type: 'STRING', description: 'O e-mail do usuário envolvido.' },
                timestamp: { type: 'STRING', description: 'O timestamp ISO 8601 do evento principal.' },
                reasoning: { type: 'STRING', description: 'Uma explicação detalhada em markdown do PORQUÊ esta atividade é considerada uma ameaça.' },
                evidence: {
                    type: 'ARRAY',
                    description: 'Um array contendo os objetos de log exatos (do input) que sustentam esta conclusão.',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            actor: { type: 'STRING' }, time: { type: 'STRING' },
                            application: { type: 'STRING' }, eventName: { type: 'STRING' },
                            details: { type: 'STRING' }
                        }
                    }
                }
            },
            required: ['title', 'summary', 'severity', 'user', 'timestamp', 'reasoning', 'evidence']
        }
    };

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema,
            },
        });
        
        const alertsText = response.text.trim();
        return JSON.parse(alertsText) || [];
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
    console.log(`[${new Date().toISOString()}] Iniciando análise para o usuário: ${userId}`);
    const settingsRef = firestore.collection('settings').doc(userId);
    
    try {
        await settingsRef.update({ isAnalysisRunning: true, lastRunTimestamp: new Date().toISOString() });
        
        const settingsDoc = await settingsRef.get();
        if (!settingsDoc.exists) throw new Error('Configurações não encontradas.');
        const settings = settingsDoc.data();

        const client = await getAuthenticatedClient(userId);
        const simplifiedLogs = await fetchLogsFromGoogle(client, settings.dataSources);

        if (simplifiedLogs.length === 0) {
            console.log("Nenhum evento encontrado para análise.");
            return;
        }

        const alerts = await generateAlertsFromLogs(simplifiedLogs, settings.keywords);
        await storeAlertsInFirestore(alerts, userId);

    } catch (error) {
        console.error('Erro durante a execução da análise aprimorada:', error);
    } finally {
        await settingsRef.update({ isAnalysisRunning: false });
        console.log(`[${new Date().toISOString()}] Análise aprimorada finalizada para: ${userId}`);
    }
}


// --- Endpoints da API ---

app.get('/api/auth/google', (req, res) => {
  try {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/admin.reports.audit.readonly',
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
        schedule: 'disabled',
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

### EXEMPLOS DE SAÍDA

**Exemplo 1: Vazamento de Dados**
\`\`\`json
[
  {
    "title": "Exfiltração de Dados Potencial para E-mail Pessoal",
    "summary": "O usuário alterou a visibilidade de um documento sensível para 'público' e depois o compartilhou com um endereço de e-mail externo.",
    "severity": "Alta",
    "user": "usuario.insatisfeito@empresa.com",
    "timestamp": "2024-10-27T14:10:00Z",
    "reasoning": "O usuário \`usuario.insatisfeito@empresa.com\` realizou uma sequência de ações altamente suspeitas. Primeiro, o documento 'Plano Estratégico Q4' teve sua visibilidade alterada de 'privado' para 'qualquer um com o link'. Imediatamente depois, o mesmo usuário compartilhou este documento com um endereço de e-mail pessoal (\`fulano.pessoal@gmail.com\`). Esta sequência indica uma forte probabilidade de exfiltração intencional de dados confidenciais.",
    "evidence": [
      {
        "actor": "usuario.insatisfeito@empresa.com",
        "time": "2024-10-27T14:09:30Z",
        "application": "drive",
        "eventName": "change_document_visibility",
        "details": "item_name: Plano Estratégico Q4; old_visibility: private; new_visibility: anyone_with_link"
      },
      {
        "actor": "usuario.insatisfeito@empresa.com",
        "time": "2024-10-27T14:10:00Z",
        "application": "drive",
        "eventName": "share_document",
        "details": "item_name: Plano Estratégico Q4; target_user: fulano.pessoal@gmail.com"
      }
    ]
  }
]
\`\`\`
**Exemplo 2: Tentativa de Acesso Indevido**
\`\`\`json
[
  {
    "title": "Tentativa de Acesso Suspeita de Localização Incomum",
    "summary": "Múltiplas tentativas de login falhas originadas da Rússia foram seguidas por um login bem-sucedido e download de múltiplos arquivos.",
    "severity": "Média",
    "user": "alvo.comprometido@empresa.com",
    "timestamp": "2024-10-27T15:25:10Z",
    "reasoning": "A conta do usuário \`alvo.comprometido@empresa.com\` registrou 5 tentativas de login mal-sucedidas de um endereço de IP localizado na Rússia. Logo em seguida, um login bem-sucedido ocorreu a partir do mesmo IP, que foi imediatamente seguido por uma ação de download em massa de 50 arquivos do Google Drive. Este padrão sugere que a conta pode ter sido comprometida e está sendo usada para roubo de informações.",
    "evidence": [
      {
        "actor": "alvo.comprometido@empresa.com",
        "time": "2024-10-27T15:20:00Z",
        "application": "login",
        "eventName": "login_failure",
        "details": "ip_address: 91.207.175.82; reason: incorrect_password"
      },
      {
        "actor": "alvo.comprometido@empresa.com",
        "time": "2024-10-27T15:25:00Z",
        "application": "login",
        "eventName": "login_success",
        "details": "ip_address: 91.207.175.82"
      },
      {
        "actor": "alvo.comprometido@empresa.com",
        "time": "2024-10-27T15:25:10Z",
        "application": "drive",
        "eventName": "download_multiple_files",
        "details": "num_files: 50"
      }
    ]
  }
]
\`\`\`
        `.trim(),
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
    const settingsRef = firestore.collection('settings').doc(req.session.userId);
    await settingsRef.update(req.body);
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
    });
} else {
    console.error('ERRO FATAL: As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e API_KEY devem ser definidas.');
    process.exit(1);
}