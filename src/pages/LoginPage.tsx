import React, { useState } from 'react';
import { ShieldCheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const Spinner = () => (
  <ArrowPathIcon className="h-5 w-5 animate-spin" />
);

const LoginPage = () => {
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

export default LoginPage;
