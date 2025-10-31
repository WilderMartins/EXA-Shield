
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ShieldCheckIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  InformationCircleIcon,
  SignalIcon,
  ChevronDownIcon,
  UserGroupIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

// Helper to format dates
const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
};

// Custom hook for API calls
const useApi = <T,>(endpoint: string, options: RequestInit = {}) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(async (body: any = null) => {
    setIsLoading(true);
    setError(null);
    try {
      const finalHeaders = new Headers({ 'Content-Type': 'application/json' });
      if (options.headers) {
        new Headers(options.headers).forEach((value, key) => {
          finalHeaders.set(key, value);
        });
      }
      
      const response = await fetch(endpoint, {
        ...options,
        headers: finalHeaders,
        body: body ? JSON.stringify(body) : null,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error ${response.status}`);
      }
      // Handle no-content responses (e.g., logout)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null;
      }
      const result = await response.json();
      setData(result);
      return result;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [endpoint, JSON.stringify(options)]);

  return { data, error, isLoading, execute };
};

// --- Components ---

const Spinner = () => (
  <ArrowPathIcon className="h-5 w-5 animate-spin" />
);

const OnboardingWizard = () => {
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConnect = async () => {
        setIsRedirecting(true);
        setError(null);
        try {
            const response = await fetch('/api/auth/google');
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Falha ao obter URL de autenticação.');
            }
            const data = await response.json();
            if (data.authUrl) {
                window.location.href = data.authUrl;
            } else {
                throw new Error('URL de autenticação não recebida.');
            }
        } catch (err) {
            setError((err as Error).message);
            setIsRedirecting(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900">
            <div className="w-full max-w-xl rounded-lg bg-slate-800 p-8 shadow-2xl">
                <div className="flex items-center space-x-4">
                    <ShieldCheckIcon className="h-10 w-10 text-sky-400" />
                    <div>
                        <h1 className="text-2xl font-bold text-white">Bem-vindo ao EXA Shield</h1>
                        <p className="text-slate-400">Detector de Ameaças Internas para Google Workspace</p>
                    </div>
                </div>

                <div className="mt-8">
                    <div className="animate-fade-in">
                        <h2 className="text-lg font-semibold text-white">Passo 1: Conectar sua Conta Google</h2>
                        <p className="mt-2 text-slate-300">
                            Para começar a monitorar atividades, o EXA Shield precisa de permissão para acessar os logs do Google Workspace de forma segura. Nenhuma credencial é armazenada.
                        </p>
                        <button
                            onClick={handleConnect}
                            disabled={isRedirecting}
                            className="mt-6 flex w-full items-center justify-center space-x-2 rounded-md bg-sky-500 px-4 py-2.5 font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-sky-600/50"
                        >
                            {isRedirecting ? (
                                <>
                                    <Spinner />
                                    <span>Redirecionando...</span>
                                </>
                            ) : (
                                'Conectar com Google'
                            )}
                        </button>
                        {error && <p className="mt-4 text-center text-sm text-red-400">{error}</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const SettingsPage = () => {
  const { data: settings, isLoading, error, execute: fetchSettings } = useApi('/api/settings');
  const { isLoading: isSaving, execute: saveSettings } = useApi('/api/settings', { method: 'POST' });
  const { isLoading: isRunning, execute: runAnalysis } = useApi('/api/run-analysis', { method: 'POST' });

  const [localSettings, setLocalSettings] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);
  
  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setLocalSettings(prev => ({ ...prev, dataSources: { ...prev.dataSources, [name]: checked } }));
  };

  const handleKeywordsChange = (e) => {
    setLocalSettings(prev => ({ ...prev, keywords: e.target.value.split(',').map(k => k.trim()) }));
  };

  const handleSave = async () => {
    await saveSettings(localSettings);
    fetchSettings();
  };

  const handleRunNow = async () => {
    await runAnalysis();
    const interval = setInterval(async () => {
      const updatedSettings = await fetchSettings();
      if (!updatedSettings?.isAnalysisRunning) {
        clearInterval(interval);
      }
    }, 2000);
  };
  
  if (isLoading && !localSettings) return <div className="p-8"><Spinner /> Carregando configurações...</div>;
  if (error) return <div className="p-8 text-red-500">Erro: {error}</div>;
  if (!localSettings) return null;

  return (
    <div className="animate-fade-in space-y-8 p-8">
      <div>
        <h2 className="text-xl font-semibold text-white">Fontes de Dados</h2>
        <p className="mt-1 text-slate-400">Selecione quais serviços do Google Workspace devem ser monitorados.</p>
        <div className="mt-4 space-y-3 rounded-md border border-slate-700 bg-slate-800/50 p-4">
          {Object.keys(localSettings.dataSources).map((source) => (
            <label key={source} className="flex items-center space-x-3">
              <input
                type="checkbox"
                name={source}
                checked={localSettings.dataSources[source]}
                onChange={handleCheckboxChange}
                className="h-5 w-5 rounded border-slate-600 bg-slate-700 text-sky-500 focus:ring-sky-500"
              />
              <span className="capitalize text-slate-200">{source}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-white">Palavras-chave de Risco</h2>
        <p className="mt-1 text-slate-400">
          Insira termos sensíveis (separados por vírgula) para uma detecção mais precisa.
        </p>
        <textarea
          value={localSettings.keywords.join(', ')}
          onChange={handleKeywordsChange}
          rows={4}
          className="mt-4 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          placeholder="Ex: confidencial, senha, CPF, projeto_secreto"
        />
      </div>

       <div>
        <h2 className="text-xl font-semibold text-white">Status da Automação</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 rounded-md border border-slate-700 bg-slate-800/50 p-4 sm:grid-cols-3">
           <div className="flex items-center space-x-3">
             <SignalIcon className={`h-8 w-8 ${localSettings.isAnalysisRunning ? 'text-sky-400 animate-pulse' : 'text-green-500'}`} />
             <div>
               <p className="text-sm text-slate-400">Status</p>
               <p className="font-semibold">{localSettings.isAnalysisRunning ? 'Analisando...' : 'Ocioso'}</p>
             </div>
           </div>
           <div className="flex items-center space-x-3">
             <ArrowPathIcon className="h-8 w-8 text-slate-400" />
             <div>
               <p className="text-sm text-slate-400">Última Verificação</p>
               <p className="font-semibold">{formatDate(localSettings.lastRunTimestamp)}</p>
             </div>
           </div>
           <button
             onClick={handleRunNow}
             disabled={isRunning || localSettings.isAnalysisRunning}
             className="flex items-center justify-center rounded-md bg-slate-600 px-4 py-2 font-semibold text-white transition hover:bg-slate-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:opacity-50"
            >
             {isRunning || localSettings.isAnalysisRunning ? <Spinner /> : 'Verificar Agora'}
           </button>
        </div>
      </div>
      
      <div className="border-t border-slate-700 pt-6">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex w-full items-center justify-center rounded-md bg-sky-500 px-4 py-2.5 font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto"
        >
          {isSaving ? <Spinner /> : 'Salvar Alterações'}
        </button>
      </div>
    </div>
  );
};

const AlertsDashboard = () => {
    const { data: alertsData, isLoading, error, execute: fetchAlerts } = useApi<{
      alerts: {
        id: string;
        title: string;
        user: string;
        severity: 'Baixa' | 'Média' | 'Alta';
        timestamp: string;
        reasoning: string;
        evidence: any;
      }[];
    }>('/api/alerts');
    const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

    useEffect(() => {
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 30000); // Auto-refresh
        return () => clearInterval(interval);
    }, []);

    const severityStyles = {
        'Baixa': 'bg-sky-500/20 text-sky-300 border-sky-500/30',
        'Média': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        'Alta': 'bg-red-500/20 text-red-300 border-red-500/30',
    };

    const stats = useMemo(() => {
        if (!alertsData?.alerts) return { total: 0, high: 0, medium: 0, low: 0, riskyUsers: [] };
        const alerts = alertsData.alerts;
        const userCounts = alerts.reduce<Record<string, number>>((acc, alert) => {
            acc[alert.user] = (acc[alert.user] || 0) + 1;
            return acc;
        }, {});

        return {
            total: alerts.length,
            high: alerts.filter(a => a.severity === 'Alta').length,
            medium: alerts.filter(a => a.severity === 'Média').length,
            low: alerts.filter(a => a.severity === 'Baixa').length,
            // FIX: Explicitly convert values to numbers for sorting to avoid potential TypeScript type errors.
            riskyUsers: Object.entries(userCounts).sort(([, countA], [, countB]) => Number(countB) - Number(countA)).slice(0, 3)
        };
    }, [alertsData]);

    const StatCard = ({ icon: Icon, title, value, colorClass }) => (
        <div className="rounded-lg bg-slate-800/50 p-4">
            <div className="flex items-center space-x-3">
                <div className={`rounded-md p-2 ${colorClass}`}>
                    <Icon className="h-6 w-6 text-white" />
                </div>
                <div>
                    <p className="text-sm text-slate-400">{title}</p>
                    <p className="text-2xl font-bold text-white">{value}</p>
                </div>
            </div>
        </div>
    );

    if (isLoading && !alertsData) return <div className="p-8"><Spinner/> Carregando dashboard...</div>;
    if (error) return <div className="p-8 text-red-500">Erro: {error}</div>;

    return (
        <div className="animate-fade-in p-8">
            <h1 className="text-2xl font-bold text-white">Dashboard de Ameaças</h1>
            <p className="mt-1 text-slate-400">Visão geral dos riscos identificados no seu ambiente.</p>
            
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={ExclamationTriangleIcon} title="Total de Alertas" value={stats.total} colorClass="bg-sky-500" />
                <StatCard icon={ExclamationTriangleIcon} title="Severidade Alta" value={stats.high} colorClass="bg-red-500" />
                <StatCard icon={ChartBarIcon} title="Severidade Média" value={stats.medium} colorClass="bg-amber-500" />
                <StatCard icon={UserGroupIcon} title="Usuários em Risco" value={stats.riskyUsers.length} colorClass="bg-slate-600" />
            </div>

            <div className="mt-8">
                 <h2 className="text-xl font-semibold text-white">Lista de Alertas Recentes</h2>
                 <div className="mt-4 space-y-3">
                    {(!alertsData || alertsData.alerts.length === 0) ? (
                        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/50 py-16 text-center">
                            <CheckCircleIcon className="h-12 w-12 text-green-500"/>
                            <h3 className="mt-4 text-lg font-medium text-white">Nenhuma Ameaça Detectada</h3>
                            <p className="mt-1 text-slate-400">Seu ambiente está seguro. Nenhuma atividade suspeita foi encontrada.</p>
                        </div>
                    ) : (
                        alertsData.alerts.map((alert) => (
                            <div key={alert.id} className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800/50 transition-all duration-300">
                                <button 
                                    onClick={() => setExpandedAlertId(expandedAlertId === alert.id ? null : alert.id)} 
                                    className="flex w-full items-center justify-between p-4 text-left"
                                    aria-expanded={expandedAlertId === alert.id}
                                    aria-controls={`alert-details-${alert.id}`}
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-3">
                                            <ExclamationTriangleIcon className={`h-6 w-6 flex-shrink-0 ${severityStyles[alert.severity].replace(/bg-.*?\s/g, '')}`}/>
                                            <h3 className="text-md font-semibold text-white">{alert.title}</h3>
                                        </div>
                                        <p className="mt-1 text-sm text-slate-400">Usuário: {alert.user}</p>
                                    </div>
                                    <div className="flex flex-shrink-0 items-center space-x-4 sm:ml-6">
                                         <span className={`hidden sm:inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${severityStyles[alert.severity]}`}>
                                            {alert.severity}
                                        </span>
                                        <span className="hidden text-sm text-slate-400 md:block">{formatDate(alert.timestamp)}</span>
                                        <ChevronDownIcon className={`h-5 w-5 text-slate-400 transition-transform ${expandedAlertId === alert.id ? 'rotate-180' : ''}`} />
                                    </div>
                                </button>
                                {expandedAlertId === alert.id && (
                                    <div id={`alert-details-${alert.id}`} className="animate-fade-in border-t border-slate-700 bg-slate-900/50 p-4">
                                        <h4 className="font-semibold text-slate-200">Análise da IA (Por que isso é um risco?)</h4>
                                        <div className="prose prose-sm prose-invert mt-2 max-w-none text-slate-300" dangerouslySetInnerHTML={{ __html: alert.reasoning.replace(/\n/g, '<br />') }} />

                                        <h4 className="mt-4 font-semibold text-slate-200">Evidências (Logs Analisados)</h4>
                                        <pre className="mt-2 w-full overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-300">
                                            {JSON.stringify(alert.evidence, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                 </div>
            </div>
        </div>
    );
};


const MainApp = ({ onLogout }) => {
    const [currentPage, setCurrentPage] = useState('alerts');
    const { data: userData, execute: fetchUser } = useApi('/api/user');
    
    useEffect(() => { fetchUser() }, []);

    const NavItem = ({ icon: Icon, label, page, isActive }) => (
        <button
            onClick={() => setCurrentPage(page)}
            className={`flex w-full items-center space-x-3 rounded-md px-3 py-2 text-left text-sm font-medium transition ${
                isActive ? 'bg-sky-500/10 text-sky-400' : 'text-slate-300 hover:bg-slate-700'
            }`}
        >
            <Icon className="h-5 w-5"/>
            <span>{label}</span>
        </button>
    );

    return (
        <div className="flex h-screen bg-slate-900">
            <aside className="flex w-64 flex-col border-r border-slate-800 bg-slate-900/80 p-4">
                <div className="flex items-center space-x-3 px-2">
                    <ShieldCheckIcon className="h-8 w-8 text-sky-400"/>
                    <span className="text-lg font-bold text-white">EXA Shield</span>
                </div>
                <nav className="mt-8 flex-1 space-y-2">
                    <NavItem icon={ExclamationTriangleIcon} label="Dashboard" page="alerts" isActive={currentPage === 'alerts'}/>
                    <NavItem icon={Cog6ToothIcon} label="Configurações" page="settings" isActive={currentPage === 'settings'}/>
                </nav>
                <div className="border-t border-slate-700 pt-4">
                     <div className="flex items-center space-x-3 rounded-md p-2">
                        <img className="h-8 w-8 rounded-full" src={userData?.picture} alt="User avatar" />
                        <div className="flex-1 truncate">
                            <p className="text-sm font-semibold text-white">{userData?.name}</p>
                            <p className="text-xs text-slate-400">{userData?.email}</p>
                        </div>
                        <button
                            onClick={onLogout}
                            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                            title="Sair da conta"
                            aria-label="Sair da conta"
                        >
                          <ArrowRightOnRectangleIcon className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto bg-slate-800/30">
                {currentPage === 'alerts' && <AlertsDashboard/>}
                {currentPage === 'settings' && <SettingsPage/>}
            </main>
        </div>
    );
};

const App = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const { data, isLoading, execute } = useApi<{ hasToken: boolean }>('/api/auth/status');
    const { execute: doLogout } = useApi('/api/auth/logout', { method: 'POST' });

    useEffect(() => {
        execute();
    }, []);

    useEffect(() => {
        if (data?.hasToken) {
            setIsAuthenticated(true);
        } else if (data?.hasToken === false) {
            setIsAuthenticated(false);
        }
    }, [data]);
    
    const handleLogout = async () => {
        await doLogout();
        setIsAuthenticated(false);
    };

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-900">
                <Spinner />
            </div>
        );
    }
    
    if (isAuthenticated) {
        return <MainApp onLogout={handleLogout} />;
    }

    return <OnboardingWizard />;
};


const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
