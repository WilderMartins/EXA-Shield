import express from 'express';
import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import { Firestore } from '@google-cloud/firestore';
import cookieSession from 'cookie-session';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID,
});
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
                if (error.code === 403) {
                    console.error(
                        `ALERTA DE PERMISSÃO: A conta não tem privilégios de administrador ` +
                        `suficientes para buscar logs de toda a organização ('userKey: "all"'). ` +
                        `Certifique-se de que o usuário autenticado (${client.credentials.email_address}) ` +
                        `tenha um papel de administrador com permissão para "Relatórios". ` +
                        `Fonte do erro: ${sourceName}.`
                    );
                } else {
                    console.error(`Erro ao buscar logs de ${sourceName}:`, error.message);
                }
                return [];
            }
        });
    
    const results = await Promise.all(fetchPromises);
    allEvents = results.flat();

    if (allEvents.length === 0) return [];

    return allEvents
      .map(item => {
        // Verificação defensiva: Garante que o item tenha a estrutura esperada.
        if (!item || !item.events || item.events.length === 0) {
          return null;
        }

        const event = item.events[0];
        const parameters = event.parameters || [];

        return {
          actor: item.actor?.email || 'N/A',
          time: item.id?.time || 'N/A',
          application: item.id?.applicationName || 'N/A',
          eventName: event.name || 'N/A',
          details: parameters.map(p => `${p.name}: ${p.value || p.multiValue || ''}`).join('; ')
        };
      })
      .filter(Boolean); // Remove quaisquer entradas nulas resultantes da verificação defensiva.
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
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('As credenciais do Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) não foram encontradas no ambiente.');
    return res.status(500).json({
      message: 'Erro de configuração no servidor: As credenciais do Google não foram encontradas. Verifique o arquivo backend/.env e reinicie o servidor.'
    });
  }
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
    res.status(500).json({ message: 'Erro interno ao gerar a URL de autenticação do Google.' });
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

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Erro no callback do Google Auth:', error);
    res.status(500).send('Falha na autenticação.');
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ message: 'Logout bem-sucedido.' });
});

app.get('/api/auth/status', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ isAuthenticated: false });
  }
  try {
    const userDoc = await firestore.collection('users').doc(req.session.userId).get();
    if (!userDoc.exists) {
      req.session = null; // Limpa a sessão inválida
      return res.json({ isAuthenticated: false });
    }
    res.json({ isAuthenticated: true, user: userDoc.data().profile });
  } catch (error) {
    console.error('Erro ao verificar status de autenticação:', error);
    res.status(500).json({ isAuthenticated: false, message: 'Erro interno no servidor.' });
  }
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
