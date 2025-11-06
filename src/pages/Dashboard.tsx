import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheckIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  SignalIcon,
  UserGroupIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { useApi } from '../hooks/useApi';

// Helper to format dates
const formatDate = (isoString: string | null) => {
  if (!isoString) return 'N/A';
  return new Date(isoString).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
};

const Spinner = () => (
  <ArrowPathIcon className="h-5 w-5 animate-spin" />
);

const SettingsPage = () => {
  const { data: settings, isLoading, error, execute: fetchSettings } = useApi('/api/settings');
  const { isLoading: isSaving, execute: saveSettings } = useApi('/api/settings', { method: 'POST' });
  const { isLoading: isRunning, execute: runAnalysis } = useApi('/api/run-analysis', { method: 'POST' });

  const [localSettings, setLocalSettings] = useState<any>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setLocalSettings((prev: any) => ({ ...prev, dataSources: { ...prev.dataSources, [name]: checked } }));
  };

  const handleKeywordsChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalSettings((prev: any) => ({ ...prev, keywords: e.target.value.split(',').map(k => k.trim()) }));
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalSettings((prev: any) => ({ ...prev, aiPrompt: e.target.value }));
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings((prev: any) => ({ ...prev, apiKey: e.target.value }));
  };

  const handleSesConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalSettings((prev: any) => ({
      ...prev,
      notifications: { ...prev.notifications, ses: { ...prev.notifications.ses, [name]: value } }
    }));
  };

  const handleVaultConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    // @ts-ignore
    const val = isCheckbox ? e.target.checked : value;
    setLocalSettings((prev: any) => ({ ...prev, [name]: val }));
  };

  const handleScheduleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocalSettings((prev: any) => ({ ...prev, schedule: e.target.value }));
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
        <h2 className="text-xl font-semibold text-white">Integração com Google Vault</h2>
        <p className="mt-1 text-slate-400">
          Habilite a coleta de dados do Google Vault para uma análise de segurança mais profunda.
        </p>
        <div className="mt-4 space-y-4 rounded-md border border-slate-700 bg-slate-800/50 p-4">
          <div className="flex items-center justify-between">
            <label htmlFor="vaultEnabled" className="flex-grow text-slate-200">Ativar Integração com Vault</label>
            <input
              id="vaultEnabled"
              name="vaultEnabled"
              type="checkbox"
              checked={!!localSettings.vaultEnabled}
              onChange={handleVaultConfigChange}
              className="h-6 w-11 rounded-full bg-slate-700 after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] checked:bg-sky-500 checked:after:translate-x-full checked:after:border-white focus:ring-sky-500"
            />
          </div>

          {localSettings.vaultEnabled && (
            <div className="animate-fade-in">
              <label htmlFor="vaultMatterId" className="block text-sm font-medium text-slate-300">ID da Matéria (Matter) do Vault</label>
              <input
                type="text"
                id="vaultMatterId"
                name="vaultMatterId"
                value={localSettings.vaultMatterId || ''}
                onChange={handleVaultConfigChange}
                className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
                placeholder="Ex: abc-123-def-456"
              />
            </div>
          )}
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
        <h2 className="text-xl font-semibold text-white">Configurações da Inteligência Artificial</h2>
        <p className="mt-1 text-slate-400">
          Personalize o prompt da IA e, opcionalmente, forneça sua própria chave da API do Google Gemini.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-slate-300">Chave da API do Google Gemini (Opcional)</label>
            <input
              type="password"
              id="apiKey"
              value={localSettings.apiKey || ''}
              onChange={handleApiKeyChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
              placeholder="Deixe em branco para usar a chave padrão"
            />
          </div>
          <div>
            <label htmlFor="aiPrompt" className="block text-sm font-medium text-slate-300">Prompt da IA</label>
            <textarea
              id="aiPrompt"
              value={localSettings.aiPrompt || ''}
              onChange={handlePromptChange}
              rows={8}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
              placeholder="Descreva como a IA deve analisar os logs..."
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-white">Configurações de Notificação (AWS SES)</h2>
        <p className="mt-1 text-slate-400">
          Configure o envio de alertas por e-mail via Amazon SES.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-y-4 gap-x-4 rounded-md border border-slate-700 bg-slate-800/50 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="sesEnabled" className="block text-sm font-medium text-slate-300">Status</label>
            <select
              id="sesEnabled"
              name="enabled"
              value={localSettings.notifications?.ses?.enabled || 'false'}
              onChange={handleSesConfigChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            >
              <option value="true">Ativado</option>
              <option value="false">Desativado</option>
            </select>
          </div>

          <div>
            <label htmlFor="sesAccessKey" className="block text-sm font-medium text-slate-300">AWS Access Key ID</label>
            <input
              type="password"
              id="sesAccessKey"
              name="accessKey"
              value={localSettings.notifications?.ses?.accessKey || ''}
              onChange={handleSesConfigChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor="sesSecretKey" className="block text-sm font-medium text-slate-300">AWS Secret Access Key</label>
            <input
              type="password"
              id="sesSecretKey"
              name="secretKey"
              value={localSettings.notifications?.ses?.secretKey || ''}
              onChange={handleSesConfigChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            />
          </div>

          <div>
            <label htmlFor="sesRegion" className="block text-sm font-medium text-slate-300">AWS Region</label>
            <input
              type="text"
              id="sesRegion"
              name="region"
              value={localSettings.notifications?.ses?.region || ''}
              onChange={handleSesConfigChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
              placeholder="us-east-1"
            />
          </div>

          <div>
            <label htmlFor="sesEmail" className="block text-sm font-medium text-slate-300">E-mail para Alertas</label>
            <input
              type="email"
              id="sesEmail"
              name="email"
              value={localSettings.notifications?.ses?.email || ''}
              onChange={handleSesConfigChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
              placeholder="alguem@example.com"
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-white">Automação da Análise</h2>
        <p className="mt-1 text-slate-400">
          Configure a frequência com que o EXA Shield deve verificar os logs automaticamente.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-y-4 gap-x-4 rounded-md border border-slate-700 bg-slate-800/50 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="scheduleEnabled" className="block text-sm font-medium text-slate-300">Análise Automática</label>
            <select
              id="scheduleEnabled"
              name="schedule"
              value={localSettings.schedule || 'disabled'}
              onChange={handleScheduleChange}
              className="mt-1 block w-full rounded-md border-slate-600 bg-slate-900 text-slate-200 shadow-sm focus:border-sky-500 focus:ring-sky-500"
            >
              <option value="disabled">Desativado</option>
              <option value="30m">A cada 30 minutos</option>
              <option value="1h">A cada hora</option>
              <option value="daily">Diariamente</option>
            </select>
          </div>
        </div>
      </div>

       <div>
        <h2 className="text-xl font-semibold text-white">Status da Análise Manual</h2>
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
            riskyUsers: Object.entries(userCounts).sort(([, countA], [, countB]) => Number(countB) - Number(countA)).slice(0, 3)
        };
    }, [alertsData]);

    const StatCard = ({ icon: Icon, title, value, colorClass }: { icon: React.ElementType, title: string, value: any, colorClass: string }) => (
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


const Dashboard = () => {
    const [currentPage, setCurrentPage] = useState('alerts');
    const { data: userData, execute: fetchUser } = useApi('/api/user');
    const { execute: doLogout } = useApi('/api/auth/logout', { method: 'POST' });

    useEffect(() => {
        fetchUser();
    }, [fetchUser]);

    const handleLogout = async () => {
        await doLogout();
        window.location.href = '/';
    };

    const NavItem = ({ icon: Icon, label, page, isActive }: { icon: React.ElementType, label: string, page: string, isActive: boolean }) => (
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
                            onClick={handleLogout}
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

export default Dashboard;
