import React, { useState } from 'react';
import { useApp } from '../App';
import { motion } from 'motion/react';
import { Lock, User } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { setUser, setView } = useApp();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { error: 'Ocorreu um erro inesperado no servidor.' };
    }

    if (res.ok) {
      setUser(data.user);
      setView('LOBBY');
    } else {
      setError(data.error || 'Erro na autenticação.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md bg-slate-800 p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-700 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-blue-400" />
        
        <div className="text-center mb-10">
          <h2 className="text-4xl font-black text-white tracking-widest uppercase italic">Acesso</h2>
          <p className="text-slate-400 text-sm mt-2 font-medium">Bem-vindo a bisquinha do CFO XVII.</p>
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl mb-8 text-xs font-bold text-center uppercase tracking-widest">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Login</label>
            <div className="relative group">
              <User className="absolute left-4 top-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
              <input 
                type="text" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 pl-12 pr-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                placeholder="Ex: relamp_marquinhos"
                required
              />
            </div>
          </div>

          <div>
             <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Senha</label>
             <div className="relative group">
              <Lock className="absolute left-4 top-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
              <input 
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 pl-12 pr-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-900/20 active:scale-[0.97] uppercase text-xs tracking-[0.2em]"
          >
            Entrar
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-slate-700/50 text-center">
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest italic leading-relaxed">
            "Biquinha do CFO XVII: <br /> Toma helay, vai tomando!"
          </p>
        </div>
      </motion.div>
    </div>
  );
}
