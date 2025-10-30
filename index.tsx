import React, { useState, useEffect, createContext, useContext, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

// FIX: Add global type definition for window.google to resolve TypeScript errors.
declare global {
  interface Window {
    google: any;
  }
}

// --- CONSTANTS ---
// IMPORTANTE: Substitua pelo seu próprio Client ID do Google Cloud.
// Veja o README.md para instruções de como obter um.
const GOOGLE_CLIENT_ID = "DEMO_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const WORKSPACE_SCOPES = 'openid email profile https://www.googleapis.com/auth/chat.messages.readonly';
const VAULT_SCOPES = 'openid email profile https://www.googleapis.com/auth/ediscovery.readonly';
const DRIVE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.activity.readonly';
const GMAIL_SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.readonly';


// --- TYPE DEFINITIONS ---
type Alert = {
  category: 'Vazamento de Dados' | 'Risco de Segurança' | 'Ameaça Interna' | 'Análise de Sentimento' | 'Análise de Retenção' | 'Risco de Perda' | 'Phishing & Malware';
  severity: 'Baixa' | 'Média' | 'Alta';
  description: string;
  log: string;
  originalLog: any;
  timestamp: string;
  user: string;
  source: string;
};

type GoogleUser = {
    name: string;
    email: string;
    picture: string;
};

type ScanRecord = {
  id: string;
  timestamp: string;
  status: 'Sucesso' | 'Falha';
  alertsFound: number;
  error?: string;
};

const DEFAULT_LOG_ANALYSIS_PROMPT = `
Você é o EXA Shield, um assistente de IA especializado em cibersegurança e detecção de ameaças internas.
Sua tarefa é analisar os seguintes logs provenientes de {logSources}.
Concentre-se APENAS nas seguintes categorias: {enabledCategories}.

{sentimentInstructions}

Para a categoria 'Risco de Segurança' e 'Phishing & Malware', preste atenção especial a URLs. Analise e sinalize URLs que pareçam suspeitas. Considere os seguintes critérios para suspeita:
- URLs usando TLDs incomuns ou de baixo custo (ex: .xyz, .info, .top, .buzz).
- URLs encurtadas (ex: bit.ly, tinyurl) que ocultam o destino final, especialmente em contextos sensíveis.
- URLs usando HTTP em vez de HTTPS para páginas que pedem credenciais.
- URLs que imitam domínios legítimos (phishing), como 'g0ogle.com' ou 'empresa-seguranca.net'.

Além da sua análise, aqui estão os resultados de uma verificação de reputação de URL pré-analisada. Use esta informação para enriquecer sua detecção:
{reputationResults}
Se um URL for marcado como 'isMalicious: true', você DEVE criar um alerta da categoria 'Phishing & Malware' com severidade 'Alta'.

{keywordInstructions}

Para cada ameaça encontrada, determine um nível de severidade ('Baixa', 'Média', 'Alta'), forneça uma breve descrição do risco.
É crucial que você também inclua o usuário ('user') e a origem do log ('source') em cada objeto de alerta.
Responda APENAS com um array JSON de objetos, onde cada objeto representa um alerta.
O JSON deve ter a seguinte estrutura: [{ "category": "...", "severity": "...", "description": "...", "log": "...", "user": "...", "source": "..." }].
Se nenhum alerta for encontrado, retorne um array JSON vazio: [].

Aqui estão os logs para análise:
{logsToAnalyze}
`;

const DEFAULT_THREAT_INTEL_PROMPT = `
Você é um analista de cibersegurança de elite do EXA Shield. Sua tarefa é analisar o seguinte relatório de inteligência de ameaças e fornecer um resumo conciso e acionável para um administrador de TI.

O resultado deve ser um objeto JSON com a seguinte estrutura:
{
  "summary": "Um parágrafo resumindo as ameaças mais críticas do relatório.",
  "recommendations": ["Uma lista de 3 a 5 recomendações claras e práticas que o administrador pode implementar para mitigar os riscos identificados."]
}

Responda APENAS com o objeto JSON. Não inclua texto adicional.

Aqui está o relatório de inteligência de ameaças para análise:
{threatData}
`;


type Settings = {
  scanSchedule: {
    type: 'manual' | 'daily' | 'weekly';
    days: string[];
    time: string;
  };
  threatCategories: {
    dataLeakage: boolean;
    securityRisk: boolean;
    internalThreat: boolean;
    sentimentAnalysis: boolean;
    retentionAnalysis: boolean;
    churnRisk: boolean;
    phishingMalware: boolean;
  };
  notifications: {
    enabled: boolean;
    email: string;
    awsAccessKey: string;
    awsSecretKey: string;
    awsRegion: string;
  };
  integrations: {
    googleWorkspace: boolean;
    googleWorkspaceToken: string | null;
    googleWorkspaceUser: GoogleUser | null;
    chatSpaceId: string;
    googleVault: boolean;
    googleVaultToken: string | null;
    googleVaultUser: GoogleUser | null;
    googleDrive: boolean;
    googleDriveToken: string | null;
    googleDriveUser: GoogleUser | null;
    googleGmail: boolean;
    googleGmailToken: string | null;
    googleGmailUser: GoogleUser | null;
  };
  api: {
      geminiModel: 'gemini-2.5-flash' | 'gemini-2.5-pro';
  },
  sso: {
      jumpcloud: {
          enabled: boolean;
          clientId: string;
          orgUrl: string;
      }
  },
  analysis: {
      prompts: {
          logAnalysis: string;
          threatIntel: string;
      };
      keywords: string[];
  }
};

type AuthContextType = {
    user: GoogleUser | null;
    login: (user: GoogleUser) => void;
    logout: () => void;
};

type SettingsContextType = {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  defaultSettings: Settings;
};

type AlertsContextType = {
  historicalAlerts: Alert[];
  addAlerts: (newAlerts: Alert[]) => void;
  clearAlerts: () => void;
};

type ScanHistoryContextType = {
  scanHistory: ScanRecord[];
  addScanRecord: (record: Omit<ScanRecord, 'id' | 'timestamp'>) => void;
};


// --- SVG ICONS ---
const ShieldCheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path>
  </svg>
);
const LayoutDashboardIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="3" width="7" height="9"></rect><rect x="14" y="3" width="7" height="5"></rect><rect x="14" y="12" width="7" height="9"></rect><rect x="3" y="16" width="7" height="5"></rect></svg>;
const AlertTriangleIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;
const FileTextIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>;
const SettingsIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0 2l.15.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>;
const GoogleIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.35 11.1h-9.1v2.7h5.2c-.2 1.8-1.7 3-3.9 3-2.3 0-4.2-1.9-4.2-4.2s1.9-4.2 4.2-4.2c1.1 0 2.1.4 2.8 1.1l2.1-2.1C16.6 3.7 14.5 3 12.25 3c-3.9 0-7.2 3.2-7.2 7.2s3.3 7.2 7.2 7.2c4.1 0 6.9-2.8 6.9-6.9 0-.5 0-1-.2-1.5z"/></svg>;
const JumpCloudIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 0 0-3.91 19.4a10 10 0 0 0 7.82 0A10 10 0 0 0 12 2zm0 17.5a7.5 7.5 0 1 1 0-15a7.5 7.5 0 0 1 0 15z"/><path d="M12 8l-2 4h4l-2 4"/></svg>;
const ActivityIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>;
const TrendingUpIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>;
const SearchIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
const ChevronLeftIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>;
const ChevronRightIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>;
const LogOutIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;
const BrainCircuitIcon = (props: React.SVGProps<SVGSVGElement>) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M12 5a3 3 0 1 0-5.993.142"/><path d="M18 5a3 3 0 1 0-5.993.142"/><path d="M12 19a3 3 0 1 0 5.993-.142"/><path d="M6 19a3 3 0 1 0 5.993-.142"/><path d="M12 12a3 3 0 1 0-5.993.142"/><path d="M18 12a3 3 0 1 0-5.993.142"/><path d="M14.5 5.5h-5"/><path d="M14.5 18.5h-5"/><path d="M8.5 12.5v-5"/><path d="M15.5 12.5v-5"/><path d="M8.5 18.5v-5"/><path d="M15.5 18.5v-5"/><path d="m15.5 5.5 2-2"/><path d="m8.5 5.5-2-2"/><path d="m8.5 18.5-2 2"/><path d="m15.5 18.5 2 2"/></svg>;

// --- SIMULATED DATA ---
const SIMULATED_GOOGLE_CHAT_LOGS = [
  { user: 'alice', message: 'Revisando o Q3, tudo parece normal.', timestamp: '2023-10-27T09:05:00Z' },
  { user: 'bob', message: 'Vou enviar o rascunho do comunicado de imprensa para o seu e-mail.', timestamp: '2023-10-27T09:15:23Z' },
  { user: 'charlie', message: 'Ei, tive problemas para acessar o servidor. Minha senha é MySuperSecretPassword123, pode verificar se minha conta está bloqueada?', timestamp: '2023-10-27T09:20:11Z' },
  { user: 'alice', message: 'Charlie, nunca compartilhe sua senha em um chat público!', timestamp: '2023-10-27T09:21:01Z' },
  { user: 'dave', message: 'O link para o novo portal de RH é este: http://portal-rh-empresa.web.app', timestamp: '2023-10-27T09:30:45Z' },
  { user: 'eve', message: 'Estou muito frustrada com a gestão. Eles não ouvem ninguém. Sinto vontade de vazar os planos do projeto secreto para a imprensa.', timestamp: '2023-10-27T09:45:10Z' },
  { user: 'frank', message: 'A chave da API para o ambiente de teste é: sk-test-aBcDeFgHiJkLmNoPqRsTuVwXyZ. Usem com cuidado.', timestamp: '2023-10-27T10:01:00Z' },
  { user: 'dave', message: 'Pessoal, confiram os descontos neste site: http://ofertas-incriveis.xyz/login. Parece um pouco estranho.', timestamp: '2023-10-27T10:05:00Z' },
  { user: 'bob', message: 'Aqui está o link para o documento de design: https://bit.ly/3xY4zAb. Por favor, revisem até o final do dia.', timestamp: '2023-10-27T10:10:00Z' },
];

const SIMULATED_GOOGLE_VAULT_LOGS = [
  { user: 'manager_mike', message: 'O desempenho do Ivan tem sido abaixo do esperado nos últimos 6 meses. Precisamos iniciar um plano de melhoria de desempenho.', timestamp: '2023-04-15T14:00:00Z' },
  { user: 'ivan', message: 'Recebi uma oferta de um concorrente. O salário é 30% maior. Estou seriamente considerando aceitar.', timestamp: '2023-04-18T11:23:00Z' },
  { user: 'heidi', message: 'Consegui baixar a lista de clientes do CRM. Vou enviar para o meu email pessoal para analisar em casa.', timestamp: '2023-05-20T17:55:00Z' },
  { user: 'legal_laura', message: 'Lembrete: a política da empresa proíbe estritamente a transferência de dados de clientes para dispositivos pessoais.', timestamp: '2023-05-21T10:00:00Z' },
];

const SIMULATED_GOOGLE_DRIVE_LOGS = [
    { user: 'heidi', activity: 'Usuário compartilhou o arquivo "Lista de Clientes Q4.xlsx" com "Qualquer pessoa com o link".', timestamp: '2023-10-27T11:00:00Z'},
    { user: 'ivan', activity: 'Usuário transferiu a propriedade do item "Planos de Aquisição M&A.docx" para um usuário externo (competitor@outlook.com).', timestamp: '2023-10-27T11:30:00Z'},
    { user: 'bob', activity: 'O item "Relatório Financeiro Confidencial.pdf" foi excluído.', timestamp: '2023-10-27T11:45:00Z'}
];

