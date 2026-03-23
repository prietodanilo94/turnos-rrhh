import { createContext, useContext, useState, useEffect } from 'react';
import api, { storage } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentBranchId, setCurrentBranchId] = useState(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = storage.get('user');
    const token = storage.get('access_token');
    if (stored && token) {
      const u = JSON.parse(stored);
      setUser(u);
      setCurrentBranchId(u.default_branch_id || u.branches?.[0]?.id || null);
    }
    setLoading(false);
  }, []);

  const login = async (rut, password) => {
    const data = await api.auth.login(rut, password);
    storage.set('access_token', data.access_token);
    storage.set('refresh_token', data.refresh_token);
    storage.set('user', JSON.stringify(data.user));
    setUser(data.user);
    setCurrentBranchId(data.user.default_branch_id || data.user.branches?.[0]?.id || null);
    return data;
  };

  const logout = () => {
    storage.clear();
    setUser(null);
    setCurrentBranchId(null);
    window.location.href = '/login';
  };

  const switchBranch = (branchId) => {
    setCurrentBranchId(branchId);
  };

  const currentBranch = user?.branches?.find(b => b.id === currentBranchId) || user?.branches?.[0] || null;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, currentBranch, currentBranchId, switchBranch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
