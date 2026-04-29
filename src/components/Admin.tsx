import { useState, useEffect, FormEvent } from 'react';
import { useApp } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, UserMinus, UserPlus, Search, Crown, Key, X, Trash2 } from 'lucide-react';

export default function Admin() {
  const [activeTab, setActiveTab] = useState<'USERS' | 'ROOMS'>('USERS');
  const [users, setUsers] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [resetModal, setResetModal] = useState<{ id: string, name: string } | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', nickname: '', password: '' });
  const [newPassword, setNewPassword] = useState('');
  const { user: currentUser } = useApp();

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) return;
      const data = await res.json();
      setUsers(data || []);
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  };

  const fetchRooms = async () => {
    try {
      const res = await fetch('/api/admin/rooms/active');
      if (!res.ok) return;
      const data = await res.json();
      setRooms(data || []);
    } catch (e) {
      console.error('Failed to fetch active rooms:', e);
    }
  };

  useEffect(() => {
    if (activeTab === 'USERS') fetchUsers();
    else fetchRooms();
  }, [activeTab]);

  const toggleUser = async (userId: string, currentActive: boolean) => {
    if (userId === currentUser?.id) return alert('Você não pode se inativar!');
    const res = await fetch('/api/admin/users/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, active: !currentActive })
    });
    if (res.ok) fetchUsers();
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      setCreateModal(false);
      setNewUser({ username: '', nickname: '', password: '' });
      fetchUsers();
    } else {
      const data = await res.json();
      alert(data.error || 'Erro ao criar usuário');
    }
  };

  const promoteUser = async (userId: string, currentRole: string) => {
    if (userId === currentUser?.id) return alert('Você não pode alterar seu próprio nível daqui!');
    const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
    const msg = currentRole === 'ADMIN' ? 'Remover privilégios administrativos?' : 'Promover este usuário a Administrador?';
    if (!confirm(msg)) return;

    const res = await fetch('/api/admin/users/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: newRole })
    });
    if (res.ok) fetchUsers();
  };

  const handleResetPassword = async () => {
    if (!resetModal || newPassword.length < 4) return;
    const res = await fetch('/api/admin/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: resetModal.id, newPassword })
    });
    if (res.ok) {
      alert('Senha redefinida com sucesso!');
      setResetModal(null);
      setNewPassword('');
    } else {
      const data = await res.json();
      alert(data.error || 'Erro ao redefinir senha');
    }
  };

  const deleteUser = async (userId: string, username: string) => {
    if (!confirm(`Excluir permanentemente o usuário @${username}? Esta ação não pode ser desfeita.`)) return;
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    if (res.ok) fetchUsers();
    else {
      const data = await res.json();
      alert(data.error || 'Erro ao excluir usuário');
    }
  };

  const closeRoom = async (roomId: string) => {
    if (!confirm('Deseja realmente encerrar esta sala? Todos os jogadores nela serão expulsos.')) return;
    const res = await fetch('/api/admin/rooms/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId })
    });
    if (res.ok) fetchRooms();
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.username.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         u.nickname.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filter === 'ALL' || (filter === 'ACTIVE' ? u.is_active : !u.is_active);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter flex items-center gap-4 uppercase italic">
            <ShieldCheck size={40} className="text-blue-400" /> 
            Quartel General
          </h2>
          <p className="text-slate-500 mt-1 font-medium italic">Monitoramento e controle de acesso da rede Bisca.</p>
        </div>

        <div className="flex flex-wrap gap-2 md:gap-4 items-center">
          <div className="flex bg-slate-800 p-1 rounded-xl md:rounded-2xl border border-slate-700 shadow-xl w-full md:w-auto">
             {(['USERS', 'ROOMS'] as const).map(t => (
               <button 
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex-1 md:flex-none px-4 md:px-8 py-3 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'bg-slate-700 text-white border border-slate-600' : 'text-slate-500 hover:text-slate-200'}`}
               >
                  {t === 'USERS' ? 'Usuários' : 'Salas'}
               </button>
             ))}
          </div>

          {activeTab === 'USERS' && (
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              <button 
                onClick={() => setCreateModal(true)}
                className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 md:px-8 rounded-xl md:rounded-2xl transition-all shadow-xl shadow-blue-900/20 uppercase text-[9px] md:text-[10px] tracking-widest flex items-center justify-center gap-2 active:scale-95 whitespace-nowrap"
              >
                <UserPlus size={14} /> Novo Recruta
              </button>

              <div className="flex flex-1 md:flex-none bg-slate-800 p-1 rounded-xl md:rounded-2xl border border-slate-700 shadow-xl overflow-x-auto whitespace-nowrap scrollbar-hide">
                 {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map(f => (
                   <button 
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`flex-1 md:flex-none px-4 md:px-6 py-3 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all ${filter === f ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
                   >
                      {f === 'ALL' ? 'Todos' : f === 'ACTIVE' ? 'Ativos' : 'Inativos'}
                   </button>
                 ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-800 rounded-[2.5rem] border border-slate-700 overflow-hidden shadow-2xl relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-blue-400 opacity-50" />
        
        {activeTab === 'USERS' ? (
          <>
            <div className="p-8 border-b border-slate-700/50 bg-slate-800/50 backdrop-blur">
              <div className="relative group">
                <Search className="absolute left-4 top-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={20} />
                <input 
                  type="text" 
                  placeholder="Localizar agente pelo nome ou apelido..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 pl-14 pr-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">
                    <th className="px-8 py-6">Identidade</th>
                    <th className="px-8 py-6 text-center">Nível</th>
                    <th className="px-8 py-6 text-center">Status</th>
                    <th className="px-8 py-6">Alistamento</th>
                    <th className="px-8 py-6 text-right">Diretriz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-slate-900/30 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                          <span className="font-black text-white uppercase text-sm tracking-tight">{u.username}</span>
                          <span className="text-xs text-slate-500 font-medium">{u.nickname}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-center">
                         <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border inline-block ${u.role === 'ADMIN' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/30'}`}>
                           {u.role}
                         </span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center justify-center gap-3">
                           <div className={`w-2 h-2 rounded-full ring-4 ${u.is_active ? 'bg-emerald-500 ring-emerald-500/20' : 'bg-red-500 ring-red-500/20'}`} />
                           <span className={`text-[10px] font-black uppercase tracking-widest ${u.is_active ? 'text-emerald-500' : 'text-red-500'}`}>{u.is_active ? 'Ativo' : 'Retido'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-slate-500 font-mono text-xs">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button 
                            onClick={() => promoteUser(u.id, u.role)}
                            className={`p-3 transition rounded-xl border ${u.role === 'ADMIN' ? 'text-purple-400 border-purple-500/20 hover:bg-purple-500/10' : 'text-slate-400 border-slate-700 hover:text-purple-400 hover:border-purple-500/30'}`}
                            title={u.role === 'ADMIN' ? 'Retirar Admin' : 'Promover a Admin'}
                          >
                            <Crown size={18} />
                          </button>
                          
                          <button 
                            onClick={() => setResetModal({ id: u.id, name: u.username })}
                            className="p-3 transition rounded-xl border text-slate-400 border-slate-700 hover:text-blue-400 hover:border-blue-500/30"
                            title="Redefinir Senha"
                          >
                            <Key size={18} />
                          </button>

                          <button
                            onClick={() => toggleUser(u.id, !!u.is_active)}
                            className={`p-3 transition rounded-xl border ${u.is_active ? 'text-red-400 border-red-500/20 hover:bg-red-500/10' : 'text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10'}`}
                            title={u.is_active ? 'Bloquear' : 'Desbloquear'}
                          >
                            {u.is_active ? <UserMinus size={18} /> : <UserPlus size={18} />}
                          </button>

                          {u.id !== currentUser?.id && u.username !== 'admin' && (
                            <button
                              onClick={() => deleteUser(u.id, u.username)}
                              className="p-3 transition rounded-xl border text-slate-600 border-slate-700/50 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5"
                              title="Excluir permanentemente"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {filteredUsers.length === 0 && (
                <div className="p-24 text-center">
                  <Search size={48} className="mx-auto text-slate-800 mb-4" />
                  <p className="text-slate-500 font-bold uppercase tracking-widest text-sm italic">Nenhum registro encontrado no banco de dados.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/50 text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">
                  <th className="px-8 py-6">Sala</th>
                  <th className="px-8 py-6 text-center">Ocupantes</th>
                  <th className="px-8 py-6 text-center">Engine Status</th>
                  <th className="px-8 py-6">Configuração</th>
                  <th className="px-8 py-6 text-right">Controle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {rooms.map(r => (
                  <tr key={r.id} className="hover:bg-slate-900/30 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="font-black text-white uppercase text-sm tracking-tight">{r.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{r.id}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-center">
                       <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border inline-block ${r.playerCount > 0 ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30 animate-pulse'}`}>
                         {r.playerCount} / 4 Ativos
                       </span>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex items-center justify-center gap-3">
                         <div className={`w-2 h-2 rounded-full ring-4 ${r.active ? 'bg-emerald-500 ring-emerald-500/20' : 'bg-red-500 ring-red-500/20'}`} />
                         <span className={`text-[10px] font-black uppercase tracking-widest ${r.active ? 'text-emerald-500' : 'text-red-500'}`}>{r.active ? 'Em Memória' : 'Persistida'}</span>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-slate-500 font-black text-[10px] uppercase">
                      Meta: {r.score_goal} Pontos
                    </td>
                    <td className="px-8 py-6 text-right">
                      <button 
                        onClick={() => closeRoom(r.id)}
                        className="p-3 transition rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10"
                        title="Encerrar Sala"
                      >
                        <X size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {rooms.length === 0 && (
              <div className="p-24 text-center">
                <ShieldCheck size={48} className="mx-auto text-slate-800 mb-4" />
                <p className="text-slate-500 font-bold uppercase tracking-widest text-sm italic">Nenhuma sala ativa detectada pelos radares.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {createModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[120] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-800 w-full max-w-md p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl relative"
            >
              <button 
                onClick={() => setCreateModal(false)}
                className="absolute top-6 right-6 text-slate-500 hover:text-white transition"
              >
                <X size={24} />
              </button>

              <h3 className="text-2xl font-black text-white mb-2 uppercase italic">Novo Recruta</h3>
              <p className="text-slate-400 text-sm mb-8 font-medium">Cadastre um novo usuário no sistema.</p>

              <form onSubmit={handleCreateUser} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Usuário (Login)</label>
                  <input 
                    type="text"
                    required
                    value={newUser.username}
                    onChange={e => setNewUser({...newUser, username: e.target.value})}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 px-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Apelido (Mesa)</label>
                  <input 
                    type="text"
                    required
                    value={newUser.nickname}
                    onChange={e => setNewUser({...newUser, nickname: e.target.value})}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 px-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Chave de Segurança</label>
                  <input 
                    type="password"
                    required
                    value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 px-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                  />
                </div>

                <button 
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-900/20 uppercase text-xs tracking-widest"
                >
                  Concluir Cadastro
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {resetModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[120] p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-800 w-full max-w-md p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl relative"
            >
              <button 
                onClick={() => setResetModal(null)}
                className="absolute top-6 right-6 text-slate-500 hover:text-white transition"
              >
                <X size={24} />
              </button>

              <h3 className="text-2xl font-black text-white mb-2 uppercase italic">Ajuste de Chave</h3>
              <p className="text-slate-400 text-sm mb-8 font-medium">Redefinindo acesso para o usuário <span className="text-blue-400 font-bold">@{resetModal.name}</span></p>

              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 ml-2">Nova Chave de Segurança</label>
                  <input 
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl py-4 px-6 text-white font-bold focus:outline-none focus:border-blue-500 transition-all placeholder:text-slate-700"
                    placeholder="Mínimo 4 caracteres"
                  />
                </div>

                <button 
                  onClick={handleResetPassword}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-900/20 uppercase text-xs tracking-widest"
                >
                  Confirmar Redefinição
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