const SIMULATED_GMAIL_LOGS = [
  { user: 'phisher@evilcorp.xyz', subject: 'Ação Urgente Necessária: Sua Conta Será Desativada', message: 'Prezado usuário, detectamos atividade suspeita em sua conta. Para evitar o bloqueio, por favor, verifique sua identidade clicando aqui: http://secure-login-update.info/auth. Isso não é um teste.', timestamp: '2023-10-28T08:15:00Z' },
  { user: 'hr@example.com', subject: 'CONFIDENCIAL: Lista de Demissões Q4', message: 'Segue a lista preliminar de funcionários a serem desligados no próximo trimestre. Por favor, revise e mantenha em sigilo absoluto. Att, RH.', timestamp: '2023-10-28T09:00:00Z' },
  { user: 'ivan', subject: 'Fwd: Oportunidade Incrível!', message: 'Enviando isso para o meu e-mail pessoal para ler mais tarde. competitor@outlook.com', timestamp: '2023-10-28T10:30:00Z' },
];


// --- CONTEXTS ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SettingsContext = createContext<SettingsContextType | undefined>(undefined);
const AlertsContext = createContext<AlertsContextType | undefined>(undefined);
const ScanHistoryContext = createContext<ScanHistoryContextType | undefined>(undefined);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<GoogleUser | null>(() => {
        try {
            const storedUser = localStorage.getItem('exa-shield-user');
            return storedUser ? JSON.parse(storedUser) : null;
        } catch (error) {
            return null;
        }
    });

    const login = (userData: GoogleUser) => {
        localStorage.setItem('exa-shield-user', JSON.stringify(userData));
        setUser(userData);
    };

    const logout = () => {
        localStorage.removeItem('exa-shield-user');
        setUser(null);
    };

    return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
};

const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const defaultSettings: Settings = {
      scanSchedule: { type: 'manual', days: [], time: '09:00' },
      threatCategories: { dataLeakage: true, securityRisk: true, internalThreat: true, sentimentAnalysis: true, retentionAnalysis: true, churnRisk: true, phishingMalware: true },
      notifications: { enabled: false, email: '', awsAccessKey: '', awsSecretKey: '', awsRegion: 'us-east-1' },
      integrations: { googleWorkspace: false, googleWorkspaceToken: null, googleWorkspaceUser: null, chatSpaceId: '', googleVault: false, googleVaultToken: null, googleVaultUser: null, googleDrive: false, googleDriveToken: null, googleDriveUser: null, googleGmail: false, googleGmailToken: null, googleGmailUser: null },
      api: { geminiModel: 'gemini-2.5-flash' },
      sso: { jumpcloud: { enabled: false, clientId: '', orgUrl: '' } },
      analysis: {
          prompts: {
              logAnalysis: DEFAULT_LOG_ANALYSIS_PROMPT,
              threatIntel: DEFAULT_THREAT_INTEL_PROMPT,
          },
          keywords: ['senha', 'confidencial', 'vazar', 'frustrado', 'demissão'],
      }
  };

  const [settings, setSettings] = useState<Settings>(() => {
    const storedSettings = localStorage.getItem('exa-shield-settings');
    return storedSettings ? { ...defaultSettings, ...JSON.parse(storedSettings) } : defaultSettings;
  });

  useEffect(() => {
      localStorage.setItem('exa-shield-settings', JSON.stringify(settings));
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, setSettings, defaultSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

const AlertsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [historicalAlerts, setHistoricalAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    try {
      const storedAlerts = localStorage.getItem('historicalAlerts');
      if (storedAlerts) {
        setHistoricalAlerts(JSON.parse(storedAlerts));
      }
    } catch (error) {
      console.error("Failed to parse historical alerts from localStorage", error);
    }
  }, []);

  const addAlerts = (newAlerts: Alert[]) => {
    setHistoricalAlerts(prevAlerts => {
      const updatedAlerts = [...prevAlerts, ...newAlerts];
      // FIX: Explicitly convert Date values to numbers to resolve potential TypeScript arithmetic errors.
      updatedAlerts.sort((a, b) => Number(new Date(b.timestamp)) - Number(new Date(a.timestamp)));
      localStorage.setItem('historicalAlerts', JSON.stringify(updatedAlerts));
      return updatedAlerts;
    });
  };

  const clearAlerts = () => {
    localStorage.removeItem('historicalAlerts');
    setHistoricalAlerts([]);
  };

  return (
    <AlertsContext.Provider value={{ historicalAlerts, addAlerts, clearAlerts }}>
      {children}
    </AlertsContext.Provider>
  );
};

const ScanHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scanHistory, setScanHistory] = useState<ScanRecord[]>([]);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('exa-shield-scan-history');
      if (storedHistory) {
        setScanHistory(JSON.parse(storedHistory));
      }
    } catch (error) {
      console.error("Failed to parse scan history from localStorage", error);
    }
  }, []);

  const addScanRecord = (recordData: Omit<ScanRecord, 'id' | 'timestamp'>) => {
    setScanHistory(prevHistory => {
      const newRecord: ScanRecord = {
        ...recordData,
        id: new Date().toISOString() + Math.random(),
        timestamp: new Date().toISOString(),
      };
      const updatedHistory = [newRecord, ...prevHistory].slice(0, 5);
      localStorage.setItem('exa-shield-scan-history', JSON.stringify(updatedHistory));
      return updatedHistory;
    });
  };

  return (
    <ScanHistoryContext.Provider value={{ scanHistory, addScanRecord }}>
      {children}
    </ScanHistoryContext.Provider>
  );
};

const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};

const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used within a SettingsProvider');
  return context;
};

const useAlerts = () => {
  const context = useContext(AlertsContext);
  if (!context) throw new Error('useAlerts must be used within an AlertsProvider');
  return context;
};

const useScanHistory = () => {
  const context = useContext(ScanHistoryContext);
  if (!context) throw new Error('useScanHistory must be used within a ScanHistoryProvider');
  return context;
};


// --- OIDC/PKCE Helper Functions ---
const generateCodeVerifier = () => {
    const randomBytes = new Uint8Array(32);
    window.crypto.getRandomValues(randomBytes);
    return window.btoa(String.fromCharCode(...randomBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
};

const generateCodeChallenge = async (verifier: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return window.btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
};


// --- COMPONENTS ---
const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className = '' }) => (
    <div className={`bg-slate-800/50 border border-slate-700 rounded-lg p-6 ${className}`}>
        <h2 className="text-xl font-semibold text-white mb-4">{title}</h2>
        {children}
    </div>
);

