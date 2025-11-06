import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const { execute: checkStatus } = useApi('/api/auth/status');

  useEffect(() => {
    const verifyUser = async () => {
      const status = await checkStatus();
      setIsAuthenticated(status?.isAuthenticated || false);
    };
    verifyUser();
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        {/* You might want a spinner here */}
        <p className="text-white">Verificando autenticação...</p>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/" />;
};

export default ProtectedRoute;
