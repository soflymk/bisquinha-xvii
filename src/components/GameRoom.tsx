/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, Card, ChatMessage } from '../lib/types';
import { ChevronLeft, WifiOff, RefreshCcw, Send, MessageSquare, Crown, X } from 'lucide-react';

export default function GameRoom() {
  const { user, socket, currentRoomId, setView } = useApp();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomData, setRoomData] = useState<{
    slots: (string | null)[];
    nicknames: Record<string, string>;
    teams: Record<string, number>;
    ownerId: string | null;
    spectators: { userId: string; nickname: string }[];
  }>({
    slots: [null, null, null, null],
    nicknames: {},
    teams: {},
    ownerId: null,
    spectators: []
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [config, setConfig] = useState<any>(null);
  const [sysMsg, setSysMsg] = useState<string | null>(null);
  const [isAborted, setIsAborted] = useState(false);
  const [waitingForPlayer, setWaitingForPlayer] = useState<{ nickname: string, deadline: number } | null>(null);
  const [showChatMb, setShowChatMb] = useState(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const [swapReq, setSwapReq] = useState<{ from: string, fromNickname: string } | null>(null);
  const [pendingCorte, setPendingCorte] = useState(false);
  const [flyingCardRelPos, setFlyingCardRelPos] = useState<number | null>(null);
  const [flyingCardKey, setFlyingCardKey] = useState(0);
  const prevDealtUserRef = useRef<string | null>(null);
  const [heleyNotice, setHeleyNotice] = useState<{ team: number; points: number } | null>(null);
  const [myTeamCardCount, setMyTeamCardCount] = useState(0);
  const [opponentCardCount, setOpponentCardCount] = useState(0);
  const [gameError, setGameError] = useState<string | null>(null);
  const [spectatorChoose, setSpectatorChoose] = useState<{
    spectatorId: string;
    spectatorNickname: string;
    losingTeam: number;
    candidates: { userId: string; nickname: string }[];
  } | null>(null);
  const [kickVote, setKickVote] = useState<{
    targetId: string;
    targetNickname: string;
    initiatorId: string;
    initiatorNickname: string;
    votes: string[];
  } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!socket || !currentRoomId) return;

    socket.emit('join_room', currentRoomId);

    socket.on('init_sync', (data) => {
      setGameState(data.gameState);
      setConfig(data.config);
      setRoomData({ slots: data.slots, nicknames: data.nicknames, teams: data.teams, ownerId: data.ownerId, spectators: data.spectators || [] });
      if (data.chat) setMessages(data.chat);
    });

    socket.off('chat_message').on('chat_message', (msg) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('player_disconnected', (data: { nickname: string, timeout: number }) => {
      setWaitingForPlayer({ 
        nickname: data.nickname, 
        deadline: Date.now() + data.timeout 
      });
    });

    socket.on('player_reconnected', () => {
      setWaitingForPlayer(null);
    });

    socket.on('swap_request_received', (data) => {
       if (data.toUserId === user?.id) {
         setSwapReq({ from: data.from, fromNickname: data.fromNickname });
       }
    });

    socket.on('room_update', (data) => {
      setRoomData(prev => ({ ...prev, ...data }));
    });

    socket.on('game_started', (state) => {
      setGameState(state);
      setSysMsg('A partida começou!');
    });

    socket.on('game_update', (state) => {
      setGameState(state);
    });

    socket.on('vaza_resolved', ({ winnerId }) => {
      const winnerTeam = roomData.teams[winnerId];
      const myTeam = roomData.teams[user?.id || ''];
      const isMyTeam = winnerTeam === myTeam;
      if (isMyTeam) setMyTeamCardCount(prev => prev + 4);
      else setOpponentCardCount(prev => prev + 4);
    });

    socket.on('queue_updated', ({ spectators }) => {
      setRoomData(prev => ({ ...prev, spectators }));
    });

    socket.on('spectator_choose_replacement', (data) => {
      setSpectatorChoose(data);
    });

    socket.on('kick_vote_started', (data) => {
      setKickVote(data);
    });

    socket.on('kick_vote_update', ({ votes }) => {
      setKickVote(prev => prev ? { ...prev, votes } : null);
    });

    socket.on('kick_vote_result', ({ passed, targetNickname, reason }) => {
      setKickVote(null);
      if (passed) setSysMsg(`${targetNickname} foi removido da sala.`);
      else if (reason !== 'iniciador saiu') setSysMsg(reason === 'tempo' ? 'Votação expirou.' : 'Votação cancelada — alguém votou não.');
    });

    socket.on('kicked_from_room', () => {
      setIsAborted(true);
      setSysMsg('Você foi removido da sala por votação.');
    });

    socket.on('heley_notice', ({ team, points }) => {
      setHeleyNotice({ team, points });
      setTimeout(() => setHeleyNotice(null), 3500);
    });

    socket.on('hand_finished', (data) => {
      setSysMsg(`Fim da mão! Dupla ${data.winnerTeam} venceu com ${data.pointsWon} gols.`);
    });

    socket.on('game_finished', ({ winnerTeam }) => {
      setSysMsg(`PARTIDA ENCERRADA! A dupla ${winnerTeam} é a grande campeã!`);
    });

    socket.on('system_message', (msg) => {
      setSysMsg(msg);
      setTimeout(() => setSysMsg(null), 4000);
    });

    socket.on('game_aborted', ({ reason }) => {
      setIsAborted(true);
      setSysMsg(reason);
    });

    socket.on('error', (err) => {
      setGameError(err);
      setTimeout(() => setGameError(null), 3000);
    });

    return () => {
      socket.off('init_sync');
      socket.off('room_update');
      socket.off('game_started');
      socket.off('game_update');
      socket.off('vaza_resolved');
      socket.off('heley_notice');
      socket.off('hand_finished');
      socket.off('game_finished');
      socket.off('system_message');
      socket.off('game_aborted');
      socket.off('error');
      socket.off('swap_request_received');
      socket.off('queue_updated');
      socket.off('spectator_choose_replacement');
      socket.off('kick_vote_started');
      socket.off('kick_vote_update');
      socket.off('kick_vote_result');
      socket.off('kicked_from_room');
    };
  }, [socket, currentRoomId, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Efeito para atualizar o timer de reconexão a cada segundo localmente
  useEffect(() => {
    if (!waitingForPlayer) return;
    const interval = setInterval(() => {
      setWaitingForPlayer(prev => {
        if (!prev) return null;
        return { ...prev }; // Force re-render
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [waitingForPlayer]);

  useEffect(() => {
    if (gameState?.status === 'CUTTING' && !gameState.visibleCorte) {
      setPendingCorte(false);
    }
    if (gameState?.status === 'SHUFFLING') {
      setMyTeamCardCount(0);
      setOpponentCardCount(0);
    }
  }, [gameState?.status, gameState?.visibleCorte]);

  useEffect(() => {
    if (gameState?.status === 'DEALING' && gameState.lastDealtUserId) {
      if (gameState.lastDealtUserId !== prevDealtUserRef.current) {
        prevDealtUserRef.current = gameState.lastDealtUserId;
        const playerIdx = roomData.slots.indexOf(gameState.lastDealtUserId);
        const myIdxLocal = roomData.slots.indexOf(user?.id || null);
        const relPos = myIdxLocal === -1 ? playerIdx : (playerIdx - myIdxLocal + 4) % 4;
        setFlyingCardRelPos(relPos);
        setFlyingCardKey(k => k + 1);
      }
    } else if (gameState?.status !== 'DEALING') {
      prevDealtUserRef.current = null;
      setFlyingCardRelPos(null);
    }
  }, [gameState?.lastDealtUserId, gameState?.status, roomData.slots, user?.id]);

  const requestSwap = (toIdx: number) => {
    socket?.emit('request_swap', { roomId: currentRoomId, toIdx });
  };

  const acceptSwap = () => {
    if (swapReq) {
      socket?.emit('accept_swap', { roomId: currentRoomId, fromUserId: swapReq.from });
      setSwapReq(null);
    }
  };

  const startGame = () => {
    socket?.emit('start_game', currentRoomId);
  };

  const playCard = (cardId: string) => {
    if (gameState?.currentTurn !== user?.id) return;
    socket?.emit('play_card', { roomId: currentRoomId, cardId });
  };

  const swap2Corte = () => {
    socket?.emit('swap_corte_2', currentRoomId);
  };

  const selectCorte = (cardId?: string, isBater?: boolean) => {
    setPendingCorte(true);
    socket?.emit('select_corte', { roomId: currentRoomId, cardId, isBater });
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket?.emit('send_chat', { roomId: currentRoomId, text: chatInput });
    setChatInput('');
  };

  const initiateKick = (targetId: string) => {
    socket?.emit('initiate_kick', { roomId: currentRoomId, targetId });
  };

  const castKickVote = (approve: boolean) => {
    socket?.emit('cast_kick_vote', { roomId: currentRoomId, approve });
  };

  const handleSpectatorPick = (removeUserId: string) => {
    socket?.emit('spectator_remove_player', { roomId: currentRoomId, removeUserId });
    setSpectatorChoose(null);
  };

  const leaveRoom = () => {
    socket?.emit('leave_room', currentRoomId);
    setView('LOBBY');
  };

  const isSpectator = roomData.spectators.some(s => s.userId === user?.id);
  const myIdx = roomData.slots.indexOf(user?.id || null);
  const getRelPos = (absIdx: number) => {
    if (myIdx === -1) return absIdx; // Espectador
    return (absIdx - myIdx + 4) % 4;
  };

  if (isAborted) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center space-y-6 bg-slate-900 text-white">
        <WifiOff size={64} className="text-red-500 animate-pulse" />
        <h2 className="text-3xl font-bold uppercase tracking-tight">Partida Interrompida</h2>
        <p className="text-slate-400 max-w-md text-center">{sysMsg}</p>
        <button onClick={leaveRoom} className="bg-slate-800 hover:bg-slate-700 px-8 py-3 rounded-xl font-bold transition">Voltar ao Lobby</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden bg-slate-900">
      {/* Sidebar de Status - Desktop only */}
      <aside className="hidden lg:flex w-64 bg-slate-800 border-r border-slate-700 p-6 flex-col shrink-0">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-blue-400">Bisca Capixaba</h1>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Sala: {currentRoomId?.slice(0,8)}</p>
        </div>

        <div className="space-y-4 shrink-0">
          <div className="bg-slate-900 rounded-lg p-4 border-l-4 border-blue-500 shadow-lg">
            <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-2">Placar da Partida</p>
            <div className="flex justify-between items-end mt-1">
              <div>
                <span className="text-[10px] block text-slate-400">Dupla 1</span>
                <span className="text-2xl font-bold text-white">{gameState?.gameScore.team1 || 0}</span>
              </div>
              <span className="text-slate-600 mb-1 font-bold">vs</span>
              <div className="text-right">
                <span className="text-[10px] block text-slate-400">Dupla 2</span>
                <span className="text-2xl font-bold text-white">{gameState?.gameScore.team2 || 0}</span>
              </div>
            </div>
            <p className="text-[10px] text-center mt-3 text-blue-300 font-bold uppercase tracking-widest bg-blue-500/10 py-1 rounded">Meta: {config?.scoreGoal || 5} Pontos</p>
          </div>

          {gameState && (
            <div className="bg-slate-900 rounded-lg p-4 border-l-4 border-emerald-500 shadow-lg">
              <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-2">Mão Atual</p>
              <div className="flex justify-between mt-1 items-center">
                <span className="text-xs text-slate-400">Trunfo:</span>
                <span className="text-xs font-bold text-emerald-400 italic flex items-center gap-1">
                  <SuitIcon suit={gameState.trumpSuit || ''} className="w-3 h-3" />
                  {(gameState.trumpSuit || '').toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-slate-400">Modo:</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${gameState.isCopas ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-500'}`}>
                  {gameState.isCopas ? 'COPAS (+2)' : 'NORMAL'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Jogadores na Mesa — com botão de kick para jogadores */}
        {!isSpectator && (
          <div className="mt-3 shrink-0 bg-slate-900 rounded-lg p-3 border-l-4 border-slate-600 shadow-lg">
            <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-2">Jogadores na Mesa</p>
            <div className="space-y-1.5">
              {roomData.slots.map((uid, idx) => uid ? (
                <div key={uid} className="flex items-center gap-2 group">
                  <span className={`text-[10px] font-bold truncate flex-1 ${uid === user?.id ? 'text-blue-300' : 'text-slate-300'}`}>
                    {roomData.nicknames[uid] || '?'}
                    {uid === user?.id && <span className="text-[7px] text-slate-500 ml-1">(você)</span>}
                  </span>
                  {uid !== user?.id && !kickVote && (
                    <button
                      onClick={() => initiateKick(uid)}
                      title="Votar para remover"
                      className="opacity-0 group-hover:opacity-100 text-[7px] font-black text-red-500 hover:text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 hover:border-red-400/40 transition"
                    >
                      VOTAR
                    </button>
                  )}
                </div>
              ) : (
                <div key={idx} className="text-[9px] text-slate-700 italic">vaga livre</div>
              ))}
            </div>
          </div>
        )}

        {/* Fila de Espera na Sidebar */}
        {roomData.spectators.length > 0 && (
          <div className="mt-3 shrink-0 bg-slate-900 rounded-lg p-3 border-l-4 border-amber-500 shadow-lg">
            <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-2">Fila de Espera</p>
            <div className="space-y-1.5">
              {roomData.spectators.map((s, i) => (
                <div key={s.userId} className="flex items-center gap-2 group">
                  <span className="text-[9px] font-black text-amber-500 w-4">#{i + 1}</span>
                  <span className={`text-[10px] font-bold truncate flex-1 ${s.userId === user?.id ? 'text-amber-300' : 'text-slate-400'}`}>{s.nickname}</span>
                  {s.userId === user?.id
                    ? <span className="text-[7px] font-black text-amber-600 uppercase bg-amber-900/30 px-1.5 py-0.5 rounded">Você</span>
                    : !isSpectator && !kickVote && (
                      <button
                        onClick={() => initiateKick(s.userId)}
                        title="Votar para remover"
                        className="opacity-0 group-hover:opacity-100 text-[7px] font-black text-red-500 hover:text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 hover:border-red-400/40 transition"
                      >
                        VOTAR
                      </button>
                    )
                  }
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chat Panel na Sidebar (Desktop) */}
        <div className="flex-1 mt-4 flex flex-col min-h-0 bg-slate-900/50 rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-3 border-b border-white/5 flex items-center gap-2">
            <MessageSquare size={14} className="text-blue-400" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resenha</span>
            <span className={`ml-auto text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${isSpectator ? 'bg-amber-900/40 text-amber-500' : 'bg-blue-900/40 text-blue-400'}`}>
              {isSpectator ? '👁 Espectadores' : '🃏 Jogadores'}
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar min-h-0">
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col">
                <div className="flex items-baseline gap-2">
                  <span className={`text-[9px] font-black uppercase ${m.userId === user?.id ? 'text-blue-400' : 'text-slate-500'}`}>
                    {m.nickname}
                  </span>
                  <span className="text-[7px] text-slate-600">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-tight mt-0.5 break-words font-medium">
                  {m.text}
                </p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendChat} className="p-2 bg-slate-900 border-t border-white/5 flex gap-2">
            <input 
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Falar..."
              className="flex-1 bg-slate-800 border-none rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 transition-all font-medium"
            />
            <button 
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-colors active:scale-95"
            >
              <Send size={14} />
            </button>
          </form>
        </div>

        <div className="mt-6 pt-6 border-t border-slate-700">
          <button onClick={leaveRoom} className="w-full py-3 bg-red-900/20 hover:bg-red-800/40 rounded-xl text-xs font-bold text-red-200 transition">Sair da Sala</button>
        </div>
      </aside>

      {/* Modal de Aguarda Reconexão */}
      <AnimatePresence>
        {waitingForPlayer && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-[300] p-4 text-center">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-800 border-2 border-red-500/50 p-12 rounded-[2.5rem] shadow-2xl max-w-md relative"
            >
              <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse">
                <WifiOff size={40} className="text-red-400" />
              </div>
              <h3 className="text-2xl font-black text-white mb-2 uppercase italic tracking-tight">Jogador Ausente</h3>
              <p className="text-slate-400 font-medium mb-6">
                <span className="text-red-400 font-bold">@{waitingForPlayer.nickname}</span> desconectou da rede.
              </p>
              
              <div className="bg-slate-900 rounded-2xl p-6 border border-slate-700">
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.25em] mb-2">Janela de Reconexão</p>
                <div className="text-4xl font-black text-red-500 font-mono">
                  {Math.max(0, Math.ceil((waitingForPlayer.deadline - Date.now()) / 1000))}s
                </div>
              </div>

              <p className="text-[9px] text-slate-500 mt-8 uppercase font-bold tracking-widest leading-relaxed">
                Aguardando o retorno das comunicações.<br/>Caso o tempo expire, a partida será encerrada.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Game Area */}
      <main className="flex-1 relative flex flex-col overflow-hidden">
        {/* Mobile top actions */}
        <div className="lg:hidden flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800 shrink-0">
          <button onClick={leaveRoom} className="p-1.5 text-slate-500 hover:text-white transition">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/80 rounded-xl border border-white/5">
            <span className="text-[8px] text-slate-500 font-bold uppercase">D1</span>
            <span className="text-sm font-black text-white">{gameState?.gameScore.team1 || 0}</span>
            <span className="text-slate-600 font-bold text-xs">vs</span>
            <span className="text-sm font-black text-white">{gameState?.gameScore.team2 || 0}</span>
            <span className="text-[8px] text-slate-500 font-bold uppercase">D2</span>
          </div>
          <button onClick={() => setShowChatMb(true)} className="p-1.5 text-slate-500 hover:text-white transition">
            <MessageSquare size={18} />
          </button>
        </div>
        {/* Fila de espera mobile */}
        {roomData.spectators.length > 0 && (
          <div className="lg:hidden flex items-center gap-2 px-3 py-1.5 bg-amber-900/20 border-b border-amber-800/30 overflow-x-auto shrink-0">
            <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest shrink-0">Fila:</span>
            {roomData.spectators.map((s, i) => (
              <span key={s.userId} className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${s.userId === user?.id ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-slate-400'}`}>
                #{i + 1} {s.nickname}
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 flex flex-col justify-center items-center relative overflow-hidden p-2 md:p-8">
          {/* Game Table */}
          <div className="game-table relative w-[95%] h-[95%] max-w-[800px] max-h-[480px] flex items-center justify-center" style={{
            background: 'radial-gradient(circle, #14532d 0%, #064e3b 100%)',
            border: '8px solid #334155',
            borderRadius: 'min(200px, 40vw)',
            boxShadow: 'inset 0 0 100px rgba(0,0,0,0.5), 0 20px 50px rgba(0,0,0,0.3)'
          }}>
            {/* Players Area */}
            {(() => {
              let leadingTeam: number | null = null;
              if (gameState?.status === 'IN_GAME') {
                let t1 = 0, t2 = 0;
                for (const p of Object.values(gameState.players) as { team: 1 | 2; vazaPoints: number }[]) {
                  if (p.team === 1) t1 += p.vazaPoints;
                  else t2 += p.vazaPoints;
                }
                if (t1 !== t2) leadingTeam = t1 > t2 ? 1 : 2;
              }
              const roundStarterUid = gameState?.vaza[0]?.userId;
              const showAllHands = isSpectator && config?.spectatorsSeeHands;
              return roomData.slots.map((uid, idx) => (
                <PlayerSlot
                  key={idx}
                  relPos={getRelPos(idx)}
                  isTurn={gameState?.currentTurn === uid}
                  nickname={roomData.nicknames[uid || ''] || '...'}
                  isMe={uid === user?.id}
                  team={roomData.teams[uid || '']}
                  vazaCard={gameState?.vaza.find(v => v.userId === uid)?.card}
                  onSwap={() => requestSwap(idx)}
                  showSwap={gameState === null && uid !== user?.id}
                  isOwner={uid === roomData.ownerId}
                  handSize={gameState?.players[uid || '']?.hand.length || 0}
                  visibleHand={showAllHands ? (gameState?.players[uid || '']?.hand || []) : undefined}
                  isRoundStarter={gameState?.status === 'IN_GAME' && roundStarterUid === uid}
                  isLeadingTeam={leadingTeam !== null && roomData.teams[uid || ''] === leadingTeam}
                />
              ));
            })()}

            {/* Persistent Won Piles: minha dupla = bottom-left, adversária = top-right */}
            {myTeamCardCount > 0 && (
              <div className="absolute bottom-3 left-4 flex items-end pointer-events-none z-30">
                {Array.from({ length: Math.min(myTeamCardCount, 12) }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.4, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 200, delay: 0.02 * i }}
                    className="w-6 h-9 md:w-8 md:h-12 rounded-md border shadow-lg"
                    style={{
                      background: 'repeating-linear-gradient(45deg, #713f12, #713f12 3px, #a16207 3px, #a16207 6px)',
                      borderColor: 'rgba(234,179,8,0.45)',
                      transform: `rotate(${((i * 7) % 23) - 11}deg) translate(${((i * 5) % 9) - 4}px, ${((i * 3) % 7) - 3}px)`,
                      zIndex: i,
                      marginLeft: i === 0 ? 0 : -14
                    }}
                  />
                ))}
              </div>
            )}
            {opponentCardCount > 0 && (
              <div className="absolute top-3 right-4 flex items-start pointer-events-none z-30">
                {Array.from({ length: Math.min(opponentCardCount, 12) }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.4, y: -20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 200, delay: 0.02 * i }}
                    className="w-6 h-9 md:w-8 md:h-12 rounded-md border shadow-lg"
                    style={{
                      background: 'repeating-linear-gradient(45deg, #7f1d1d, #7f1d1d 3px, #b91c1c 3px, #b91c1c 6px)',
                      borderColor: 'rgba(239,68,68,0.45)',
                      transform: `rotate(${((i * 7) % 23) - 11}deg) translate(${((i * 5) % 9) - 4}px, ${((i * 3) % 7) - 3}px)`,
                      zIndex: i,
                      marginLeft: i === 0 ? 0 : -14
                    }}
                  />
                ))}
              </div>
            )}

            {/* Game Center Content */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {gameState ? (
                <div className="relative flex items-center justify-center scale-[0.6] sm:scale-75 md:scale-100 w-full h-full pointer-events-none">
                  {/* Status Animations Container */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {gameState.status === 'SHUFFLING' && (
                      <div className="flex flex-col items-center">
                        <motion.div className="relative w-14 h-20 md:w-16 md:h-24">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <motion.div
                              key={i}
                              animate={{
                                x: [0, (i % 2 === 0 ? 15 : -15), 0],
                                y: [0, (i % 3 === 0 ? -10 : 10), 0],
                                rotate: [0, (i % 2 === 0 ? 10 : -10), 0],
                                zIndex: [i, (i % 2 === 0 ? 10 : 0), i]
                              }}
                              transition={{ repeat: Infinity, duration: 0.4, delay: i * 0.03 }}
                              className="absolute inset-0 bg-blue-900 border-2 border-white/30 rounded-lg shadow-lg"
                              style={{ background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px)' }}
                            />
                          ))}
                        </motion.div>
                        <p className="text-white font-black uppercase tracking-[0.2em] text-[7px] md:text-[9px] mt-4 md:mt-5 animate-pulse italic bg-black/40 px-3 py-1 rounded-full whitespace-nowrap border border-white/10 backdrop-blur-md">Embaralhando...</p>
                      </div>
                    )}

                    {gameState.status === 'CUTTING' && (
                      <div className="flex flex-col items-center gap-5 pointer-events-auto">
                        <div className="relative h-[120px] md:h-[150px] w-full flex items-center justify-center">
                          {gameState.cuttingCards.map((card, idx) => {
                            const isSelected = gameState.visibleCorte?.id === card.id;
                            const xPos = isSelected ? 0 : (idx - 2) * (isMobile ? 38 : 52);
                            const yPos = isSelected ? 0 : -Math.abs(idx - 2) * 8;
                            const rot = isSelected ? 0 : (idx - 2) * 11;
                            return (
                              <motion.div
                                key={card.id}
                                initial={{ x: 0, y: 50, rotate: 0, opacity: 0 }}
                                animate={{
                                  x: xPos,
                                  y: yPos,
                                  opacity: 1,
                                  rotate: rot,
                                  scale: isSelected ? 1.35 : (isMobile ? 0.75 : 0.9),
                                  zIndex: isSelected ? 100 : idx
                                }}
                                whileHover={gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? { scale: 1.1, y: yPos - 10 } : {}}
                                onClick={() => gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte && selectCorte(card.id)}
                                className={`${gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? 'cursor-pointer' : 'opacity-80'}`}
                                style={{ position: 'absolute' }}
                              >
                                <GameCard card={card} size={isMobile ? "sm" : "md"} faceDown={!isSelected} />
                              </motion.div>
                            );
                          })}
                        </div>
                        {gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? (
                          <div className="flex flex-col items-center gap-3">
                            <p className="text-yellow-400 font-black uppercase tracking-widest text-[10px] md:text-xs animate-bounce bg-black/70 px-4 py-2 rounded-full backdrop-blur-md border border-yellow-400/30">Corte o baralho!</p>
                            <button
                              onClick={() => selectCorte(undefined, true)}
                              className="bg-red-600 hover:bg-red-500 text-white font-black px-4 py-2 rounded-lg shadow-lg transition active:scale-95 border border-red-400/40 text-[10px] md:text-xs uppercase"
                            >
                              BATER (COPAS)
                            </button>
                          </div>
                        ) : (!gameState.visibleCorte && !pendingCorte) && (
                          <p className="text-white/50 font-black uppercase tracking-widest text-[8px] md:text-[10px] bg-black/40 px-6 py-3 rounded-full backdrop-blur-sm">
                            Aguardando corte...
                          </p>
                        )}
                      </div>
                    )}

                    {gameState.status === 'DEALING' && (
                      <div className="flex flex-col items-center relative">
                        <div className="relative w-14 h-20 md:w-16 md:h-24">
                          {(() => {
                            const targetRelPos = gameState.lastDealtUserId ? getRelPos(roomData.slots.indexOf(gameState.lastDealtUserId)) : 0;
                            const angles = [0, 90, 180, -90];
                            return (
                              <motion.div
                                animate={{ rotate: angles[targetRelPos] }}
                                transition={{ type: 'spring', damping: 15, stiffness: 150 }}
                                className="absolute inset-0 bg-blue-900 border-2 border-white/30 rounded-lg shadow-xl flex flex-col items-center justify-center overflow-hidden"
                                style={{ background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px)' }}
                              >
                                <div className="absolute top-2 w-1 h-4 bg-white/30 rounded-full" />
                              </motion.div>
                            );
                          })()}
                        </div>
                        <AnimatePresence>
                          {flyingCardRelPos !== null && (
                            <motion.div
                              key={flyingCardKey}
                              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                              animate={{
                                x: flyingCardRelPos === 1 ? 260 : flyingCardRelPos === 3 ? -260 : 0,
                                y: flyingCardRelPos === 0 ? 260 : flyingCardRelPos === 2 ? -260 : 0,
                                opacity: 0,
                                scale: 0.75
                              }}
                              transition={{ duration: 0.35, ease: 'easeOut' }}
                              className="absolute w-10 h-14 md:w-14 md:h-20 rounded-lg border-2 border-white/30 shadow-xl pointer-events-none z-50"
                              style={{ background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px)' }}
                            />
                          )}
                        </AnimatePresence>
                        <p className="text-white font-black uppercase tracking-widest text-[8px] md:text-[9px] mt-10 animate-pulse italic bg-black/40 px-4 py-1 rounded-full border border-white/10">Dando cartas...</p>
                      </div>
                    )}
                  </div>

                  {/* Vaza Cards Stack */}
                  <div className="relative flex items-center justify-center">
                    {!gameState.isCopas && ['IN_GAME', 'SHUFFLING', 'DEALING'].includes(gameState.status) && gameState.visibleCorte && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="absolute left-[-150px] md:left-[-250px] flex items-center justify-center"
                      >
                        <div className={`absolute rotate-90 ${gameState.status === 'IN_GAME' ? 'translate-x-8' : ''}`}>
                          <GameCard card={gameState.visibleCorte} size="md" isCorte />
                        </div>
                        {gameState.status === 'IN_GAME' && (
                          <div className="relative z-10">
                            <div className="w-12 h-18 md:w-16 md:h-24 bg-blue-900 border-2 border-slate-100 rounded-lg shadow-2xl" style={{
                              background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px)'
                            }}>
                              <div className="absolute inset-0 flex items-center justify-center text-white/20 font-black text-xl select-none">
                                {gameState.deck.length}
                              </div>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )}

                    <AnimatePresence>
                      {gameState.vaza.map((v, i) => {
                        const playerIdx = roomData.slots.indexOf(v.userId);
                        const relPos = getRelPos(playerIdx);
                        const offsetX = i * 40 - 60;
                        const offsetY = i * -15;
                        return (
                          <motion.div
                            key={v.userId + v.card.id}
                            initial={{
                              x: (relPos === 0 ? 0 : relPos === 1 ? 400 : relPos === 2 ? 0 : -400),
                              y: (relPos === 0 ? 400 : relPos === 1 ? 0 : relPos === 2 ? -400 : 0),
                              opacity: 0,
                              scale: 0.5,
                              rotate: 0,
                              rotateY: 180
                            }}
                            animate={{
                              x: offsetX,
                              y: offsetY,
                              opacity: 1,
                              scale: 1,
                              rotate: (i * 10 - 15),
                              rotateY: 0
                            }}
                            exit={(() => {
                              const wRelPos = gameState.lastVazaWinner ? getRelPos(roomData.slots.indexOf(gameState.lastVazaWinner)) : -1;
                              return {
                                x: wRelPos === 1 ? 380 : wRelPos === 3 ? -380 : 0,
                                y: wRelPos === 0 ? 380 : wRelPos === 2 ? -380 : -500,
                                opacity: 0,
                                scale: 0.4,
                                transition: { duration: 0.45, ease: 'easeIn' }
                              };
                            })()}
                            transition={{ type: 'spring', damping: 15, stiffness: 80 }}
                            className="absolute"
                            style={{ zIndex: i }}
                          >
                            <GameCard card={v.card} size="lg" />
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                <div className="text-center pointer-events-auto bg-black/20 p-6 md:p-12 rounded-full border border-white/5 backdrop-blur-sm">
                  <h3 className="text-white font-black uppercase tracking-widest text-[10px] md:text-sm mb-2 md:mb-4">Sala de Espera</h3>
                  <div className="flex gap-2 justify-center mb-4 md:mb-8">
                    {roomData.slots.map((s, i) => (
                      <div key={i} className="relative">
                        <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full ${s ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]' : 'bg-slate-800'}`} />
                        {s === roomData.ownerId && (
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-yellow-500">
                            <Crown size={10} fill="currentColor" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {user?.id === roomData.ownerId && !gameState && (
                    <button
                      onClick={startGame}
                      disabled={roomData.slots.filter(s => s !== null).length !== 4}
                      className={`font-black px-6 md:px-12 py-3 md:py-4 rounded-xl md:rounded-2xl shadow-xl transition active:scale-95 border text-xs md:text-base ${roomData.slots.filter(s => s !== null).length === 4
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40 border-blue-400/30'
                        : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                        }`}
                    >
                      {roomData.slots.filter(s => s !== null).length === 4 ? 'PARTIR PRO JOGO' : 'AGUARDANDO JOGADORES'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <AnimatePresence>
            {sysMsg && (
              <motion.div
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-blue-600/90 backdrop-blur text-white px-8 py-3 rounded-full border border-blue-400/50 text-[10px] md:text-xs font-black tracking-widest uppercase z-[120] shadow-2xl pointer-events-none"
              >
                {sysMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Modal */}
          <AnimatePresence>
            {gameError && (
              <motion.div
                initial={{ y: -60, opacity: 0, scale: 0.9 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -60, opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-[160] pointer-events-none"
              >
                <div className="flex items-center gap-3 bg-red-950/95 border-2 border-red-500/70 text-red-200 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-[340px] text-center">
                  <span className="text-red-400 text-lg shrink-0">⛔</span>
                  <p className="text-xs md:text-sm font-bold leading-snug">{gameError}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Heley Banner */}
          <AnimatePresence>
            {heleyNotice && (
              <motion.div
                initial={{ scale: 0.3, opacity: 0, y: 0 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.5, opacity: 0, y: -40 }}
                transition={{ type: 'spring', damping: 12, stiffness: 200 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-[150]"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="bg-gradient-to-b from-yellow-400 to-amber-600 text-black font-black text-xl md:text-3xl px-8 py-4 rounded-2xl shadow-2xl border-4 border-yellow-300 tracking-widest uppercase" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.3)' }}>
                    ⚡ HELEY! ⚡
                  </div>
                  <div className="bg-black/70 text-yellow-300 font-black text-xs md:text-sm px-6 py-2 rounded-full border border-yellow-500/40 backdrop-blur-sm">
                    Dupla {heleyNotice.team} +{heleyNotice.points} ponto{heleyNotice.points > 1 ? 's' : ''}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer: User Hand and Actions */}
        <div className="h-40 md:h-44 flex items-center justify-center p-4 md:p-6 bg-slate-900/50 border-t border-slate-800 relative z-10 shrink-0">
          <div className="flex gap-4 md:gap-8 items-center md:items-end w-full max-w-4xl justify-center">
            <div className="hidden sm:flex flex-col items-center">
              <div className="w-10 h-10 md:w-14 md:h-14 rounded-full border-2 md:border-4 border-blue-500 overflow-hidden bg-slate-800 mb-2 shadow-lg">
                <div className="w-full h-full flex items-center justify-center font-black text-blue-400 text-xs">{user?.nickname[0].toUpperCase()}</div>
              </div>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Você</span>
            </div>

            <div className="flex gap-2 md:gap-4 p-3 md:p-4 bg-slate-800/50 rounded-[2rem] border border-white/5 shadow-inner backdrop-blur flex-1 max-w-[400px] justify-center overflow-x-auto min-h-[100px] md:min-h-[120px]">
              {isSpectator ? (
                <div className="flex flex-col items-center justify-center gap-2 w-full">
                  <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-500/40 px-4 py-2 rounded-full">
                    <span className="text-amber-400 text-base">👁</span>
                    <span className="text-amber-300 font-black text-xs uppercase tracking-widest">Espectador</span>
                    <span className="text-amber-500 font-bold text-xs">
                      #{roomData.spectators.findIndex(s => s.userId === user?.id) + 1}
                    </span>
                  </div>
                  <p className="text-slate-500 text-[9px] uppercase tracking-wider">Aguardando vaga na próxima partida</p>
                </div>
              ) : (
                <>
                  <AnimatePresence>
                    {gameState?.players[user?.id || '']?.hand.map((card) => (
                      <motion.div
                        key={card.id}
                        initial={{ y: 100, opacity: 0, scale: 0.5 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: -100, opacity: 0 }}
                        whileHover={{ y: -30, scale: 1.1 }}
                        onClick={() => playCard(card.id)}
                        className={`${gameState.currentTurn === user?.id ? 'cursor-pointer' : 'opacity-60 pointer-events-none'} flex-shrink-0 origin-bottom`}
                      >
                        <GameCard card={card} size="hand" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {(!gameState || gameState.status === 'SHUFFLING') && (
                    <div className="flex gap-2 opacity-10">
                      <div className="w-12 h-16 md:w-16 md:h-24 bg-slate-600 rounded-xl" />
                      <div className="w-12 h-16 md:w-16 md:h-24 bg-slate-600 rounded-xl" />
                      <div className="w-12 h-16 md:w-16 md:h-24 bg-slate-600 rounded-xl" />
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
        </div>

        {/* Mobile Chat Modal */}
        <AnimatePresence>
          {showChatMb && (
            <div className="fixed inset-0 z-[400] lg:hidden flex flex-col bg-slate-950">
              <header className="p-4 bg-slate-900 border-b border-white/5 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-blue-400" />
                  <h3 className="font-black text-white uppercase tracking-widest text-sm italic">Resenha da Mesa</h3>
                </div>
                <button onClick={() => setShowChatMb(false)} className="p-2 text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map((m) => (
                  <div key={m.id} className={`flex flex-col ${m.userId === user?.id ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className={`text-[9px] font-black uppercase ${m.userId === user?.id ? 'text-blue-400' : 'text-slate-500'}`}>
                        {m.nickname}
                      </span>
                      <span className="text-[7px] text-slate-600 tracking-wider">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={`p-4 rounded-2xl max-w-[85%] text-sm font-medium ${m.userId === user?.id ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendChat} className="p-4 bg-slate-900 border-t border-white/5 flex gap-3 safe-bottom pb-8">
                <input 
                  type="text"
                  autoFocus
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Mande sua real aqui..."
                  className="flex-1 bg-slate-800 border-none rounded-2xl px-6 py-4 text-white focus:ring-2 focus:ring-blue-500 transition-all font-bold placeholder:text-slate-600"
                />
                <button 
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl transition-all active:scale-95 shadow-xl shadow-blue-600/20"
                >
                  <Send size={24} />
                </button>
              </form>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Votação para remover jogador */}
        <AnimatePresence>
          {kickVote && (
            <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-[220] p-4">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                className="bg-slate-800 border-2 border-red-500/50 p-7 rounded-3xl text-center shadow-2xl max-w-xs w-full"
              >
                <div className="text-3xl mb-3">⚖️</div>
                <h4 className="text-sm font-black text-white mb-1 uppercase tracking-tight">Votação de Remoção</h4>
                <p className="text-slate-400 text-xs mb-1">
                  <span className="text-slate-300 font-bold">{kickVote.initiatorNickname}</span> quer remover:
                </p>
                <p className="text-red-400 font-black text-base mb-4 uppercase">{kickVote.targetNickname}</p>

                {/* Progresso */}
                <div className="flex justify-center gap-1.5 mb-5">
                  {roomData.slots.filter(Boolean).map((uid, i) => (
                    <div key={i} className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-black ${kickVote.votes.includes(uid!) ? 'border-green-500 bg-green-900/40 text-green-400' : 'border-slate-600 bg-slate-900 text-slate-600'}`}>
                      {kickVote.votes.includes(uid!) ? '✓' : '?'}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mb-4">{kickVote.votes.length}/4 votos — precisa ser unânime</p>

                {kickVote.initiatorId === user?.id ? (
                  <p className="text-[10px] text-green-400 font-bold bg-green-900/20 py-2 rounded-xl border border-green-500/20">
                    Você iniciou e já votou SIM ✓
                  </p>
                ) : kickVote.votes.includes(user?.id || '') ? (
                  <p className="text-[10px] text-green-400 font-bold bg-green-900/20 py-2 rounded-xl border border-green-500/20">
                    Você votou SIM ✓ — aguardando os demais
                  </p>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => castKickVote(false)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-black text-slate-300 text-xs uppercase transition active:scale-95">
                      NÃO
                    </button>
                    <button onClick={() => castKickVote(true)} className="flex-1 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-black text-white text-xs uppercase shadow-lg transition active:scale-95">
                      SIM, REMOVER
                    </button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Espectador escolhe quem da dupla perdedora sai */}
        <AnimatePresence>
          {spectatorChoose && spectatorChoose.spectatorId === user?.id && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[250] p-4">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                className="bg-slate-800 border-2 border-amber-500/60 p-8 rounded-3xl text-center shadow-2xl max-w-sm w-full"
              >
                <div className="w-14 h-14 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
                  <span className="text-3xl">🪑</span>
                </div>
                <h4 className="text-lg font-black text-white mb-1 uppercase tracking-tight">Sua vez de entrar!</h4>
                <p className="text-slate-400 text-sm mb-1">Você é o próximo da fila.</p>
                <p className="text-amber-400 text-xs font-bold mb-6 uppercase tracking-wider">
                  ⚠️ Escolha quem da Dupla {spectatorChoose.losingTeam} vai sair
                </p>
                <div className="space-y-3">
                  {spectatorChoose.candidates.map(c => (
                    <button
                      key={c.userId}
                      onClick={() => handleSpectatorPick(c.userId)}
                      className="w-full flex items-center justify-between bg-red-900/20 hover:bg-red-800/40 border border-red-500/30 hover:border-red-400/60 text-white px-5 py-3 rounded-xl font-bold transition active:scale-95 group"
                    >
                      <span className="text-sm">{c.nickname}</span>
                      <span className="text-red-400 text-xs font-black uppercase group-hover:text-red-300">REMOVER ✕</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Swap Request Modal */}
        <AnimatePresence>
          {swapReq && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-[200]">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-800 border-2 border-blue-500 p-8 rounded-3xl text-center shadow-2xl max-w-sm"
              >
                <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <RefreshCcw size={32} className="text-blue-400" />
                </div>
                <h4 className="text-lg font-bold text-white mb-2 leading-tight">Solicitação de Troca</h4>
                <p className="text-slate-400 text-sm mb-8"><strong>{swapReq.fromNickname}</strong> deseja trocar de lugar com você na mesa.</p>
                <div className="flex gap-4">
                  <button onClick={() => setSwapReq(null)} className="flex-1 bg-slate-700 py-3 rounded-xl font-bold text-slate-300 hover:bg-slate-600 transition">RECUSAR</button>
                  <button onClick={acceptSwap} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold text-white hover:bg-blue-500 shadow-lg shadow-blue-900/40 transition">ACEITAR</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function PlayerSlot({ relPos, isTurn, nickname, isMe, team, vazaCard, onSwap, showSwap, isOwner, handSize, isRoundStarter, isLeadingTeam, visibleHand }: any) {
  const posClasses: any = {
    0: "bottom-[-20px] md:bottom-[-40px] left-1/2 -translate-x-1/2",
    1: "right-[-20px] md:right-[-40px] top-1/2 -translate-y-1/2",
    2: "top-[-20px] md:top-[-40px] left-1/2 -translate-x-1/2",
    3: "left-[-20px] md:left-[-40px] top-1/2 -translate-y-1/2"
  };

  // cardPosClasses no longer needed as vaza is handled in a stack at center

  const handCardsPos: any = {
    0: "hidden", // Representado pelo hand component do rodapé
    1: "flex-col -left-12 top-1/2 -translate-y-1/2",
    2: "flex-row -bottom-12 left-1/2 -translate-x-1/2",
    3: "flex-col -right-12 top-1/2 -translate-y-1/2",
  };

  return (
    <>
      <div className={`absolute pointer-events-none z-10 ${posClasses[relPos]}`}>
        <div className="flex flex-col items-center gap-2 relative">
           {handSize > 0 && relPos !== 0 && (
             <div className={`absolute flex gap-0.5 ${handCardsPos[relPos]}`}>
               {visibleHand && visibleHand.length > 0
                 ? visibleHand.map((card: any) => {
                     const isRed = card.suit === 'Copas' || card.suit === 'Ouros';
                     return (
                       <motion.div
                         key={card.id}
                         initial={{ scale: 0, opacity: 0 }}
                         animate={{ scale: 1, opacity: 1 }}
                         className="w-5 h-7 md:w-7 md:h-10 bg-white border border-slate-200 rounded shadow-md flex flex-col items-center justify-between p-0.5 text-[5px] md:text-[7px] font-bold"
                       >
                         <span className={isRed ? 'text-red-600' : 'text-slate-900'}>{card.value}</span>
                         <span className={isRed ? 'text-red-500' : 'text-slate-800'} style={{ fontSize: '0.5rem' }}>
                           {card.suit === 'Copas' ? '♥' : card.suit === 'Ouros' ? '♦' : card.suit === 'Espadas' ? '♠' : '♣'}
                         </span>
                       </motion.div>
                     );
                   })
                 : Array.from({ length: handSize }).map((_, i) => (
                   <motion.div
                     key={i}
                     initial={{ scale: 0, opacity: 0 }}
                     animate={{ scale: 1, opacity: 1 }}
                     className="w-4 h-6 md:w-6 md:h-9 bg-blue-900 border border-white/30 rounded shadow-md"
                     style={{ background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 2px, #2563eb 2px, #2563eb 4px)' }}
                   />
                 ))
               }
             </div>
           )}
{isLeadingTeam && (
             <div className="absolute inset-0 -m-3 rounded-full pointer-events-none" style={{
               background: 'radial-gradient(circle, rgba(34,197,94,0.22) 0%, rgba(34,197,94,0.08) 55%, transparent 75%)',
               filter: 'blur(6px)',
             }} />
           )}
           {isOwner && (
             <div className="absolute -top-4 md:-top-5 text-yellow-500">
               <Crown size={14} fill="currentColor" className="md:w-5 md:h-5" />
             </div>
           )}
           <div className={`relative w-8 h-8 md:w-12 md:h-12 rounded-full bg-slate-800 border-2 flex items-center justify-center text-[8px] md:text-[10px] font-bold shadow-lg transition-all duration-300 ${isTurn ? 'border-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.7)] scale-110' : isMe ? 'border-blue-500 scale-105' : 'border-slate-600'}`}>
             {nickname[0].toUpperCase()}
             {isRoundStarter && (
               <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full border border-slate-600 shadow" />
             )}
           </div>
           <div className={`flex flex-col items-center px-2 py-1 md:px-3 md:py-1.5 rounded-full border shadow-xl backdrop-blur transition-all duration-300 ${isTurn ? 'bg-yellow-900/30 border-yellow-400/60' : 'bg-slate-900/90 border-slate-700'}`}>
              <span className={`font-bold text-[7px] md:text-[9px] truncate max-w-[60px] md:max-w-[80px] uppercase tracking-wider ${isTurn ? 'text-yellow-200' : 'text-white'}`}>{nickname}</span>
           </div>
           {showSwap && (
              <button 
                onClick={(e) => { e.stopPropagation(); onSwap(); }}
                className="mt-1 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[6px] md:text-[7px] font-black px-1.5 py-0.5 md:px-2 md:py-1 rounded-lg pointer-events-auto transition border border-blue-500/30 whitespace-nowrap"
              >
                TROCAR
              </button>
           )}
        </div>
      </div>
    </>
  );
}

function GameCard({ card, size = 'lg', isCorte = false, faceDown = false, rotation = 0 }: { card: Card, size?: 'sm' | 'md' | 'lg' | 'hand', isCorte?: boolean, faceDown?: boolean, rotation?: number }) {
  const isRed = card.suit === 'Copas' || card.suit === 'Ouros';
  
  const sizeClasses = {
    sm: "w-8 h-12 md:w-10 md:h-14 text-[7px] md:text-[9px] p-1 md:p-1.5 rounded-lg border-2",
    md: "w-12 h-16 md:w-14 md:h-20 text-[10px] md:text-xs p-1.5 md:p-2 rounded-xl border-2",
    lg: "w-14 h-20 md:w-16 md:h-24 text-xs md:text-sm p-2 md:p-3 rounded-2xl border-[3px]",
    hand: "w-12 h-18 md:w-16 md:h-24 text-[10px] md:text-sm p-2 md:p-3 rounded-2xl border-[3px]"
  };

  return (
    <motion.div 
      initial={faceDown ? { rotateY: 180 } : { rotateY: 0 }}
      animate={{ 
        rotateY: faceDown ? 180 : 0,
        rotate: rotation,
      }}
      transition={{ duration: 0.6, type: 'spring', stiffness: 260, damping: 20 }}
      style={{ transformStyle: 'preserve-3d' }}
      className={`${sizeClasses[size]} shadow-2xl relative flex flex-col justify-between items-stretch flex-shrink-0 transition-shadow duration-200 border-slate-700`}
    >
      {/* Front Face */}
      <div className={`absolute inset-0 bg-white border-slate-300 rounded-[inherit] flex flex-col justify-between p-[inherit] backface-hidden ${faceDown ? 'hidden' : 'flex'}`}>
         <div className={`p-0 leading-none font-bold ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.value}</div>
         <div className="flex-1 flex items-center justify-center">
            <SuitIcon suit={card.suit} className={`w-3/4 h-3/4 ${isRed ? 'text-red-500' : 'text-slate-900'}`} />
         </div>
         <div className={`p-0 leading-none font-bold self-end rotate-180 ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.value}</div>
         
      </div>

      {/* Back Face */}
      <div className={`absolute inset-0 bg-blue-900 border-white/30 rounded-[inherit] backface-hidden ${!faceDown ? 'hidden' : 'block'}`} style={{
        background: 'repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 5px, #2563eb 5px, #2563eb 10px)',
        transform: 'rotateY(180deg)',
      }} />
    </motion.div>
  );
}

function SuitIcon({ suit, className }: { suit: string, className?: string }) {
  const style = { fontSize: '1.2em', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  switch (suit) {
    case 'Copas': return <span className={className} style={style}>♥</span>;
    case 'Ouros': return <span className={className} style={style}>♦</span>;
    case 'Espadas': return <span className={className} style={style}>♠</span>;
    case 'Paus': return <span className={className} style={style}>♣</span>;
    default: return null;
  }
}
