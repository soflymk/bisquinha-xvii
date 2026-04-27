import React, { useState } from 'react';
import { useApp } from '../App';
import { motion } from 'motion/react';
import { User, Key, Check } from 'lucide-react';

export default function Profile() {
  const { user, setUser } = useApp();
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '' });
  const [error, setError] = useState('');

  const updateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/me/update-nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      });
      
      if (res.ok) {
        if (user) setUser({ ...user, nickname });
        setMessage('Perfil atualizado com sucesso!');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          currentPassword: passwords.current, 
          newPassword: passwords.new 
        })
      });

      if (res.ok) {
        setMessage('Senha alterada com sucesso!');
        setShowPasswordModal(false);
        setPasswords({ current: '', new: '' });
        setTimeout(() => setMessage(''), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Erro ao alterar senha');
      }
    } catch (e) {
      setError('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center pt-20 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md bg-slate-800 p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-blue-400" />

        <div className="flex justify-center mb-10">
           <div className="w-24 h-24 bg-slate-900 rounded-full border-4 border-blue-500/30 flex items-center justify-center text-4xl font-black text-blue-400 shadow-2xl relative group">
              {user?.nickname[0].toUpperCase()}
              <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-blue-600 rounded-full border-4 border-slate-800 flex items-center justify-center">
                <Check size={14} className="text-white" />
              </div>
           </div>
        </div>

        <div className="text-center mb-10">
          <h2 className="text-3xl font-black text-white tracking-widest uppercase italic">Perfil</h2>
          <p className="text-slate-400 text-sm mt-2 font-medium">Personalize sua presença nas mesas.</p>
        </div>

        {message && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-2xl mb-8 text-xs font-bold text-center uppercase tracking-widest flex items-center justify-center gap-3">
            <Check size={16} /> {message}
          </div>
        )}

        <form onSubmit={updateProfile} className="space-y-8">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Identificador (Imutável)</label>
            <input 
              type="text" 
              value={user?.username}
              disabled
              className="w-full bg-slate-900/50 border-2 border-slate-700/50 rounded-2xl p-4 text-slate-600 font-bold cursor-not-allowed italic"
            />
          </div>

          <div>
             <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Pseudônimo na Mesa</label>
             <div className="relative group">
              <User className="absolute left-4 top-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={18} />
              <input 
                type="text" 
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 pl-12 pr-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all"
                placeholder="Como quer ser chamado?"
                required
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-900/20 active:scale-[0.97] uppercase text-xs tracking-[0.2em] disabled:opacity-50"
          >
            {loading ? 'Sincronizando...' : 'Confirmar Alterações'}
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-slate-700/50 text-center">
           <button 
             onClick={() => setShowPasswordModal(true)}
             className="text-slate-500 hover:text-blue-400 transition-colors text-[10px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 mx-auto"
           >
             <Key size={14} /> Redefinir Senha
           </button>
        </div>

        {/* Modal Troca Senha */}
        {showPasswordModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[110] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-800 w-full max-w-md p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl"
            >
              <h3 className="text-2xl font-black text-white mb-2 uppercase italic">Manutenção de Acesso</h3>
              <p className="text-slate-400 text-sm mb-8 font-medium">Atualize sua chave de segurança pessoal.</p>
              
              <form onSubmit={handlePasswordChange} className="space-y-6">
                {error && <div className="text-red-400 text-[10px] font-bold uppercase text-center">{error}</div>}
                
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Chave Atual</label>
                  <input 
                    type="password" 
                    required
                    value={passwords.current}
                    onChange={e => setPasswords({...passwords, current: e.target.value})}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 text-white font-bold focus:outline-none focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Nova Chave</label>
                  <input 
                    type="password" 
                    required
                    value={passwords.new}
                    onChange={e => setPasswords({...passwords, new: e.target.value})}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 text-white font-bold focus:outline-none focus:border-blue-500 transition-all"
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    className="flex-1 bg-slate-700 text-slate-300 font-black py-4 rounded-2xl uppercase text-[10px] tracking-widest"
                  >
                    Voltar
                  </button>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-blue-900/20 uppercase text-[10px] tracking-widest"
                  >
                    Confirmar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