const LoginPage: React.FC = () => {
    const { login } = useAuth();
    const { settings } = useSettings();
    const isDemoMode = !GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "DEMO_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

    const handleGoogleLogin = (response: any) => {
        try {
            const decodedCredential = JSON.parse(atob(response.credential.split('.')[1]));
            const user: GoogleUser = {
                name: decodedCredential.name,
                email: decodedCredential.email,
                picture: decodedCredential.picture,
            };
            login(user);
        } catch (error) {
            console.error("Erro ao decodificar credencial do Google:", error);
            alert("Falha ao processar o login com o Google.");
        }
    };
    
    const handleSimulatedGoogleLogin = () => {
        alert("Simulando login com Google. Em um ambiente real, a autenticação ocorreria via pop-up do Google.");
        const mockUser: GoogleUser = {
            name: "Usuário de Demonstração",
            email: "demo.user@example.com",
            picture: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZHRoPSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNWY1ZjUiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCIvPjwvc3ZnPg==',
        };
        login(mockUser);
    };

    const initiateJumpCloudLogin = async () => {
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        const state = generateCodeVerifier();

        sessionStorage.setItem('jc_code_verifier', verifier);
        sessionStorage.setItem('jc_state', state);

        const params = new URLSearchParams({
            client_id: settings.sso.jumpcloud.clientId,
            redirect_uri: window.location.origin,
            response_type: 'code',
            scope: 'openid email profile',
            state: state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });
        
        // A `orgUrl` nas configurações é para SAML. Para OIDC, usamos o endpoint de autorização padrão do JumpCloud.
        // A organização do usuário é inferida a partir do Client ID ou do e-mail no lado do JumpCloud.
        window.location.assign(`https://oauth.jumpcloud.com/oauth2/auth?${params.toString()}`);
    };

    useEffect(() => {
        // Lidar com o callback de redirecionamento do OIDC do JumpCloud
        const handleRedirectCallback = async () => {
            const params = new URLSearchParams(window.location.search);
            const code = params.get('code');
            const state = params.get('state');
            const storedState = sessionStorage.getItem('jc_state');
            const codeVerifier = sessionStorage.getItem('jc_code_verifier');

            if (code && state && storedState && codeVerifier && state === storedState) {
                try {
                    const tokenResponse = await fetch('https://oauth.jumpcloud.com/oauth2/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            client_id: settings.sso.jumpcloud.clientId,
                            redirect_uri: window.location.origin,
                            code: code,
                            code_verifier: codeVerifier,
                        }),
                    });

                    if (!tokenResponse.ok) {
                        const errorBody = await tokenResponse.text();
                        throw new Error(`Falha na troca de token: ${tokenResponse.statusText} - ${errorBody}`);
                    }

                    const { id_token } = await tokenResponse.json();
                    const payload = JSON.parse(atob(id_token.split('.')[1]));
                    
                    const user: GoogleUser = {
                        name: payload.name || payload.email.split('@')[0],
                        email: payload.email,
                        picture: payload.picture || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZHRoPSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNWY1ZjUiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTIgMmExMCAxMCAwIDAgMC0zLjkxIDE5LjRhMTAgMTAgMCAwIDAgNy44MiAwQTEwIDEwIDAgMCAwIDEyIDJ6bTAgMTcuNWE3LjUgNy41IDAgMSAxIDAtMTVhNy41IDcuNSAwIDAgMSAwIDE1eiIvPjxwYXRoIGQ9Ik0xMiA4bC0yIDRoNGwtMiA0Ii8+PC9zdmc+',
                    };
                    login(user);

                } catch (error) {
                    console.error("Erro no OIDC do JumpCloud:", error);
                    alert("Falha ao processar o login com o JumpCloud.");
                } finally {
                    sessionStorage.removeItem('jc_state');
                    sessionStorage.removeItem('jc_code_verifier');
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            }
        };

        handleRedirectCallback();
    }, [login, settings.sso.jumpcloud.clientId]);


    useEffect(() => {
        if (isDemoMode || !window.google) {
            if(isDemoMode) console.warn("Google Client ID não configurado. Usando login simulado.");
            return;
        }

        try {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleGoogleLogin,
            });
            window.google.accounts.id.renderButton(
                document.getElementById('google-login-button'),
                { theme: 'outline', size: 'large', type: 'standard', text: 'signin_with', shape: 'rectangular' }
            );
        } catch (error) {
            console.error("Erro ao inicializar Google Sign-In:", error);
        }
    }, [isDemoMode]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-900 text-white">
            <div className="w-full max-w-md p-8 space-y-8 bg-slate-800/50 border border-slate-700 rounded-lg shadow-2xl">
                <div className="text-center">
                    <div className="inline-block p-3 bg-sky-500/10 rounded-full mb-4">
                        <ShieldCheckIcon className="w-10 h-10 text-sky-400" />
                    </div>
                    <h1 className="text-3xl font-bold">EXA Shield</h1>
                    <p className="mt-2 text-slate-400">Faça login para monitorar sua segurança.</p>
                </div>
                <div className="space-y-4">
                    {isDemoMode ? (
                         <button
                            onClick={handleSimulatedGoogleLogin}
                            className="w-full flex justify-center items-center gap-3 py-2 px-4 border border-slate-600 rounded-md text-sm font-medium text-white bg-slate-800 hover:bg-slate-700"
                        >
                            <GoogleIcon />
                            Entrar com Google
                        </button>
                    ) : (
                       <div id="google-login-button" className="flex justify-center"></div>
                    )}
                    
                    {settings.sso.jumpcloud.enabled && (
                        <button
                            onClick={initiateJumpCloudLogin}
                            disabled={!settings.sso.jumpcloud.clientId}
                            className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-slate-600 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <JumpCloudIcon />
                            Entrar com JumpCloud
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const SettingsPage: React.FC = () => {
    const { settings, setSettings, defaultSettings } = useSettings();
    const [isEditingJumpCloud, setIsEditingJumpCloud] = useState(false);
    const [jumpCloudFormData, setJumpCloudFormData] = useState({
        clientId: settings.sso.jumpcloud.clientId,
        orgUrl: settings.sso.jumpcloud.orgUrl,
    });
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [activeAnalysisTab, setActiveAnalysisTab] = useState<'prompts' | 'keywords'>('prompts');
    const [selectedPrompt, setSelectedPrompt] = useState<'logAnalysis' | 'threatIntel'>('logAnalysis');
    const [promptText, setPromptText] = useState(settings.analysis.prompts.logAnalysis);
    const [newKeyword, setNewKeyword] = useState('');

    useEffect(() => {
        setPromptText(settings.analysis.prompts[selectedPrompt]);
    }, [selectedPrompt, settings.analysis.prompts]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const keys = name.split('.');
    
        const isCheckbox = type === 'checkbox';
        const checked = isCheckbox ? (e.target as HTMLInputElement).checked : undefined;
    
        setSettings(prev => {
            const newSettings = JSON.parse(JSON.stringify(prev)); // Deep copy
            let current = newSettings;
            for (let i = 0; i < keys.length - 1; i++) {
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = isCheckbox ? checked : value;
            return newSettings;
        });
    };
    
    const handleJumpCloudFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setJumpCloudFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleJumpCloudEdit = () => {
        setJumpCloudFormData({
            clientId: settings.sso.jumpcloud.clientId,
            orgUrl: settings.sso.jumpcloud.orgUrl,
        });
        setIsEditingJumpCloud(true);
    };

    const handleJumpCloudCancel = () => {
        setIsEditingJumpCloud(false);
    };

    const handleJumpCloudSave = (e: React.FormEvent) => {
        e.preventDefault();
        setSettings(prev => ({
            ...prev,
            sso: {
                ...prev.sso,
                jumpcloud: {
                    ...jumpCloudFormData,
                    enabled: true,
                }
            }
        }));
        setIsEditingJumpCloud(false);
    };

    const handleJumpCloudDelete = () => {
        setSettings(prev => ({
            ...prev,
            sso: {
                ...prev.sso,
                jumpcloud: {
                    enabled: false,
                    clientId: '',
                    orgUrl: '',
                }
            }
        }));
        setShowDeleteConfirm(false);
    };

    const handleGoogleAuth = (integration: 'googleWorkspace' | 'googleVault' | 'googleDrive' | 'googleGmail', scopes: string) => {
        const isDemoMode = !GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "DEMO_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

        if (isDemoMode) {
            const integrationName = {
                googleWorkspace: "Google Workspace (Chat)",
                googleVault: "Google Vault",
                googleDrive: "Google Drive",
                googleGmail: "Google Workspace (Gmail)"
            }[integration];

            alert(`Simulando conexão com ${integrationName}. Em um ambiente real, a autenticação ocorreria via pop-up do Google.`);
            
            const mockUser: GoogleUser = {
                name: "Usuário de Demonstração",
                email: "demo.user@example.com",
                picture: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZHRoPSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmNWY1ZjUiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjAgMjF2LTJhNCA0IDAgMCAwLTQtNEg4YTQgNCAwIDAgMC00IDR2MiIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iNyIgcj0iNCIvPjwvc3ZnPg==',
            };

            setSettings(prev => ({
                ...prev,
                integrations: {
                    ...prev.integrations,
                    [`${integration}Token`]: 'DEMO_ACCESS_TOKEN',
                    [`${integration}User`]: mockUser,
                    [integration]: true,
                }
            }));
            return;
        }

        if (!window.google) {
            alert("A biblioteca do Google Client não foi carregada. Por favor, recarregue a página.");
            return;
        }

        try {
            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: scopes,
                callback: async (tokenResponse: { access_token: string }) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                            headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
                        });
                        if (userInfoResponse.ok) {
                            const userInfo = await userInfoResponse.json();
                            setSettings(prev => ({
                                ...prev,
                                integrations: {
                                    ...prev.integrations,
                                    [`${integration}Token`]: tokenResponse.access_token,
                                    [`${integration}User`]: { name: userInfo.name, email: userInfo.email, picture: userInfo.picture },
                                    [integration]: true,
                                }
                            }));
                        } else { throw new Error("Falha ao buscar informações do usuário do Google."); }
                    }
                },
                error_callback: (error: any) => {
                    console.error("Google Auth Error:", error);
                    alert(`Ocorreu um erro durante a autenticação com o Google: ${error.message || 'Erro desconhecido.'}`);
                }
            });
            client.requestAccessToken();
        } catch (e) {
            console.error("Erro ao inicializar o cliente Google:", e);
            alert("Ocorreu um erro ao tentar conectar com o Google. Verifique o console para mais detalhes.");
        }
    };

    const handleGoogleDisconnect = (integration: 'googleWorkspace' | 'googleVault' | 'googleDrive' | 'googleGmail') => {
        setSettings(prev => ({
            ...prev,
            integrations: {
                ...prev.integrations,
                [`${integration}Token`]: null,
                [`${integration}User`]: null,
                [integration]: false,
            }
        }));
    };

    const handleSavePrompt = () => {
        setSettings(prev => ({
            ...prev,
            analysis: {
                ...prev.analysis,
                prompts: {
                    ...prev.analysis.prompts,
                    [selectedPrompt]: promptText,
                }
            }
        }));
        alert('Prompt salvo com sucesso!');
    };

    const handleRestoreDefaultPrompt = () => {
        const defaultPromptText = defaultSettings.analysis.prompts[selectedPrompt];
        setPromptText(defaultPromptText);
        setSettings(prev => ({
            ...prev,
            analysis: {
                ...prev.analysis,
                prompts: {
                    ...prev.analysis.prompts,
                    [selectedPrompt]: defaultPromptText,
                }
            }
        }));
        alert('Prompt restaurado para o padrão!');
    };
    
    const handleAddKeyword = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedKeyword = newKeyword.trim();
        if (trimmedKeyword && !settings.analysis.keywords.includes(trimmedKeyword)) {
            setSettings(prev => ({
                ...prev,
                analysis: {
                    ...prev.analysis,
                    keywords: [...prev.analysis.keywords, trimmedKeyword],
                }
            }));
            setNewKeyword('');
        }
    };

    const handleDeleteKeyword = (keywordToDelete: string) => {
        setSettings(prev => ({
            ...prev,
            analysis: {
                ...prev.analysis,
                keywords: prev.analysis.keywords.filter(kw => kw !== keywordToDelete),
            }
        }));
    };

    const handleDayChange = (day: string) => {
        setSettings(prev => {
            const currentDays = prev.scanSchedule.days;
            const newDays = currentDays.includes(day)
                ? currentDays.filter(d => d !== day)
                : [...currentDays, day];
            return {
                ...prev,
                scanSchedule: {
                    ...prev.scanSchedule,
                    days: newDays,
                }
            };
        });
    };

    const daysOfWeek = [
        { id: 'sunday',    label: 'D', name: 'Domingo' },
        { id: 'monday',    label: 'S', name: 'Segunda' },
        { id: 'tuesday',   label: 'T', name: 'Terça' },
        { id: 'wednesday', label: 'Q', name: 'Quarta' },
        { id: 'thursday',  label: 'Q', name: 'Quinta' },
        { id: 'friday',    label: 'S', name: 'Sexta' },
        { id: 'saturday',  label: 'S', name: 'Sábado' }
    ];

    const IntegrationButton: React.FC<{ type: 'googleWorkspace' | 'googleVault' | 'googleDrive' | 'googleGmail', name: string, scopes: string }> = ({ type, name, scopes }) => {
        const user = settings.integrations[`${type}User`];
        const isConnected = settings.integrations[type];
        return (
             <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                <div className="flex items-center gap-4">
                    <GoogleIcon />
                    <div>
                        <p className="text-white font-medium">{name}</p>
                        {user ? (
                           <div className="flex items-center gap-2 text-sm text-slate-400">
                                <img src={user.picture} alt={user.name} className="w-5 h-5 rounded-full" />
                                <span>{user.email}</span>
                           </div>
                        ) : <p className="text-slate-400 text-sm">Não conectado</p>}
                    </div>
                </div>
                <button
                    onClick={() => isConnected ? handleGoogleDisconnect(type) : handleGoogleAuth(type, scopes)}
                    className={`px-4 py-2 rounded-md text-sm font-semibold ${isConnected ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-sky-500 hover:bg-sky-600 text-white'}`}
                >
                    {isConnected ? 'Desconectar' : 'Conectar'}
                </button>
            </div>
        );
    };

    return (
        <div className="p-8 text-white space-y-8">
            <h1 className="text-3xl font-bold">Configurações</h1>

            <Card title="Configuração de Logon Único (SSO)">
                <div className="space-y-4">
                    <div className="p-4 bg-slate-700/50 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <JumpCloudIcon />
                                <div>
                                    <p className="text-white font-medium">JumpCloud SSO (OIDC)</p>
                                    <p className={`text-sm ${settings.sso.jumpcloud.enabled ? 'text-green-400' : 'text-slate-400'}`}>
                                        {settings.sso.jumpcloud.enabled ? 'Ativado' : 'Desativado'}
                                    </p>
                                </div>
                            </div>
                            {!settings.sso.jumpcloud.enabled && !isEditingJumpCloud && (
                                <button onClick={handleJumpCloudEdit} className="px-4 py-2 rounded-md text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white">
                                    Configurar
                                </button>
                            )}
                        </div>
                        {(settings.sso.jumpcloud.enabled || isEditingJumpCloud) && (
                            <div className="mt-4 pt-4 border-t border-slate-600 space-y-4">
                                {isEditingJumpCloud ? (
                                    <form onSubmit={handleJumpCloudSave} className="space-y-4">
                                         <div>
                                            <label htmlFor="sso.jumpcloud.clientId" className="block text-sm font-medium text-slate-300 mb-1">Client ID</label>
                                            <input
                                                type="text"
                                                id="sso.jumpcloud.clientId"
                                                name="clientId"
                                                value={jumpCloudFormData.clientId}
                                                onChange={handleJumpCloudFormChange}
                                                placeholder="Seu Client ID do JumpCloud"
                                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="sso.jumpcloud.orgUrl" className="block text-sm font-medium text-slate-300 mb-1">URL da Organização (SAML - Opcional)</label>
                                            <input
                                                type="text"
                                                id="sso.jumpcloud.orgUrl"
                                                name="orgUrl"
                                                value={jumpCloudFormData.orgUrl}
                                                onChange={handleJumpCloudFormChange}
                                                placeholder="https://sso.jumpcloud.com/saml2/..."
                                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                            />
                                            <p className="text-xs text-slate-400 mt-1">Nota: A implementação atual usa OIDC e ignora este campo. Ele é mantido para futuras integrações SAML.</p>
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            <button type="button" onClick={handleJumpCloudCancel} className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-600 hover:bg-slate-500 text-white">
                                                Cancelar
                                            </button>
                                            <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white">
                                                Salvar
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div>
                                        <div className="space-y-2 text-sm">
                                            <div>
                                                <p className="font-medium text-slate-400">Client ID</p>
                                                <p className="font-mono bg-slate-800 p-2 rounded-md text-slate-300 break-all">{settings.sso.jumpcloud.clientId}</p>
                                            </div>
                                            {settings.sso.jumpcloud.orgUrl && (
                                                <div>
                                                    <p className="font-medium text-slate-400">URL da Organização (SAML)</p>
                                                    <p className="font-mono bg-slate-800 p-2 rounded-md text-slate-300 break-all">{settings.sso.jumpcloud.orgUrl}</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex justify-end gap-2 mt-4">
                                            <button onClick={() => setShowDeleteConfirm(true)} className="px-4 py-2 rounded-md text-sm font-semibold bg-red-600 hover:bg-red-700 text-white">
                                                Excluir
                                            </button>
                                            <button onClick={handleJumpCloudEdit} className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-600 hover:bg-slate-500 text-white">
                                                Editar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </Card>
            
            <Card title="Integrações de Fontes de Dados">
                <div className="space-y-4">
                    <IntegrationButton type="googleWorkspace" name="Google Workspace (Chat)" scopes={WORKSPACE_SCOPES} />
                     {settings.integrations.googleWorkspace && (
                        <div className="pl-4">
                            <label htmlFor="integrations.chatSpaceId" className="block text-sm font-medium text-slate-300 mb-1">ID do Espaço do Google Chat</label>
                            <input
                                type="text"
                                id="integrations.chatSpaceId"
                                name="integrations.chatSpaceId"
                                value={settings.integrations.chatSpaceId}
                                onChange={handleChange}
                                placeholder="spaces/AAAA..."
                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                            />
                        </div>
                    )}
                    <IntegrationButton type="googleGmail" name="Google Workspace (Gmail)" scopes={GMAIL_SCOPES} />
                    <IntegrationButton type="googleVault" name="Google Vault" scopes={VAULT_SCOPES} />
                    <IntegrationButton type="googleDrive" name="Google Drive" scopes={DRIVE_SCOPES} />
                </div>
            </Card>

            <Card title="Agendamento de Varreduras">
                <div className="space-y-4">
                    <div>
                        <label htmlFor="scanSchedule.type" className="block text-sm font-medium text-slate-300 mb-1">Frequência</label>
                        <select
                            id="scanSchedule.type"
                            name="scanSchedule.type"
                            value={settings.scanSchedule.type}
                            onChange={handleChange}
                            className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                        >
                            <option value="manual">Manual (Apenas sob demanda)</option>
                            <option value="daily">Diária</option>
                            <option value="weekly">Semanal</option>
                        </select>
                    </div>

                    {settings.scanSchedule.type === 'weekly' && (
                        <div className="animate-fade-in">
                            <label className="block text-sm font-medium text-slate-300 mb-2">Dias da Semana</label>
                            <div className="flex justify-center gap-1 sm:gap-2">
                                {daysOfWeek.map(day => (
                                    <button
                                        key={day.id}
                                        title={day.name}
                                        onClick={() => handleDayChange(day.id)}
                                        className={`w-10 h-10 rounded-full text-sm font-semibold transition-colors ${
                                            settings.scanSchedule.days.includes(day.id)
                                                ? 'bg-sky-500 text-white'
                                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                                        }`}
                                    >
                                        {day.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {settings.scanSchedule.type !== 'manual' && (
                        <div className="animate-fade-in">
                            <label htmlFor="scanSchedule.time" className="block text-sm font-medium text-slate-300 mb-1">Horário da Varredura</label>
                            <input
                                type="time"
                                id="scanSchedule.time"
                                name="scanSchedule.time"
                                value={settings.scanSchedule.time}
                                onChange={handleChange}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                            />
                        </div>
                    )}
                    <p className="text-xs text-slate-400 mt-2">Nota: A varredura automática só será executada se a aplicação estiver aberta em um navegador no horário agendado.</p>
                </div>
            </Card>

            <Card title="Categorias de Ameaças">
                <div className="grid grid-cols-2 gap-4">
                    {Object.keys(settings.threatCategories).map((key) => (
                        <label key={key} className="flex items-center gap-2 bg-slate-700/50 p-3 rounded-md">
                            <input
                                type="checkbox"
                                name={`threatCategories.${key}`}
                                checked={settings.threatCategories[key as keyof typeof settings.threatCategories]}
                                onChange={handleChange}
                                className="h-4 w-4 rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-sky-500"
                            />
                            <span className="text-slate-300 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                        </label>
                    ))}
                </div>
            </Card>
            
            <Card title="Notificações (via AWS SES)">
                <div className="space-y-4">
                    <label className="flex items-center gap-2">
                         <input
                            type="checkbox"
                            name="notifications.enabled"
                            checked={settings.notifications.enabled}
                            onChange={handleChange}
                            className="h-4 w-4 rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-sky-500"
                         />
                         <span className="text-slate-300">Habilitar Notificações por E-mail</span>
                    </label>
                    {settings.notifications.enabled && (
                        <div className="space-y-4 pl-6 border-l-2 border-slate-700">
                             <div>
                                <label htmlFor="notifications.email" className="block text-sm font-medium text-slate-300 mb-1">E-mail do Administrador</label>
                                <input
                                    type="email"
                                    id="notifications.email"
                                    name="notifications.email"
                                    value={settings.notifications.email}
                                    onChange={handleChange}
                                    placeholder="admin@suaempresa.com"
                                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                />
                            </div>
                            <div>
                                <label htmlFor="notifications.awsAccessKey" className="block text-sm font-medium text-slate-300 mb-1">AWS Access Key ID</label>
                                <input
                                    type="text"
                                    id="notifications.awsAccessKey"
                                    name="notifications.awsAccessKey"
                                    value={settings.notifications.awsAccessKey}
                                    onChange={handleChange}
                                    placeholder="AKIA..."
                                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                />
                            </div>
                            <div>
                                <label htmlFor="notifications.awsSecretKey" className="block text-sm font-medium text-slate-300 mb-1">AWS Secret Access Key</label>
                                <input
                                    type="password"
                                    id="notifications.awsSecretKey"
                                    name="notifications.awsSecretKey"
                                    value={settings.notifications.awsSecretKey}
                                    onChange={handleChange}
                                    placeholder="••••••••••••••••••••••••"
                                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                />
                            </div>
                             <div>
                                <label htmlFor="notifications.awsRegion" className="block text-sm font-medium text-slate-300 mb-1">AWS Region</label>
                                <input
                                    type="text"
                                    id="notifications.awsRegion"
                                    name="notifications.awsRegion"
                                    value={settings.notifications.awsRegion}
                                    onChange={handleChange}
                                    placeholder="us-east-1"
                                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                                />
                            </div>
                            <p className="text-xs text-slate-400">Nota: O envio de e-mails é simulado no console do navegador para segurança.</p>
                        </div>
                    )}
                </div>
            </Card>

             <Card title="Configurações da API">
                <label htmlFor="api.geminiModel" className="block text-sm font-medium text-slate-300 mb-1">Modelo Gemini</label>
                <select 
                    id="api.geminiModel"
                    name="api.geminiModel"
                    value={settings.api.geminiModel}
                    onChange={handleChange}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Rápido)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Avançado)</option>
                </select>
                <p className="text-xs text-slate-400 mt-2">A chave da API do Gemini é configurada via variável de ambiente (`process.env.API_KEY`) por segurança.</p>
            </Card>

            <Card title="Personalização da Análise de IA">
                <div className="border-b border-slate-600 mb-4">
                    <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                        <button
                            onClick={() => setActiveAnalysisTab('prompts')}
                            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${activeAnalysisTab === 'prompts' ? 'border-sky-400 text-sky-400' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}
                        >
                            Gerenciamento de Prompts
                        </button>
                        <button
                            onClick={() => setActiveAnalysisTab('keywords')}
                            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${activeAnalysisTab === 'keywords' ? 'border-sky-400 text-sky-400' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'}`}
                        >
                            Palavras-Chave de Risco
                        </button>
                    </nav>
                </div>
                {activeAnalysisTab === 'prompts' ? (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="prompt-select" className="block text-sm font-medium text-slate-300 mb-1">Selecione o Prompt para Editar</label>
                            <select
                                id="prompt-select"
                                value={selectedPrompt}
                                onChange={(e) => setSelectedPrompt(e.target.value as 'logAnalysis' | 'threatIntel')}
                                className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                            >
                                <option value="logAnalysis">Análise de Logs</option>
                                <option value="threatIntel">Inteligência de Ameaças</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="prompt-text" className="block text-sm font-medium text-slate-300 mb-1">Texto do Prompt</label>
                            <textarea
                                id="prompt-text"
                                value={promptText}
                                onChange={(e) => setPromptText(e.target.value)}
                                className="w-full h-64 bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-white font-mono text-sm focus:ring-sky-500 focus:border-sky-500"
                            />
                            <p className="text-xs text-slate-400 mt-1">Variáveis como `{'{logsToAnalyze}'}` serão substituídas dinamicamente.</p>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={handleRestoreDefaultPrompt} className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-600 hover:bg-slate-500 text-white">
                                Restaurar Padrão
                            </button>
                            <button onClick={handleSavePrompt} className="px-4 py-2 rounded-md text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white">
                                Salvar Prompt
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Adicione palavras ou frases que a IA deve considerar como alto risco durante a análise de logs.</p>
                        <form onSubmit={handleAddKeyword} className="flex gap-2">
                            <input
                                type="text"
                                value={newKeyword}
                                onChange={(e) => setNewKeyword(e.target.value)}
                                placeholder="Ex: projeto_secreto, demissão"
                                className="flex-grow bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"
                            />
                            <button type="submit" className="px-4 py-2 rounded-md text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white">
                                Adicionar
                            </button>
                        </form>
                        <div className="flex flex-wrap gap-2 pt-2">
                            {settings.analysis.keywords.map(kw => (
                                <div key={kw} className="flex items-center gap-2 bg-slate-700 rounded-full px-3 py-1 text-sm">
                                    <span>{kw}</span>
                                    <button onClick={() => handleDeleteKeyword(kw)} className="text-slate-400 hover:text-white" aria-label={`Excluir ${kw}`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Card>


            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-dialog-title">
                    <div className="w-full max-w-lg p-8 space-y-6 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl">
                        <h2 id="delete-confirm-dialog-title" className="text-2xl font-bold text-white">Confirmar Exclusão</h2>
                        <p className="text-slate-300">
                            Tem certeza de que deseja excluir a configuração do JumpCloud SSO? Esta ação irá desativar o login via JumpCloud.
                        </p>
                        <div className="flex justify-end gap-4 mt-6">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-md font-semibold text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleJumpCloudDelete}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-sm"
                            >
                                Sim, Excluir
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AlertDetails: React.FC<{ alert: Alert; severity: Alert['severity'] }> = ({ alert, severity }) => {
    const getSeverityBorderClass = (s: Alert['severity']) => {
        switch (s) {
            case 'Alta': return 'border-red-500/30';
            case 'Média': return 'border-orange-500/30';
            case 'Baixa': return 'border-amber-500/30';
            default: return 'border-slate-600/30';
        }
    };

    const renderLogDetails = (logData: any) => {
        if (!logData || typeof logData !== 'object' || Object.keys(logData).length === 0) {
            return (
                <div className="font-mono text-sm text-slate-400 bg-slate-800 p-3 rounded-md">
                    <p className="font-semibold text-slate-300 mb-1">Log Bruto:</p>
                    <code>{alert.log}</code>
                </div>
            );
        }

        const keyMappings: Record<string, string> = {
            user: "Usuário/Remetente",
            message: "Mensagem",
            text: "Texto",
            activity: "Atividade",
            timestamp: "Horário Original",
            createTime: "Horário de Criação",
            source: "Fonte",
            sender: "Remetente",
            recipient: "Destinatário",
            subject: "Assunto",
            fileName: "Nome do Arquivo",
            visibility: "Visibilidade",
            newOwner: "Novo Proprietário",
            sharedWith: "Compartilhado Com",
        };

        const renderValue = (value: any) => {
            if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
                return <a href={value} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">{value}</a>;
            }
             if (typeof value === 'object' && value !== null) {
                return <pre className="text-xs bg-slate-800 p-2 rounded-md whitespace-pre-wrap break-all"><code>{JSON.stringify(value, null, 2)}</code></pre>;
            }
            return String(value);
        }

        return (
            <ul className="space-y-2 text-sm font-mono">
                {Object.entries(logData).map(([key, value]) => (
                    <li key={key} className="flex flex-col sm:flex-row">
                        <span className="w-full sm:w-1/3 font-semibold text-slate-300 capitalize">{keyMappings[key] || key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                        <div className="w-full sm:w-2/3 text-slate-400 break-words">{renderValue(value)}</div>
                    </li>
                ))}
            </ul>
        );
    };

    return (
        <div className={`bg-slate-900/70 border-x border-b ${getSeverityBorderClass(severity)} p-4 rounded-b-lg -mt-px animate-fade-in`}>
            <h4 className="text-md font-semibold text-slate-200 mb-3">Detalhes do Log Original</h4>
            {renderLogDetails(alert.originalLog)}
        </div>
    );
};

const AlertsPage: React.FC = () => {
    const { historicalAlerts, clearAlerts } = useAlerts();
    const [filters, setFilters] = useState({
        severity: 'all',
        category: 'all',
        startDate: '',
        endDate: '',
    });
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const alertsPerPage = 10;
    
    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
        setCurrentPage(1);
    };

    const clearFiltersHandler = () => {
        setFilters({ severity: 'all', category: 'all', startDate: '', endDate: '' });
        setCurrentPage(1);
    };

    const uniqueCategories = useMemo(() => {
        const categories = new Set(historicalAlerts.map(alert => alert.category));
        return Array.from(categories);
    }, [historicalAlerts]);

    const filteredAlerts = useMemo(() => {
        return historicalAlerts.filter(alert => {
            if (filters.severity !== 'all' && alert.severity !== filters.severity) return false;
            if (filters.category !== 'all' && alert.category !== filters.category) return false;
            
            const alertDate = new Date(alert.timestamp);
            if (filters.startDate) {
                if (alertDate < new Date(filters.startDate)) return false;
            }
            if (filters.endDate) {
                const endDate = new Date(filters.endDate);
                endDate.setHours(23, 59, 59, 999); // Include the entire end day
                if (alertDate > endDate) return false;
            }
            return true;
        });
    }, [historicalAlerts, filters]);

    const indexOfLastAlert = currentPage * alertsPerPage;
    const indexOfFirstAlert = indexOfLastAlert - alertsPerPage;
    const currentAlerts = filteredAlerts.slice(indexOfFirstAlert, indexOfLastAlert);
    const totalPages = Math.ceil(filteredAlerts.length / alertsPerPage);

    const getSeverityClass = (severity: Alert['severity']) => {
        switch (severity) {
            case 'Alta': return 'bg-red-500/10 text-red-400 border border-red-500/30';
            case 'Média': return 'bg-orange-500/10 text-orange-400 border border-orange-500/30';
            case 'Baixa': return 'bg-amber-500/10 text-amber-400 border border-amber-500/30';
            default: return 'bg-slate-700/20 text-slate-300 border border-slate-600/30';
        }
    };
    
    return (
        <div className="p-8 text-white">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Alertas Históricos</h1>
                    <p className="text-slate-400 mt-1">Revise todos os alertas de segurança detectados anteriormente.</p>
                </div>
                {historicalAlerts.length > 0 && (
                    <button 
                        onClick={() => setShowConfirmModal(true)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-sm"
                    >
                        Limpar Alertas
                    </button>
                )}
            </div>

            {historicalAlerts.length > 0 && (
                 <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
                        <div className="w-full">
                            <label htmlFor="severity" className="block text-sm font-medium text-slate-300 mb-1">Severidade</label>
                            <select name="severity" id="severity" value={filters.severity} onChange={handleFilterChange} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500">
                                <option value="all">Todas</option>
                                <option value="Alta">Alta</option>
                                <option value="Média">Média</option>
                                <option value="Baixa">Baixa</option>
                            </select>
                        </div>
                        <div className="w-full">
                             <label htmlFor="category" className="block text-sm font-medium text-slate-300 mb-1">Categoria</label>
                            <select name="category" id="category" value={filters.category} onChange={handleFilterChange} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500">
                                <option value="all">Todas</option>
                                {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                        </div>
                         <div className="w-full">
                            <label htmlFor="startDate" className="block text-sm font-medium text-slate-300 mb-1">Data de Início</label>
                            <input type="date" name="startDate" id="startDate" value={filters.startDate} onChange={handleFilterChange} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"/>
                        </div>
                         <div className="w-full">
                            <label htmlFor="endDate" className="block text-sm font-medium text-slate-300 mb-1">Data de Fim</label>
                            <input type="date" name="endDate" id="endDate" value={filters.endDate} onChange={handleFilterChange} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-sky-500 focus:border-sky-500"/>
                        </div>
                        <button onClick={clearFiltersHandler} className="w-full bg-slate-600 hover:bg-slate-500 text-white font-semibold py-2 px-4 rounded-md text-sm">Limpar Filtros</button>
                    </div>
                </div>
            )}

            {historicalAlerts.length === 0 ? (
                <div className="text-center py-16 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <AlertTriangleIcon className="mx-auto h-12 w-12 text-slate-500" />
                    <h3 className="mt-2 text-lg font-semibold">Nenhum Alerta Encontrado</h3>
                    <p className="mt-1 text-sm text-slate-400">Execute uma varredura no Painel Principal para começar.</p>
                </div>
            ) : filteredAlerts.length === 0 ? (
                 <div className="text-center py-16 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <SearchIcon className="mx-auto h-12 w-12 text-slate-500" />
                    <h3 className="mt-2 text-lg font-semibold">Nenhum Alerta Corresponde aos Filtros</h3>
                    <p className="mt-1 text-sm text-slate-400">Tente ajustar ou limpar os filtros para ver os resultados.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {currentAlerts.map((alert, index) => {
                        const globalIndex = historicalAlerts.indexOf(alert); // Use a stable index
                        return (
                             <div key={globalIndex}>
                                <div
                                    onClick={() => setExpandedIndex(expandedIndex === globalIndex ? null : globalIndex)}
                                    className={`p-4 rounded-lg cursor-pointer ${getSeverityClass(alert.severity)} ${expandedIndex === globalIndex ? 'rounded-b-none' : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedIndex(expandedIndex === globalIndex ? null : globalIndex); }}
                                    aria-expanded={expandedIndex === globalIndex}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <span className="text-xs font-semibold uppercase tracking-wider">{alert.category}</span>
                                            <p className="font-semibold text-lg text-white">{alert.description}</p>
                                            <p className="text-sm text-slate-400 mt-1 font-mono bg-slate-900/50 p-2 rounded-md truncate">Log: {alert.log}</p>
                                        </div>
                                        <div className="text-right flex-shrink-0 ml-4">
                                            <span className="font-bold text-sm">{alert.severity}</span>
                                            <p className="text-xs text-slate-500">{new Date(alert.timestamp).toLocaleString()}</p>
                                        </div>
                                    </div>
                                </div>
                                {expandedIndex === globalIndex && <AlertDetails alert={alert} severity={alert.severity} />}
                            </div>
                        );
                    })}
                    {totalPages > 1 && (
                         <div className="flex justify-center items-center gap-2 pt-4">
                            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 disabled:opacity-50"><ChevronLeftIcon /></button>
                            <span className="text-sm">Página {currentPage} de {totalPages}</span>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 disabled:opacity-50"><ChevronRightIcon /></button>
                        </div>
                    )}
                </div>
            )}
             {showConfirmModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
                    <div className="w-full max-w-lg p-8 space-y-6 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl">
                        <h2 id="confirm-dialog-title" className="text-2xl font-bold text-white">Confirmar Exclusão</h2>
                        <p className="text-slate-300">
                            Tem certeza de que deseja excluir permanentemente todos os alertas históricos? Esta ação não pode ser desfeita.
                        </p>
                        <div className="flex justify-end gap-4 mt-6">
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-md font-semibold text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    clearAlerts();
                                    setShowConfirmModal(false);
                                }}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-semibold text-sm"
                            >
                                Sim, Excluir Tudo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const LineChart: React.FC<{ data: { date: string; count: number }[], className?: string }> = ({ data, className }) => {
    const [tooltip, setTooltip] = useState<{ x: number, y: number, date: string, count: number } | null>(null);
    const svgRef = React.useRef<SVGSVGElement>(null);
    if (!data || data.length < 2) {
        return <div className="flex items-center justify-center h-64 text-slate-400">Dados insuficientes para exibir o gráfico de tendência.</div>;
    }

    const PADDING = { top: 20, right: 30, bottom: 40, left: 40 };
    const WIDTH = 600;
    const HEIGHT = 300;
    const VIEWBOX_WIDTH = WIDTH;
    const VIEWBOX_HEIGHT = HEIGHT;
    
    const maxCount = Math.max(...data.map(d => d.count), 0);
    const yAxisTicks = Array.from({ length: 5 }, (_, i) => Math.round(i * (maxCount / 4)));

    const getX = (index: number) => PADDING.left + (index / (data.length - 1)) * (WIDTH - PADDING.left - PADDING.right);
    const getY = (count: number) => HEIGHT - PADDING.bottom - (count / maxCount) * (HEIGHT - PADDING.top - PADDING.bottom);

    const pathData = data.map((point, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(point.count)}`).join(' ');

    const handleMouseOver = (e: React.MouseEvent<SVGCircleElement>, point: { date: string, count: number }) => {
        const circle = e.target as SVGCircleElement;
        const x = parseFloat(circle.getAttribute('cx')!);
        const y = parseFloat(circle.getAttribute('cy')!);
        setTooltip({ x, y, ...point });
    };

    return (
        <div className={`relative ${className}`}>
            <svg ref={svgRef} viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} className="w-full h-auto">
                {/* Y-Axis Grid Lines & Labels */}
                {yAxisTicks.map(tick => (
                    <g key={`y-tick-${tick}`} className="text-slate-500">
                        <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={getY(tick)} y2={getY(tick)} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 3" />
                        <text x={PADDING.left - 8} y={getY(tick) + 3} textAnchor="end" fontSize="10" fill="currentColor">{tick}</text>
                    </g>
                ))}

                {/* X-Axis Labels */}
                {data.map((point, i) => {
                     if (data.length <= 10 || i === 0 || i === data.length - 1 || i % Math.floor(data.length / 5) === 0) {
                        return (
                             <text key={`x-label-${i}`} x={getX(i)} y={HEIGHT - PADDING.bottom + 15} textAnchor="middle" fontSize="10" fill="currentColor">
                                {new Date(point.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit'})}
                            </text>
                        );
                    }
                    return null;
                })}

                {/* Line Path */}
                <path d={pathData} fill="none" stroke="var(--sky-400)" strokeWidth="2" />
                
                {/* Data Points & Tooltip Area */}
                {data.map((point, i) => (
                    <circle
                        key={`dot-${i}`}
                        cx={getX(i)}
                        cy={getY(point.count)}
                        r="6"
                        fill="var(--sky-400)"
                        stroke="var(--slate-800)"
                        strokeWidth="2"
                        className="opacity-0 hover:opacity-100 transition-opacity"
                        onMouseOver={(e) => handleMouseOver(e, point)}
                        onMouseOut={() => setTooltip(null)}
                     />
                ))}
            </svg>
             {tooltip && (
                <div
                    className="absolute bg-slate-900 border border-slate-600 rounded-md p-2 text-xs shadow-lg pointer-events-none"
                    style={{
                        transform: `translate(-50%, -100%)`,
                        left: `${(tooltip.x / VIEWBOX_WIDTH) * 100}%`,
                        top: `${(tooltip.y / VIEWBOX_HEIGHT) * 100 - 10}px`, // Offset above the dot
                    }}
                >
                    <div className="font-bold">{new Date(tooltip.date).toLocaleDateString('pt-BR', { year: 'numeric', month: 'short', day: 'numeric'})}</div>
                    <div>Alertas: <span className="text-sky-400 font-semibold">{tooltip.count}</span></div>
                </div>
            )}
        </div>
    );
};


const ReportsPage: React.FC = () => {
    const { historicalAlerts } = useAlerts();

    const reportData = useMemo(() => {
        if (!historicalAlerts.length) return null;

        const bySeverity = { 'Alta': 0, 'Média': 0, 'Baixa': 0 };
        const byCategory = historicalAlerts.reduce((acc, alert) => {
            acc[alert.category] = (acc[alert.category] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const alertsOverTimeMap = historicalAlerts.reduce((acc, alert) => {
            const date = new Date(alert.timestamp).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const alertsOverTime = Object.entries(alertsOverTimeMap)
            .map(([date, count]) => ({ date, count }))
            // FIX: The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());


        historicalAlerts.forEach(alert => {
            bySeverity[alert.severity]++;
        });

        return {
            totalAlerts: historicalAlerts.length,
            bySeverity,
            byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
            alertsOverTime,
        };
    }, [historicalAlerts]);

    if (!reportData) {
        return (
            <div className="p-8 text-white text-center">
                <h1 className="text-3xl font-bold">Relatórios</h1>
                <p className="text-slate-400 mt-2">Nenhum dado de alerta disponível para gerar relatórios.</p>
            </div>
        );
    }
    
    return (
        <div className="p-8 text-white">
            <h1 className="text-3xl font-bold">Relatórios de Segurança</h1>
            <p className="text-slate-400 mt-1 mb-8">Análise agregada de todos os alertas detectados.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                 <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                    <h3 className="text-lg font-semibold text-slate-300">Total de Alertas</h3>
                    <p className="text-5xl font-bold text-sky-400 mt-2">{reportData.totalAlerts}</p>
                </div>
                {Object.entries(reportData.bySeverity).map(([severity, count]) => (
                     <div key={severity} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                        <h3 className="text-lg font-semibold text-slate-300">Severidade {severity}</h3>
                        <p className={`text-5xl font-bold mt-2 ${severity === 'Alta' ? 'text-red-400' : severity === 'Média' ? 'text-orange-400' : 'text-amber-400'}`}>{count}</p>
                    </div>
                ))}
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <Card title="Tendência de Alertas ao Longo do Tempo">
                    <LineChart data={reportData.alertsOverTime} />
                </Card>
                <Card title="Alertas por Categoria">
                    <div className="space-y-3">
                        {reportData.byCategory.map(([category, count]) => (
                            <div key={category}>
                                <div className="flex justify-between mb-1">
                                    <span className="text-base font-medium text-slate-300">{category}</span>
                                    <span className="text-sm font-medium text-slate-400">{count}</span>
                                </div>
                                <div className="w-full bg-slate-700 rounded-full h-2.5">
                                    <div className="bg-sky-500 h-2.5 rounded-full" style={{ width: `${(count / reportData.totalAlerts) * 100}%` }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </div>
    );
};

const ThreatIntelligencePage: React.FC = () => {
    const { settings } = useSettings();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [intelligenceReport, setIntelligenceReport] = useState<{ summary: string, recommendations: string[] } | null>(null);

    const fetchThreatIntel = async () => {
        setLoading(true);
        setError('');
        setIntelligenceReport(null);

        // Simulação de busca de dados de fontes como Mandiant, VirusTotal, etc.
        const simulatedThreatData = `
            Relatório de Ameaças Recentes (Simulado) - ${new Date().toLocaleDateString()}:
            1. CVE-2024-XXXX: Uma nova vulnerabilidade de dia zero foi descoberta no popular software de VPN "SecureConnect", permitindo a execução remota de código. A exploração ativa foi observada em setores financeiros. A correção ainda não está disponível.
            2. Campanha de Phishing "OfficeUpdate": Uma campanha de phishing em massa está se passando por notificações de atualização do Microsoft Office. Os e-mails contêm um link malicioso que leva ao roubo de credenciais do Office 365. O domínio do remetente geralmente usa TLDs .xyz ou .online.
            3. Malware "DataScraper": Uma nova variante do malware DataScraper está se espalhando através de documentos do Word com macros maliciosas. Ele é projetado para exfiltrar silenciosamente arquivos com as extensões .pdf, .docx e .xlsx para um servidor de comando e controle localizado na Europa Oriental.
            4. Aumento de Ataques de Engenharia Social: Observou-se um aumento de 40% em ataques de engenharia social direcionados a executivos (Whaling), usando informações coletadas de redes sociais profissionais para criar pretextos convincentes.
        `;
        
        try {
            const prompt = settings.analysis.prompts.threatIntel
                .replace('{threatData}', simulatedThreatData);

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: settings.api.geminiModel,
                contents: prompt,
            });

            const rawJson = response.text.trim();
            const parsedReport = JSON.parse(rawJson);
            setIntelligenceReport(parsedReport);

        } catch (e: any) {
            console.error("Erro durante a análise de inteligência de ameaças:", e);
            const errorMessage = e.message ? e.message : 'Ocorreu um erro desconhecido.';
            setError(`Falha na análise: ${errorMessage}. Verifique a chave da API e o console para mais detalhes.`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-8 text-white">
            <h1 className="text-3xl font-bold">Inteligência de Ameaças</h1>
            <p className="text-slate-400 mt-1 mb-8">Receba resumos e recomendações sobre as ameaças de segurança mais recentes.</p>
            
            <div className="flex justify-end mb-8">
                 <button
                    onClick={fetchThreatIntel}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold py-2 px-6 rounded-md disabled:opacity-50 disabled:cursor-wait"
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analisando...
                        </>
                    ) : (
                        "Atualizar Inteligência"
                    )}
                </button>
            </div>
             {error && (
                <div className="bg-red-900/50 border border-red-500/30 text-red-300 p-4 rounded-lg mb-8">
                    <p className="font-semibold">Erro na Análise</p>
                    <p>{error}</p>
                </div>
            )}
            
            {!intelligenceReport && !loading && (
                <div className="text-center py-16 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <BrainCircuitIcon className="mx-auto h-12 w-12 text-slate-500" />
                    <h3 className="mt-2 text-lg font-semibold">Pronto para Análise</h3>
                    <p className="mt-1 text-sm text-slate-400">Clique em "Atualizar Inteligência" para obter o último relatório de ameaças.</p>
                </div>
            )}

            {intelligenceReport && (
                 <div className="space-y-8 animate-fade-in">
                    <Card title="Resumo das Ameaças Críticas">
                        <p className="text-slate-300 leading-relaxed">{intelligenceReport.summary}</p>
                    </Card>
                    <Card title="Recomendações de Mitigação">
                        <ul className="space-y-4">
                            {intelligenceReport.recommendations.map((rec, index) => (
                                <li key={index} className="flex items-start gap-3">
                                    <ShieldCheckIcon className="w-6 h-6 text-green-400 mt-1 flex-shrink-0" />
                                    <span className="text-slate-300">{rec}</span>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </div>
            )}
        </div>
    );
};

const InteractiveAlertsTable: React.FC<{ alerts: Alert[] }> = ({ alerts }) => {
    type SortableKeys = keyof Alert | 'timestamp';
    const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' } | null>({ key: 'timestamp', direction: 'descending' });
    const [currentPage, setCurrentPage] = useState(1);
    const alertsPerPage = 5;

    const requestSort = (key: SortableKeys) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
        setCurrentPage(1); // Reset to first page on sort
    };

    const sortedAlerts = useMemo(() => {
        let sortableAlerts = [...alerts];
        if (sortConfig !== null) {
            sortableAlerts.sort((a, b) => {
                if (sortConfig.key === 'timestamp') {
                    const valA = new Date(a.timestamp).getTime();
                    const valB = new Date(b.timestamp).getTime();
                    if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
                    if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
                    return 0;
                }

                const valA = a[sortConfig.key as keyof Alert];
                const valB = b[sortConfig.key as keyof Alert];

                if (typeof valA === 'string' && typeof valB === 'string') {
                    return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                
                if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableAlerts;
    }, [alerts, sortConfig]);

    const indexOfLastAlert = currentPage * alertsPerPage;
    const indexOfFirstAlert = indexOfLastAlert - alertsPerPage;
    const currentAlerts = sortedAlerts.slice(indexOfFirstAlert, indexOfLastAlert);
    const totalPages = Math.ceil(sortedAlerts.length / alertsPerPage);

    const getSeverityClass = (severity: Alert['severity']) => {
        switch (severity) {
            case 'Alta': return 'text-red-400';
            case 'Média': return 'text-orange-400';
            case 'Baixa': return 'text-amber-400';
            default: return 'text-slate-300';
        }
    };

    const SortableHeader: React.FC<{ children: React.ReactNode; sortKey: SortableKeys }> = ({ children, sortKey }) => {
        const isSorted = sortConfig?.key === sortKey;
        const direction = isSorted ? sortConfig.direction : undefined;
        return (
            <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer select-none hover:bg-slate-700/50"
                onClick={() => requestSort(sortKey)}
                aria-sort={isSorted ? `${direction}ending` : 'none'}
            >
                {children}
                <span className="ml-2 inline-block">
                    {isSorted ? (direction === 'ascending' ? '▲' : '▼') : <span className="text-slate-600">↕</span>}
                </span>
            </th>
        );
    };

    return (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden animate-fade-in">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700">
                    <thead className="bg-slate-900/50">
                        <tr>
                            <SortableHeader sortKey="severity">Severidade</SortableHeader>
                            <SortableHeader sortKey="category">Categoria</SortableHeader>
                            <SortableHeader sortKey="description">Descrição</SortableHeader>
                            <SortableHeader sortKey="user">Usuário</SortableHeader>
                            <SortableHeader sortKey="source">Fonte</SortableHeader>
                            <SortableHeader sortKey="timestamp">Data</SortableHeader>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                        {currentAlerts.map((alert, index) => (
                            <tr key={index} className="hover:bg-slate-800">
                                <td className={`px-4 py-4 whitespace-nowrap text-sm font-semibold ${getSeverityClass(alert.severity)}`}>{alert.severity}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-300">{alert.category}</td>
                                <td className="px-4 py-4 text-sm text-slate-300 max-w-sm truncate">{alert.description}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-300">{alert.user}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-300">{alert.source}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-400">{new Date(alert.timestamp).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
             {totalPages > 1 && (
                <div className="flex justify-between items-center px-4 py-3 border-t border-slate-700">
                    <span className="text-sm text-slate-400">
                        Página {currentPage} de {totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 disabled:opacity-50 text-slate-300 hover:bg-slate-700 rounded-md"><ChevronLeftIcon /></button>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 disabled:opacity-50 text-slate-300 hover:bg-slate-700 rounded-md"><ChevronRightIcon /></button>
                    </div>
                </div>
            )}
        </div>
    );
};


const App: React.FC = () => {
    const { user } = useAuth();
    const [currentPage, setCurrentPage] = useState('dashboard');

    if (!user) {
        return (
            <SettingsProvider>
                <LoginPage />
            </SettingsProvider>
        );
    }

    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard': return <Dashboard />;
            case 'settings': return <SettingsPage />;
            case 'alerts': return <AlertsPage />;
            case 'reports': return <ReportsPage />;
            case 'threat-intel': return <ThreatIntelligencePage />;
            default: return <Dashboard />;
        }
    };

    return (
        <SettingsProvider>
            <AlertsProvider>
                <ScanHistoryProvider>
                    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--slate-900)' }}>
                        <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
                        <main style={{ flex: 1, overflowY: 'auto' }}>
                            {renderPage()}
                        </main>
                    </div>
                </ScanHistoryProvider>
            </AlertsProvider>
        </SettingsProvider>
    );
};

const Sidebar: React.FC<{ currentPage: string; setCurrentPage: (page: string) => void }> = ({ currentPage, setCurrentPage }) => {
  const { user, logout } = useAuth();
  const navItems = [
    { id: 'dashboard', label: 'Painel Principal', icon: <LayoutDashboardIcon /> },
    { id: 'alerts', label: 'Alertas', icon: <AlertTriangleIcon /> },
    { id: 'reports', label: 'Relatórios', icon: <FileTextIcon /> },
    { id: 'threat-intel', label: 'Inteligência', icon: <BrainCircuitIcon /> },
    { id: 'settings', label: 'Configurações', icon: <SettingsIcon /> },
  ];

  return (
    <aside className="w-64 bg-slate-800/50 border-r border-slate-700 flex flex-col p-4">
      <div className="flex items-center gap-2 px-2 py-4 mb-4">
        <ShieldCheckIcon />
        <h1 className="text-xl font-bold text-white">EXA Shield</h1>
      </div>
      <nav className="flex flex-col gap-2">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setCurrentPage(item.id)}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentPage === item.id ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            // Add ARIA attribute for better accessibility, indicating the current page.
            aria-current={currentPage === item.id ? 'page' : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-4 border-t border-slate-700">
        {user && (
            <div className="flex items-center gap-3 px-2 py-2 mb-2">
                <img src={user.picture} alt={user.name} className="w-9 h-9 rounded-full" />
                <div className="overflow-hidden">
                    <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                </div>
            </div>
        )}
        <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
        >
            <LogOutIcon />
            Sair
        </button>
      </div>
    </aside>
  );
};

const Dashboard: React.FC = () => {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { settings } = useSettings();
    const { addAlerts } = useAlerts();
    const { scanHistory, addScanRecord } = useScanHistory();

    const SIMULATED_MALICIOUS_DOMAINS = [
        'ofertas-incriveis.xyz',
        'secure-login-update.info',
        'ganhedinheirofacil.top',
        'atualizacao-urgente.net'
    ];

    const decodeBase64Url = (s: string) => {
        try {
            // Replace non-url compatible chars with base64 standard chars
            s = s.replace(/-/g, '+').replace(/_/g, '/');
            // Pad out with standard base64 required padding characters
            while (s.length % 4) {
                s += '=';
            }
            return atob(s);
        } catch (e) {
            console.error("Failed to decode base64url string:", s, e);
            return "Conteúdo não decodificável";
        }
    };

    const fetchGoogleChatLogs = async () => {
        const { googleWorkspaceToken, chatSpaceId } = settings.integrations;
        if (!googleWorkspaceToken || !chatSpaceId) {
            throw new Error("Token ou ID do Espaço do Chat do Google não encontrado.");
        }

        const response = await fetch(`https://chat.googleapis.com/v1/${chatSpaceId}/messages?pageSize=100`, {
            headers: {
                'Authorization': `Bearer ${googleWorkspaceToken}`,
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Falha ao buscar logs do Google Chat: ${errorData.error.message || response.statusText}`);
        }

        const data = await response.json();
        if (!data.messages || data.messages.length === 0) {
            return [];
        }
        
        return data.messages.map((msg: any) => ({
            user: msg.sender?.displayName || 'Desconhecido',
            message: msg.text || '',
            timestamp: msg.createTime,
        }));
    };
    
    const fetchGoogleVaultLogs = async () => {
        const { googleVaultToken } = settings.integrations;
        if (!googleVaultToken) {
            // Se não estiver conectado, retorna um array vazio.
            return [];
        }

        // Se estiver no modo de demonstração, retorna os logs simulados diretamente.
        if (googleVaultToken === 'DEMO_ACCESS_TOKEN') {
            console.log("Usando logs simulados do Google Vault para demonstração.");
            return SIMULATED_GOOGLE_VAULT_LOGS;
        }

        // --- Integração com API Real ---
        // Em uma aplicação real, a busca de dados do Vault é um processo assíncrono de múltiplas etapas:
        // 1. Criar um "matter" (um caso para a investigação).
        // 2. Criar uma "exportação" dentro desse matter, especificando os critérios de busca (ex: últimas 24 horas).
        // 3. Verificar o status da exportação até que ela seja concluída.
        // 4. Baixar os resultados.
        // Este fluxo é muito complexo para um botão "Verificar Agora" síncrono em um aplicativo frontend.
        // Como solução de compromisso, realizaremos uma chamada de API simples para verificar a conexão
        // e, em seguida, usaremos logs simulados para a análise de IA, a fim de demonstrar a capacidade.
        
        try {
            // Etapa 1: Verificar a conexão listando os "matters" existentes.
            const response = await fetch('https://vault.googleapis.com/v1/matters?pageSize=1', {
                headers: {
                    'Authorization': `Bearer ${googleVaultToken}`,
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                const errorData = await response.json();
                // Fornece um erro mais específico para problemas comuns de permissão.
                if (errorData.error?.status === 'PERMISSION_DENIED') {
                     throw new Error(`Falha ao conectar ao Google Vault: Permissão negada. Verifique se a API do Vault está habilitada e se o usuário tem as permissuições necessárias.`);
                }
                throw new Error(`Falha ao conectar ao Google Vault: ${errorData.error?.message || response.statusText}`);
            }
            
            // Se a conexão for bem-sucedida, registra no console e prossegue com dados simulados para a demonstração.
            console.log("Conexão com a API do Google Vault bem-sucedida. Usando logs simulados para a análise de IA.");
            
            // Etapa 2: Retorna logs simulados para análise.
            return SIMULATED_GOOGLE_VAULT_LOGS;

        } catch (e) {
            console.error("Erro na chamada da API do Google Vault:", e);
            throw e; // Relança o erro para ser capturado pelo handleScan
        }
    };
    
    const fetchGoogleDriveLogs = async () => {
        const { googleDriveToken, googleDriveUser } = settings.integrations;
        if (!googleDriveToken || !googleDriveUser) {
            return [];
        }
    
        const formatDriveActivity = (activity: any): { activity: string, timestamp: string } | null => {
            const target = activity.targets?.[0]?.driveItem;
            if (!target) return null; // Pular atividades sem um alvo claro
    
            const targetTitle = target.title || 'item desconhecido';
            const timestamp = activity.timestamp || (activity.timeRange ? activity.timeRange.endTime : new Date().toISOString());
            const action = activity.primaryActionDetail;
            let description = '';
    
            if (action.permissionChange) {
                const addedPermissions = action.permissionChange.addedPermissions || [];
    
                const publicShare = addedPermissions.find((p: any) => p.permission?.anyone);
                if (publicShare) {
                    description = `Usuário compartilhou o arquivo "${targetTitle}" com "Qualquer pessoa com o link".`;
                    return { activity: description, timestamp };
                }
    
                const ownershipChange = addedPermissions.find((p: any) => p.permission?.role === 'owner' && !p.permission.user?.knownUser?.isCurrentUser);
                if (ownershipChange) {
                    description = `Usuário transferiu a propriedade do item "${targetTitle}" para outro usuário.`;
                    return { activity: description, timestamp };
                }
                
                return null; // Ignorar outras alterações de permissão menores para reduzir o ruído
            }
    
            if (action.delete) {
                description = `O item "${targetTitle}" foi excluído.`;
                return { activity: description, timestamp };
            }
    
            return null; // Ignorar outros eventos como criar, editar, mover para focar em riscos
        };
    
        try {
            const response = await fetch('https://driveactivity.googleapis.com/v2/activity:query', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${googleDriveToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pageSize: 50 }), // Obter as últimas 50 atividades
            });
    
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Falha ao buscar logs do Google Drive: ${errorData.error.message || response.statusText}`);
            }
    
            const data = await response.json();
            if (!data.activities || data.activities.length === 0) {
                return [];
            }
    
            return data.activities
                .map(formatDriveActivity)
                .filter((log: any): log is { activity: string, timestamp: string } => log !== null)
                .map((log: { activity: string, timestamp: string }) => ({
                    user: googleDriveUser.email, // Atribuir atividade ao usuário verificado
                    activity: log.activity,
                    timestamp: log.timestamp,
                }));
    
        } catch (e) {
            console.error("Erro ao buscar logs do Google Drive:", e);
            throw e; // Re-lançar para ser pego pelo manipulador principal
        }
    };
    
    const fetchGmailLogs = async (): Promise<any[]> => {
        const { googleGmailToken } = settings.integrations;
        if (!googleGmailToken) {
            return [];
        }

        if (googleGmailToken === 'DEMO_ACCESS_TOKEN') {
            console.log("Usando logs simulados do Gmail para demonstração.");
            return SIMULATED_GMAIL_LOGS;
        }

        const oneDayAgo = Math.floor((new Date().getTime() - 24 * 60 * 60 * 1000) / 1000);
        const listResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=after:${oneDayAgo}`, {
            headers: { 'Authorization': `Bearer ${googleGmailToken}` },
        });

        if (!listResponse.ok) {
            const errorData = await listResponse.json();
            throw new Error(`Falha ao listar e-mails do Gmail: ${errorData.error.message || listResponse.statusText}`);
        }

        const listData = await listResponse.json();
        if (!listData.messages || listData.messages.length === 0) {
            return [];
        }

        const emailPromises = listData.messages.map(async (message: { id: string }) => {
            try {
                const msgResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`, {
                    headers: { 'Authorization': `Bearer ${googleGmailToken}` },
                });
                if (!msgResponse.ok) return null;

                const msgData = await msgResponse.json();
                const headers = msgData.payload.headers;
                const fromHeader = headers.find((h: any) => h.name === 'From');
                const subjectHeader = headers.find((h: any) => h.name === 'Subject');

                let body = '';
                if (msgData.payload.parts) {
                    const textPart = msgData.payload.parts.find((p: any) => p.mimeType === 'text/plain');
                    if (textPart && textPart.body.data) {
                        body = decodeBase64Url(textPart.body.data);
                    }
                } else if (msgData.payload.body.data) {
                    body = decodeBase64Url(msgData.payload.body.data);
                }

                return {
                    user: fromHeader ? fromHeader.value : 'Desconhecido',
                    subject: subjectHeader ? subjectHeader.value : 'Sem Assunto',
                    message: body || msgData.snippet,
                    timestamp: new Date(parseInt(msgData.internalDate)).toISOString(),
                };
            } catch (e) {
                console.error(`Falha ao processar e-mail com ID: ${message.id}`, e);
                return null;
            }
        });

        const emails = await Promise.all(emailPromises);
        return emails.filter((e): e is any => e !== null);
    };

    const sendAwsSesNotification = (alerts: Alert[], settings: Settings['notifications']) => {
        const { email, awsAccessKey, awsSecretKey, awsRegion } = settings;
        if (!email || !awsAccessKey || !awsSecretKey || !awsRegion) {
             console.warn("Notificação por e-mail pulada: As configurações do AWS SES (incluindo e-mail do destinatário e credenciais) não estão completas.");
             return;
        }

        const subject = `EXA Shield: ${alerts.length} Alerta(s) de Alta Severidade Detectado(s)`;
        const body = `
            Olá,
    
            O sistema EXA Shield detectou os seguintes alertas de alta severidade que requerem sua atenção imediata:
    
            ${alerts.map(alert => `
            - Categoria: ${alert.category}
            - Usuário: ${alert.user}
            - Fonte: ${alert.source}
            - Descrição: ${alert.description}
            - Log: "${alert.log}"
            - Horário: ${new Date(alert.timestamp).toLocaleString()}
            `).join('\n')}
    
            Recomenda-se uma investigação imediata.
    
            Atenciosamente,
            EXA Shield
        `;
    
        console.log("--- SIMULAÇÃO DE ENVIO DE E-MAIL via AWS SES ---");
        console.log("Para:", email);
        console.log("Região AWS:", awsRegion);
        console.log("Assunto:", subject);
        console.log("Corpo:", body);
        console.log("-------------------------------------------------");
    
        alert(`${subject}\n\nUma notificação por e-mail (simulada via AWS SES) seria enviada para ${email}. Verifique o console do desenvolvedor para mais detalhes.`);
    };


    const handleScan = useCallback(async () => {
        setLoading(true);
        setError('');
        setAlerts([]);

        if (!settings.integrations.googleWorkspace && !settings.integrations.googleVault && !settings.integrations.googleDrive && !settings.integrations.googleGmail) {
            const errorMsg = "Conecte-se a uma fonte de dados (Google Workspace, Vault, Drive ou Gmail) nas configurações para iniciar a análise.";
            setError(errorMsg);
            setLoading(false);
            addScanRecord({ status: 'Falha', alertsFound: 0, error: errorMsg });
            return;
        }
        
        if(settings.integrations.googleWorkspace && !settings.integrations.chatSpaceId){
            const errorMsg = "Por favor, insira um ID do Espaço do Google Chat na página de configurações.";
            setError(errorMsg);
            setLoading(false);
            addScanRecord({ status: 'Falha', alertsFound: 0, error: errorMsg });
            return;
        }

        const enabledCategories = Object.entries(settings.threatCategories)
            .filter(([, isEnabled]) => isEnabled)
            .map(([key]) => {
                if (key === 'dataLeakage') return "'Vazamento de Dados'";
                if (key === 'securityRisk') return "'Risco de Segurança'";
                if (key === 'internalThreat') return "'Ameaça Interna'";
                if (key === 'sentimentAnalysis') return "'Análise de Sentimento'";
                if (key === 'retentionAnalysis') return "'Análise de Retenção'";
                if (key === 'churnRisk') return "'Risco de Perda'";
                if (key === 'phishingMalware') return "'Phishing & Malware'";
                return '';
            }).join(', ');

        if (!enabledCategories) {
            const errorMsg = "Nenhuma categoria de ameaça está habilitada nas configurações.";
            setError(errorMsg);
            setLoading(false);
            addScanRecord({ status: 'Falha', alertsFound: 0, error: errorMsg });
            return;
        }
        
        try {
            let logsToAnalyze: any[] = [];
            const sourceParts: string[] = [];

            if (settings.integrations.googleWorkspace) {
                if (settings.integrations.googleWorkspaceToken === 'DEMO_ACCESS_TOKEN') {
                    logsToAnalyze.push(...SIMULATED_GOOGLE_CHAT_LOGS.map(log => ({ ...log, source: 'Google Chat' })));
                } else {
                    const chatLogs = await fetchGoogleChatLogs();
                    logsToAnalyze.push(...chatLogs.map(log => ({ ...log, source: 'Google Chat' })));
                }
                sourceParts.push("Google Chat");
            }
            if (settings.integrations.googleVault) {
                const vaultLogs = await fetchGoogleVaultLogs();
                logsToAnalyze.push(...vaultLogs.map(log => ({ ...log, source: 'Google Vault' })));
                sourceParts.push("Google Vault");
            }
            if (settings.integrations.googleDrive) {
                if (settings.integrations.googleDriveToken === 'DEMO_ACCESS_TOKEN') {
                    logsToAnalyze.push(...SIMULATED_GOOGLE_DRIVE_LOGS.map(log => ({ ...log, source: 'Google Drive' })));
                } else {
                    const driveLogs = await fetchGoogleDriveLogs();
                    logsToAnalyze.push(...driveLogs.map(log => ({ ...log, source: 'Google Drive' })));
                }
                sourceParts.push("Google Drive");
            }
             if (settings.integrations.googleGmail) {
                const gmailLogs = await fetchGmailLogs();
                logsToAnalyze.push(...gmailLogs.map(log => ({ ...log, source: 'Gmail' })));
                sourceParts.push("Gmail");
            }

            if (logsToAnalyze.length === 0) {
                 const errorMsg = "Nenhum log encontrado nas fontes de dados conectadas para analisar.";
                 setError(errorMsg);
                 setLoading(false);
                 addScanRecord({ status: 'Falha', alertsFound: 0, error: errorMsg });
                 return;
            }

            // Análise de reputação de URL
            const reputationResults: { url: string; isMalicious: boolean; reason: string }[] = [];
            if (settings.threatCategories.phishingMalware) {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                logsToAnalyze.forEach(log => {
                    const content = log.message || log.activity || '';
                    const urls = content.match(urlRegex);
                    if (urls) {
                        urls.forEach(url => {
                            try {
                                const hostname = new URL(url).hostname;
                                const isMalicious = SIMULATED_MALICIOUS_DOMAINS.some(maliciousDomain => hostname.endsWith(maliciousDomain));
                                if(isMalicious) {
                                    reputationResults.push({
                                        url,
                                        isMalicious: true,
                                        reason: `URL encontrada em lista de domínios maliciosos conhecidos (${hostname}).`
                                    });
                                }
                            } catch (e) {
                                // Ignorar URLs inválidas
                            }
                        });
                    }
                });
            }
            
            const logSourceText = sourceParts.length > 0 ? sourceParts.join(", ") : "logs de exemplo";
            
            let sentimentInstructions = '';
            if (settings.threatCategories.sentimentAnalysis) {
                sentimentInstructions = `
                Para a categoria 'Análise de Sentimento', identifique mensagens que expressem forte insatisfação, frustração, raiva ou desmoralização. Procure por padrões de comunicação negativa sobre a gestão, projetos ou o ambiente de trabalho. A severidade deve ser 'Baixa' para insatisfação geral e 'Média' ou 'Alta' se a linguagem indicar um risco potencial para a segurança ou coesão da equipe.`;
            }

            let keywordInstructions = '';
            if(settings.analysis.keywords.length > 0){
                keywordInstructions = `Dê atenção e prioridade MÁXIMA a qualquer log que contenha uma das seguintes palavras-chave definidas pela organização: ${settings.analysis.keywords.join(', ')}. A presença de uma dessas palavras aumenta significativamente a chance de ser um alerta relevante.`
            }

            const prompt = settings.analysis.prompts.logAnalysis
                .replace('{logSources}', logSourceText)
                .replace('{enabledCategories}', enabledCategories)
                .replace('{sentimentInstructions}', sentimentInstructions)
                .replace('{reputationResults}', JSON.stringify(reputationResults, null, 2))
                .replace('{keywordInstructions}', keywordInstructions)
                .replace('{logsToAnalyze}', JSON.stringify(logsToAnalyze, null, 2));

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const response = await ai.models.generateContent({
                model: settings.api.geminiModel,
                contents: prompt,
            });

            const rawJson = response.text.trim();
            const parsedAlerts: Alert[] = JSON.parse(rawJson).map((a: any) => ({
                ...a,
                timestamp: new Date().toISOString(), // Adiciona timestamp no momento da detecção
                originalLog: logsToAnalyze.find(log => (log.message || log.activity) === a.log) || a.log
            }));

            setAlerts(parsedAlerts);
            if(parsedAlerts.length > 0) {
                 addAlerts(parsedAlerts);
                 const highSeverityAlerts = parsedAlerts.filter(a => a.severity === 'Alta');
                 if(highSeverityAlerts.length > 0 && settings.notifications.enabled) {
                    sendAwsSesNotification(highSeverityAlerts, settings.notifications);
                 }
            }
            
            addScanRecord({ status: 'Sucesso', alertsFound: parsedAlerts.length });

        } catch (e: any) {
            console.error("Erro durante a análise de IA:", e);
            const errorMessage = e.message ? e.message : 'Ocorreu um erro desconhecido.';
            setError(`Falha na análise: ${errorMessage}. Verifique a chave da API, as configurações de integração e o console para mais detalhes.`);
            addScanRecord({ status: 'Falha', alertsFound: 0, error: errorMessage });
        } finally {
            setLoading(false);
        }
    }, [settings, addAlerts, addScanRecord]);
    
    useEffect(() => {
        if (settings.scanSchedule.type === 'manual') {
            return; // No schedule, do nothing.
        }
    
        const checkScheduleAndRun = () => {
            // Don't run if a manual scan is already in progress
            if (loading) {
                return;
            }
    
            const now = new Date();
            const [scheduleHours, scheduleMinutes] = settings.scanSchedule.time.split(':').map(Number);
    
            const timeMatches = now.getHours() === scheduleHours && now.getMinutes() === scheduleMinutes;
            if (!timeMatches) {
                return;
            }
    
            let dayMatches = false;
            if (settings.scanSchedule.type === 'daily') {
                dayMatches = true;
            } else if (settings.scanSchedule.type === 'weekly') {
                const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                const currentDayName = dayMap[now.getDay()];
                if (settings.scanSchedule.days.includes(currentDayName)) {
                    dayMatches = true;
                }
            }
    
            if (dayMatches) {
                const lastRunStorageKey = 'exa-shield-last-scheduled-run';
                // Unique key for the current time slot to prevent re-running within the same minute
                const currentRunSlotKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${settings.scanSchedule.time}`;
                
                const lastRunSlot = localStorage.getItem(lastRunStorageKey);
    
                if (lastRunSlot !== currentRunSlotKey) {
                    console.log(`[${new Date().toISOString()}] Triggering scheduled scan...`);
                    localStorage.setItem(lastRunStorageKey, currentRunSlotKey);
                    handleScan();
                }
            }
        };
        
        // Check immediately on component load and then every minute
        checkScheduleAndRun(); 
        const intervalId = setInterval(checkScheduleAndRun, 60000); // Check every 60 seconds
    
        return () => clearInterval(intervalId);
    }, [settings.scanSchedule, loading, handleScan]);

    const scanSummary = useMemo(() => {
        if (alerts.length === 0) return null;
        const summary = { 'Alta': 0, 'Média': 0, 'Baixa': 0 };
        alerts.forEach(alert => {
            summary[alert.severity]++;
        });
        return summary;
    }, [alerts]);

    return (
        <div className="p-8 text-white">
            <h1 className="text-3xl font-bold">Painel Principal</h1>
            <p className="text-slate-400 mt-1 mb-8">Inicie uma verificação para detectar ameaças e riscos de segurança.</p>

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg p-6 mb-8">
                <div>
                    <h2 className="text-xl font-semibold">Verificação de Segurança</h2>
                    <p className="text-slate-400 mt-1">Analise os logs das fontes de dados conectadas em busca de ameaças.</p>
                </div>
                <button
                    onClick={handleScan}
                    disabled={loading}
                    className="mt-4 md:mt-0 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white font-semibold py-2 px-6 rounded-md disabled:opacity-50 disabled:cursor-wait"
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analisando...
                        </>
                    ) : (
                        <>
                            <SearchIcon className="h-5 w-5"/>
                            Verificar Agora
                        </>
                    )}
                </button>
            </div>
            
            {error && (
                <div className="bg-red-900/50 border border-red-500/30 text-red-300 p-4 rounded-lg mb-8">
                    <p className="font-semibold">Erro na Verificação</p>
                    <p>{error}</p>
                </div>
            )}
            
            <h2 className="text-2xl font-semibold mb-4">Resultados da Última Análise</h2>
            
             {scanSummary && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-fade-in">
                     <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                        <h3 className="text-lg font-semibold text-slate-300">Total de Alertas</h3>
                        <p className="text-5xl font-bold text-sky-400 mt-2">{alerts.length}</p>
                    </div>
                    {Object.entries(scanSummary).map(([severity, count]) => (
                        <div key={severity} className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-center">
                            <h3 className="text-lg font-semibold text-slate-300">{severity}</h3>
                            <p className={`text-5xl font-bold mt-2 ${severity === 'Alta' ? 'text-red-400' : severity === 'Média' ? 'text-orange-400' : 'text-amber-400'}`}>{count}</p>
                        </div>
                    ))}
                </div>
            )}


            {loading ? (
                 <div className="text-center py-12">
                    <p className="text-slate-400">Analisando logs... Isso pode levar alguns segundos.</p>
                </div>
            ) : alerts.length === 0 && !error ? (
                <div className="text-center py-16 bg-slate-800/50 border border-slate-700 rounded-lg">
                    <ShieldCheckIcon className="mx-auto h-12 w-12 text-green-500" />
                    <h3 className="mt-2 text-lg font-semibold">Nenhuma Ameaça Detectada</h3>
                    <p className="mt-1 text-sm text-slate-400">Nenhum alerta foi gerado na última verificação.</p>
                </div>
            ) : (
                <InteractiveAlertsTable alerts={alerts} />
            )}

            <div className="mt-8">
                <h2 className="text-2xl font-semibold mb-4">Histórico de Varreduras</h2>
                {scanHistory.length === 0 ? (
                    <div className="text-center py-16 bg-slate-800/50 border border-slate-700 rounded-lg">
                        <ActivityIcon className="mx-auto h-12 w-12 text-slate-500" />
                        <h3 className="mt-2 text-lg font-semibold">Nenhuma Varredura Realizada</h3>
                        <p className="mt-1 text-sm text-slate-400">Clique em "Verificar Agora" para iniciar sua primeira análise.</p>
                    </div>
                ) : (
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
                        <div className="space-y-px">
                            {scanHistory.map((scan) => (
                                <div key={scan.id} className="flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-700/50 transition-colors">
                                    <div className="flex items-center gap-4">
                                        {scan.status === 'Sucesso' ? (
                                            <ShieldCheckIcon className="w-5 h-5 text-green-400 flex-shrink-0" />
                                        ) : (
                                            <AlertTriangleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                                        )}
                                        <div>
                                            <p className="font-semibold text-white">
                                                {new Date(scan.timestamp).toLocaleString('pt-BR')}
                                            </p>
                                            <p className="text-sm text-slate-400">
                                                {scan.status === 'Sucesso'
                                                    ? `${scan.alertsFound} alerta(s) detectado(s)`
                                                    : `Falha na varredura`}
                                            </p>
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                                        scan.status === 'Sucesso' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                    }`}>
                                        {scan.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
       <App />
    </AuthProvider>
  </React.StrictMode>
);