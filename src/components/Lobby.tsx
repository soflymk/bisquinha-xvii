import { useState, useEffect } from 'react';
import { useApp } from '../App';
import { motion } from 'motion/react';
import { Plus, Users, Play, Clock, Trophy, X } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  score_goal: number;
  time_limit: number;
  playerCount: number;
  spectatorCount: number;
  allowSpectators: boolean;
  status: string;
}

export default function Lobby() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showModal, setShowModal] = useState(false);
  const { setView, setCurrentRoomId, socket, user } = useApp();
  
  // Create room state
  const [newRoomName, setNewRoomName] = useState('');
  const [scoreGoal, setScoreGoal] = useState(5);
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [spectatorsSeeHands, setSpectatorsSeeHands] = useState(false);

  const fetchRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) return;
      const data = await res.json();
      setRooms(data || []);
    } catch (e) {
      console.error('Failed to fetch rooms:', e);
    }
  };

  useEffect(() => {
    fetchRooms();
    
    if (socket) {
      socket.on('rooms_updated', fetchRooms);
    }

    const interval = setInterval(fetchRooms, 5000);
    return () => {
      clearInterval(interval);
      if (socket) socket.off('rooms_updated', fetchRooms);
    };
  }, [socket]);

  const createRoom = async () => {
    if (!newRoomName) return;
    try {
      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomName, scoreGoal, timeLimit: 0, allowSpectators, spectatorsSeeHands })
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentRoomId(data.roomId);
        setView('GAME');
      }
    } catch (e) {
      console.error('Failed to create room:', e);
    }
  };

  const joinRoom = (id: string) => {
    setCurrentRoomId(id);
    setView('GAME');
  };

  const closeRoom = async (roomId: string) => {
    if (!confirm('Deseja realmente encerrar esta sala? Todos os jogadores nela serão expulsos.')) return;
    try {
      const res = await fetch('/api/admin/rooms/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      });
      if (res.ok) fetchRooms();
    } catch (e) {
      console.error('Failed to close room:', e);
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto p-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter uppercase italic">Mesas Disponíveis</h2>
          <p className="text-slate-500 mt-1 font-medium">Buscando as melhores partidas para você entrar agora.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-2xl shadow-xl shadow-blue-900/40 transition active:scale-95 group"
        >
          <Plus size={20} className="group-hover:rotate-90 transition-transform" /> Nova Partida
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rooms.map((room) => (
          <motion.div 
            key={room.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -5 }}
            className="bg-slate-800 border border-slate-700 rounded-3xl p-6 hover:border-blue-500/50 transition-all duration-300 group shadow-lg"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Mesa</span>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition">{room.name}</h3>
                  {user?.role === 'ADMIN' && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        closeRoom(room.id);
                      }}
                      className="p-1 text-slate-500 hover:text-red-500 transition-colors"
                      title="Encerrar Sala"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              <span className={`text-[10px] uppercase font-black px-3 py-1 rounded-full ${room.status === 'WAITING' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-700 text-slate-400'}`}>
                {room.status === 'WAITING' ? 'Livre' : 'Ocupada'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-900/50 rounded-2xl p-3 border border-white/5">
                <p className="text-[9px] uppercase text-slate-500 font-bold mb-1">Jogadores</p>
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-blue-400" />
                  <span className="text-sm font-bold text-white">{room.playerCount} / 4</span>
                </div>
                {room.allowSpectators && room.spectatorCount > 0 && (
                  <p className="text-[8px] text-amber-500 mt-1">👁 {room.spectatorCount} espectador{room.spectatorCount > 1 ? 'es' : ''}</p>
                )}
              </div>
              <div className="bg-slate-900/50 rounded-2xl p-3 border border-white/5">
                <p className="text-[9px] uppercase text-slate-500 font-bold mb-1">Objetivo</p>
                <div className="flex items-center gap-2">
                  <Trophy size={14} className="text-yellow-500" />
                  <span className="text-sm font-bold text-white">{room.score_goal} Pontos</span>
                </div>
                {room.allowSpectators && (
                  <p className="text-[8px] text-slate-500 mt-1">👁 espectadores permitidos</p>
                )}
              </div>
            </div>

            {(() => {
              const isFull = room.playerCount >= 4;
              const canJoinAsSpec = isFull && room.allowSpectators;
              const cantJoin = isFull && !room.allowSpectators;
              return (
                <button
                  onClick={() => joinRoom(room.id)}
                  disabled={cantJoin}
                  className={`w-full py-4 rounded-2xl transition-all flex items-center justify-center gap-2 font-black text-sm uppercase tracking-widest ${cantJoin ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-700 hover:bg-blue-600 text-white group-hover:shadow-blue-900/40'}`}
                >
                  <Play size={16} className="fill-current" />
                  {canJoinAsSpec ? 'Entrar como Espectador' : 'Entrar na Mesa'}
                </button>
              );
            })()}
          </motion.div>
        ))}

        {rooms.length === 0 && (
          <div className="col-span-full py-24 text-center border-2 border-dashed border-slate-800 rounded-[3rem] bg-slate-900/30">
            <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-6">
              <Users size={32} className="text-slate-600" />
            </div>
            <p className="text-slate-400 font-bold text-lg">Nenhuma mesa ativa no momento.</p>
            <p className="text-slate-600 text-sm mb-8">Seja o primeiro a convidar os amigos para uma partida!</p>
            <button onClick={() => setShowModal(true)} className="bg-blue-600/10 text-blue-400 border border-blue-500/20 px-8 py-3 rounded-full font-black text-xs uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all">Criar Minha Mesa</button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[110] p-4">
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="bg-slate-800 w-full max-w-md p-10 rounded-[2.5rem] border border-slate-700 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 to-blue-400" />
            
            <h3 className="text-3xl font-black text-white mb-2 tracking-tight">Nova Mesa</h3>
            <p className="text-slate-400 text-sm mb-8 font-medium">Defina as regras da partida antes de começar.</p>
            
            <div className="space-y-8">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Identificação da Sala</label>
                <input 
                  type="text" 
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl p-4 text-white font-bold focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="Ex: Convento da Penha #1"
                />
              </div>

              <div>
                <div className="flex justify-between items-end mb-3">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Meta de Gols</label>
                  <span className="text-2xl font-black text-blue-400">{scoreGoal} <span className="text-[10px] text-slate-500">PTS</span></span>
                </div>
                <input 
                  type="range" min="1" max="10" 
                  value={scoreGoal}
                  onChange={e => setScoreGoal(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between mt-2">
                  <span className="text-[10px] font-bold text-slate-700 uppercase">Partida Rápida</span>
                  <span className="text-[10px] font-bold text-slate-700 uppercase">Partida Longa</span>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer group" onClick={() => setAllowSpectators(v => !v)}>
                  <div>
                    <p className="text-xs font-bold text-white">Permitir espectadores</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Mais pessoas podem entrar e assistir a partida</p>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ml-4 ${allowSpectators ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${allowSpectators ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </label>

                {allowSpectators && (
                  <label className="flex items-center justify-between cursor-pointer ml-4 pl-4 border-l-2 border-slate-700" onClick={() => setSpectatorsSeeHands(v => !v)}>
                    <div>
                      <p className="text-xs font-bold text-slate-300">Espectadores veem as mãos</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Espectadores veem as cartas de todos os jogadores</p>
                    </div>
                    <div className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ml-4 ${spectatorsSeeHands ? 'bg-amber-500' : 'bg-slate-700'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${spectatorsSeeHands ? 'translate-x-6' : 'translate-x-1'}`} />
                    </div>
                  </label>
                )}
              </div>

              <div className="flex gap-4 pt-2">
                 <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 font-black py-4 rounded-2xl transition uppercase text-xs tracking-widest"
                >
                  Voltar
                </button>
                <button
                  onClick={createRoom}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl shadow-xl shadow-blue-900/20 transition uppercase text-xs tracking-widest"
                >
                  Abrir Mesa
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
