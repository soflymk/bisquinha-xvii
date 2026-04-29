/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, Card, ChatMessage } from '../lib/types';
import { ChevronLeft, WifiOff, RefreshCcw, Send, MessageSquare, Crown, X } from 'lucide-react';

// Cores por dupla
const TEAM_COLORS = {
  1: { ring: 'border-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Dupla 1', dot: 'bg-blue-500' },
  2: { ring: 'border-orange-500', bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'Dupla 2', dot: 'bg-orange-500' },
} as const;

export default function GameRoom() {
  const { user, socket, currentRoomId, setView } = useApp();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomData, setRoomData] = useState<{
    slots: (string | null)[];
    nicknames: Record<string, string>;
    teams: Record<string, number>;
    ownerId: string | null;
    spectators: { userId: string; nickname: string }[];
  }>({ slots: [null, null, null, null], nicknames: {}, teams: {}, ownerId: null, spectators: [] });
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
    spectatorId: string; spectatorNickname: string;
    losingTeam: number; candidates: { userId: string; nickname: string }[];
  } | null>(null);
  const [kickVote, setKickVote] = useState<{
    targetId: string; targetNickname: string;
    initiatorId: string; initiatorNickname: string; votes: string[];
  } | null>(null);
  // Novo: resultado da mão
  const [handResult, setHandResult] = useState<{
    team1Points: number; team2Points: number;
    winnerTeam: 1 | 2; pointsWon: number;
    newGameScore: { team1: number; team2: number };
    isCopas: boolean; isCapote: boolean;
  } | null>(null);
  // Revelação do Ás do trunfo (banner simples)
  const [aceReveal, setAceReveal] = useState<{ nickname: string } | null>(null);
  // Prompt de troca do 2 do corte
  const [trumpTwoPrompt, setTrumpTwoPrompt] = useState<{ corteCard: Card; twoCard: Card } | null>(null);
  const [swapPhase, setSwapPhase] = useState<'prompt' | 'animating' | null>(null);
  // Revelação especial do Ás quando 7 sai de fundo
  const [sevenFundoReveal, setSevenFundoReveal] = useState<{ aceCard: Card; nickname: string; phase: 'show' | 'hide' } | null>(null);
  // Revelação do 7 quando Ás é jogado antes
  const [sevenReveal, setSevenReveal] = useState<{ sevenCard: Card; nickname: string; phase: 'show' | 'hide' } | null>(null);
  // Fila de espectadores flutuante
  const [showSpecQueue, setShowSpecQueue] = useState(false);
  // Animação de distribuição pós-vaza
  const [postVazaDealActive, setPostVazaDealActive] = useState(false);
  // Animação da carta do corte sendo distribuída
  const [corteCardDealAnim, setCorteCardDealAnim] = useState<{ corteCard: Card; recipientId: string; phase: 'show' | 'flyout' } | null>(null);
  // Última rodada: troca de cartas entre parceiros
  const [lastRoundShare, setLastRoundShare] = useState<{
    partnerCards: Card[];
    partnerNickname: string;
    phase: 'sending' | 'viewing' | 'returning';
  } | null>(null);

  // Ref para roomData dentro de callbacks de socket (evita stale closure)
  const roomDataRef = useRef(roomData);
  useEffect(() => { roomDataRef.current = roomData; }, [roomData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!socket || !currentRoomId) return;
    socket.emit('join_room', currentRoomId);

    socket.on('init_sync', (data: any) => {
      setGameState(data.gameState);
      setConfig(data.config);
      setRoomData({ slots: data.slots, nicknames: data.nicknames, teams: data.teams, ownerId: data.ownerId, spectators: data.spectators || [] });
      if (data.chat) setMessages(data.chat);
    });

    socket.off('chat_message').on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    });

    socket.on('player_disconnected', (data: { nickname: string, timeout: number }) => {
      setWaitingForPlayer({ nickname: data.nickname, deadline: Date.now() + data.timeout });
    });
    socket.on('player_reconnected', () => setWaitingForPlayer(null));

    socket.on('swap_request_received', (data: any) => {
      if (data.toUserId === user?.id) setSwapReq({ from: data.from, fromNickname: data.fromNickname });
    });

    socket.on('room_update', (data: any) => setRoomData(prev => ({ ...prev, ...data })));
    socket.on('game_started', (state: GameState) => { setGameState(state); setSysMsg('A partida começou!'); });
    socket.on('game_update', (state: GameState) => {
      setGameState(state);
      if (state.corteSwapDone || state.roundCount > 0) {
        setTrumpTwoPrompt(null);
        setSwapPhase(null);
      }
    });

    socket.on('vaza_resolved', ({ winnerId }: { winnerId: string }) => {
      const rd = roomDataRef.current;
      const winnerTeam = rd.teams[winnerId];
      const myTeam = rd.teams[user?.id || ''];
      if (winnerTeam === myTeam) setMyTeamCardCount(prev => prev + 4);
      else setOpponentCardCount(prev => prev + 4);
    });

    socket.on('queue_updated', ({ spectators }: any) => setRoomData(prev => ({ ...prev, spectators })));
    socket.on('spectator_choose_replacement', (data: any) => setSpectatorChoose(data));

    socket.on('kick_vote_started', (data: any) => setKickVote(data));
    socket.on('kick_vote_update', ({ votes }: any) => setKickVote(prev => prev ? { ...prev, votes } : null));
    socket.on('kick_vote_result', ({ passed, targetNickname, reason }: any) => {
      setKickVote(null);
      if (passed) setSysMsg(`${targetNickname} foi removido da sala.`);
      else if (reason !== 'iniciador saiu') setSysMsg(reason === 'tempo' ? 'Votação expirou.' : 'Votação cancelada.');
    });
    socket.on('kicked_from_room', () => { setIsAborted(true); setSysMsg('Você foi removido da sala por votação.'); });

    socket.on('heley_notice', ({ team, points }: any) => {
      setHeleyNotice({ team, points });
      setTimeout(() => setHeleyNotice(null), 3500);
    });

    socket.on('hand_finished', (data: any) => {
      setHandResult(data);
    });

    socket.on('game_finished', ({ winnerTeam }: any) => {
      setSysMsg(`PARTIDA ENCERRADA! A dupla ${winnerTeam} é a grande campeã!`);
    });

    socket.on('system_message', (msg: string) => {
      setSysMsg(msg);
      setTimeout(() => setSysMsg(null), 4000);
    });

    socket.on('game_aborted', ({ reason }: any) => { setIsAborted(true); setSysMsg(reason); });
    socket.on('error', (err: string) => {
      setGameError(err);
      setTimeout(() => setGameError(null), 3000);
    });

    // Revelação do Ás do trunfo (banner simples — quando 7 jogado sem ser fundo)
    socket.on('trump_ace_reveal', ({ nickname }: { nickname: string }) => {
      setAceReveal({ nickname });
      setTimeout(() => setAceReveal(null), 3000);
    });

    // 2 do corte disponível para troca
    socket.on('trump_two_available', (data: any) => {
      setTrumpTwoPrompt({ corteCard: data.corteCard, twoCard: data.twoCard });
      setSwapPhase('prompt');
    });

    // 7 de fundo: revelação dramática do Ás
    socket.on('trump_seven_fundo_ace_reveal', (data: any) => {
      setSevenFundoReveal({ aceCard: data.aceCard, nickname: data.nickname, phase: 'show' });
      setTimeout(() => {
        setSevenFundoReveal(prev => prev ? { ...prev, phase: 'hide' } : null);
        setTimeout(() => setSevenFundoReveal(null), 700);
      }, 1800);
    });

    // Ás jogado: revela o 7 que o player tem na mão
    socket.on('trump_seven_reveal', (data: any) => {
      setSevenReveal({ sevenCard: data.sevenCard, nickname: data.nickname, phase: 'show' });
      setTimeout(() => {
        setSevenReveal(prev => prev ? { ...prev, phase: 'hide' } : null);
        setTimeout(() => setSevenReveal(null), 600);
      }, 1800);
    });

    // Animação de distribuição pós-vaza
    socket.on('post_vaza_deal_sequence', ({ dealOrder }: { dealOrder: (string | null)[] }) => {
      setPostVazaDealActive(true);
      dealOrder.forEach((uid, idx) => {
        setTimeout(() => {
          if (!uid) return;
          const rd = roomDataRef.current;
          const playerIdx = rd.slots.indexOf(uid);
          const myIdxLocal = rd.slots.indexOf(user?.id || null);
          const relPos = myIdxLocal === -1 ? playerIdx : (playerIdx - myIdxLocal + 4) % 4;
          setFlyingCardRelPos(relPos);
          setFlyingCardKey(k => k + 1);
        }, idx * 360);
      });
      setTimeout(() => {
        setPostVazaDealActive(false);
        setFlyingCardRelPos(null);
      }, dealOrder.length * 360 + 500);
    });

    // Animação da carta do corte sendo distribuída
    socket.on('corte_card_deal_animation', (data: any) => {
      setCorteCardDealAnim({ corteCard: data.corteCard, recipientId: data.recipientId, phase: 'show' });
      setTimeout(() => setCorteCardDealAnim(prev => prev ? { ...prev, phase: 'flyout' } : null), 800);
      setTimeout(() => setCorteCardDealAnim(null), 1500);
    });

    // Última rodada: compartilhamento de cartas
    socket.on('last_round_card_share', (data: any) => {
      setLastRoundShare({ partnerCards: data.partnerCards, partnerNickname: data.partnerNickname, phase: 'sending' });
      setTimeout(() => setLastRoundShare(prev => prev ? { ...prev, phase: 'viewing' } : null), 1200);
      setTimeout(() => setLastRoundShare(prev => prev ? { ...prev, phase: 'returning' } : null), 6200);
      setTimeout(() => setLastRoundShare(null), 7500);
    });
    socket.on('last_round_share_done', () => setLastRoundShare(null));

    return () => {
      ['init_sync','room_update','game_started','game_update','vaza_resolved','heley_notice',
       'hand_finished','game_finished','system_message','game_aborted','error',
       'swap_request_received','queue_updated','spectator_choose_replacement',
       'kick_vote_started','kick_vote_update','kick_vote_result','kicked_from_room',
       'player_disconnected','player_reconnected','trump_ace_reveal',
       'trump_two_available','trump_seven_fundo_ace_reveal','trump_seven_reveal',
       'post_vaza_deal_sequence','corte_card_deal_animation',
       'last_round_card_share','last_round_share_done'
      ].forEach(ev => socket.off(ev));
    };
  }, [socket, currentRoomId, user?.id]);

  // Auto-fechar modal de resultado após 8s (servidor inicia próxima mão em 9s)
  useEffect(() => {
    if (!handResult) return;
    const t = setTimeout(() => setHandResult(null), 8000);
    return () => clearTimeout(t);
  }, [handResult]);

  useEffect(() => {
    if (!waitingForPlayer) return;
    const interval = setInterval(() => setWaitingForPlayer(prev => prev ? { ...prev } : null), 1000);
    return () => clearInterval(interval);
  }, [waitingForPlayer]);

  useEffect(() => {
    if (gameState?.status === 'CUTTING' && !gameState.visibleCorte) setPendingCorte(false);
    if (gameState?.status === 'SHUFFLING') {
      setMyTeamCardCount(0);
      setOpponentCardCount(0);
      setHandResult(null);
      setLastRoundShare(null);
      setCorteCardDealAnim(null);
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

  const requestSwap = (toIdx: number) => socket?.emit('request_swap', { roomId: currentRoomId, toIdx });
  const acceptSwap = () => { if (swapReq) { socket?.emit('accept_swap', { roomId: currentRoomId, fromUserId: swapReq.from }); setSwapReq(null); } };
  const startGame = () => socket?.emit('start_game', currentRoomId);
  const playCard = (cardId: string) => { if (gameState?.currentTurn !== user?.id) return; socket?.emit('play_card', { roomId: currentRoomId, cardId }); };
  const swap2Corte = () => socket?.emit('swap_corte_2', currentRoomId);
  const performTwoSwap = () => {
    setSwapPhase('animating');
    setTimeout(() => {
      socket?.emit('swap_corte_2', currentRoomId);
      setTrumpTwoPrompt(null);
      setSwapPhase(null);
    }, 1800);
  };
  const selectCorte = (cardId?: string, isBater?: boolean) => { setPendingCorte(true); socket?.emit('select_corte', { roomId: currentRoomId, cardId, isBater }); };
  const sendChat = (e: React.FormEvent) => { e.preventDefault(); if (!chatInput.trim()) return; socket?.emit('send_chat', { roomId: currentRoomId, text: chatInput }); setChatInput(''); };
  const initiateKick = (targetId: string) => socket?.emit('initiate_kick', { roomId: currentRoomId, targetId });
  const castKickVote = (approve: boolean) => socket?.emit('cast_kick_vote', { roomId: currentRoomId, approve });
  const handleSpectatorPick = (removeUserId: string) => { socket?.emit('spectator_remove_player', { roomId: currentRoomId, removeUserId }); setSpectatorChoose(null); };
  const leaveRoom = () => { socket?.emit('leave_room', currentRoomId); setView('LOBBY'); };

  const isSpectator = roomData.spectators.some(s => s.userId === user?.id);
  const myIdx = roomData.slots.indexOf(user?.id || null);
  const getRelPos = (absIdx: number) => myIdx === -1 ? absIdx : (absIdx - myIdx + 4) % 4;

  // Calcula qual time está ganhando a mão atual
  const leadingTeam = (() => {
    if (gameState?.status !== 'IN_GAME') return null;
    let t1 = 0, t2 = 0;
    for (const p of Object.values(gameState.players) as any[]) {
      if (p.team === 1) t1 += p.vazaPoints; else t2 += p.vazaPoints;
    }
    if (t1 === t2) return null;
    return t1 > t2 ? 1 : 2;
  })();

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
      {/* ── Sidebar Desktop ── */}
      <aside className="hidden lg:flex w-60 bg-slate-800 border-r border-slate-700 p-4 flex-col shrink-0 gap-3">
        <div>
          <h1 className="text-base font-bold text-blue-400">Bisquinha CFO XVII</h1>
          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Sala: {currentRoomId?.slice(0,8)}</p>
        </div>

        {/* Placar + Duplas unificado */}
        <div className="bg-slate-900 rounded-lg p-3 border-l-4 border-blue-500">
          <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-2">Placar da Partida</p>

          {/* Duplas com membros */}
          <div className="flex gap-1.5 mb-3">
            {([1, 2] as const).map(team => {
              const members = roomData.slots.filter(uid => uid && roomData.teams[uid] === team);
              const tc = TEAM_COLORS[team];
              return (
                <div key={team} className={`flex-1 rounded-lg px-2 py-1.5 border ${tc.bg}`}
                  style={{ borderColor: team === 1 ? '#3b82f6' : '#f97316', borderWidth: 1 }}>
                  <span className={`text-[8px] font-black uppercase tracking-widest ${tc.text}`}>{tc.label}</span>
                  <div className="mt-1 space-y-0.5">
                    {members.length === 0 ? (
                      <span className="text-[8px] text-slate-600 italic">aguardando...</span>
                    ) : members.map(uid => (
                      <div key={uid} className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${tc.dot}`} />
                        <span className={`text-[8px] font-bold truncate leading-tight ${uid === user?.id ? tc.text : 'text-slate-300'}`}>
                          {roomData.nicknames[uid!] || '?'}{uid === user?.id ? ' (você)' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Placar numérico */}
          <div className="flex justify-between items-center px-1">
            <span className="text-2xl font-bold text-white">{gameState?.gameScore.team1 || 0}</span>
            <span className="text-slate-600 font-bold text-xs">vs</span>
            <span className="text-2xl font-bold text-white">{gameState?.gameScore.team2 || 0}</span>
          </div>
          <p className="text-[9px] text-center mt-2 text-blue-300 font-bold uppercase tracking-widest bg-blue-500/10 py-1 rounded">Meta: {config?.scoreGoal || 5} pts</p>
        </div>

        {/* Mão atual */}
        {gameState && (
          <div className="bg-slate-900 rounded-lg p-3 border-l-4 border-emerald-500">
            <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mb-1">Mão Atual</p>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-slate-400">Trunfo:</span>
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <SuitIcon suit={gameState.trumpSuit || ''} className="w-3 h-3" />
                {(gameState.trumpSuit || '').toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between items-center mt-1">
              <span className="text-[10px] text-slate-400">Modo:</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                gameState.isCopas ? 'bg-red-500/20 text-red-400' :
                (!gameState.visibleCorte && gameState.status === 'IN_GAME') ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-slate-800 text-slate-500'}`}>
                {gameState.isCopas ? 'COPAS' : (!gameState.visibleCorte && gameState.status === 'IN_GAME') ? 'BISCA' : 'NORMAL'}
              </span>
            </div>
          </div>
        )}

        {/* Chat */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-900/50 rounded-xl border border-white/5 overflow-hidden">
          <div className="p-2 border-b border-white/5 flex items-center gap-2 shrink-0">
            <MessageSquare size={12} className="text-blue-400" />
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Resenha</span>
            <span className={`ml-auto text-[7px] font-black uppercase px-1.5 py-0.5 rounded ${isSpectator ? 'bg-amber-900/40 text-amber-500' : 'bg-blue-900/40 text-blue-400'}`}>
              {isSpectator ? '👁 Specs' : '🃏 Players'}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
            {messages.map(m => (
              <div key={m.id} className="flex flex-col">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-[8px] font-black uppercase ${m.userId === user?.id ? 'text-blue-400' : 'text-slate-500'}`}>{m.nickname}</span>
                  <span className="text-[7px] text-slate-600">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-[10px] text-slate-300 leading-tight mt-0.5 break-words font-medium">{m.text}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendChat} className="p-2 bg-slate-900 border-t border-white/5 flex gap-1.5 shrink-0">
            <input
              type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              placeholder="Falar..." maxLength={200}
              className="flex-1 min-w-0 bg-slate-800 border-none rounded-lg px-2 py-1.5 text-[10px] text-white focus:ring-1 focus:ring-blue-500 font-medium"
            />
            <button type="submit" className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded-lg transition active:scale-95">
              <Send size={12} />
            </button>
          </form>
        </div>

        <button onClick={leaveRoom} className="shrink-0 py-2 bg-red-900/20 hover:bg-red-800/40 rounded-xl text-[10px] font-bold text-red-200 transition">
          Sair da Sala
        </button>
      </aside>

      {/* Modal de Reconexão */}
      <AnimatePresence>
        {waitingForPlayer && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-[300] p-4 text-center">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-800 border-2 border-red-500/50 p-10 rounded-[2.5rem] shadow-2xl max-w-md">
              <WifiOff size={40} className="text-red-400 mx-auto mb-6 animate-pulse" />
              <h3 className="text-xl font-black text-white mb-2 uppercase">Jogador Ausente</h3>
              <p className="text-slate-400 mb-4"><span className="text-red-400 font-bold">@{waitingForPlayer.nickname}</span> desconectou.</p>
              <div className="text-4xl font-black text-red-500 font-mono">
                {Math.max(0, Math.ceil((waitingForPlayer.deadline - Date.now()) / 1000))}s
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Área Principal do Jogo ── */}
      <main className="flex-1 relative flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800 shrink-0">
          <button onClick={leaveRoom} className="p-1.5 text-slate-500 hover:text-white"><ChevronLeft size={18} /></button>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/80 rounded-xl border border-white/5">
            <span className="text-[8px] text-blue-400 font-bold">D1</span>
            <span className="text-sm font-black text-white">{gameState?.gameScore.team1 || 0}</span>
            <span className="text-slate-600 font-bold text-xs">vs</span>
            <span className="text-sm font-black text-white">{gameState?.gameScore.team2 || 0}</span>
            <span className="text-[8px] text-orange-400 font-bold">D2</span>
          </div>
          <button onClick={() => setShowChatMb(true)} className="p-1.5 text-slate-500 hover:text-white"><MessageSquare size={18} /></button>
        </div>

        {/* Mesa de Jogo */}
        <div className="flex-1 flex flex-col justify-center items-center relative overflow-hidden p-2 md:p-6">
          <div className="game-table relative w-[95%] h-[95%] max-w-[800px] max-h-[480px] flex items-center justify-center" style={{
            background: 'radial-gradient(circle, #14532d 0%, #064e3b 100%)',
            border: '8px solid #334155',
            borderRadius: 'min(200px, 40vw)',
            boxShadow: 'inset 0 0 100px rgba(0,0,0,0.5), 0 20px 50px rgba(0,0,0,0.3)'
          }}>
            {/* Slots dos jogadores */}
            {roomData.slots.map((uid, idx) => {
              const relPos = getRelPos(idx);
              const team = roomData.teams[uid || ''] as 1 | 2 | undefined;
              return (
                <PlayerSlot
                  key={idx}
                  relPos={relPos}
                  isTurn={gameState?.currentTurn === uid}
                  nickname={roomData.nicknames[uid || ''] || '...'}
                  isMe={uid === user?.id}
                  team={team}
                  vazaCard={gameState?.vaza.find(v => v.userId === uid)?.card}
                  onSwap={() => requestSwap(idx)}
                  showSwap={gameState === null && uid !== user?.id}
                  isOwner={uid === roomData.ownerId}
                  handSize={gameState?.players[uid || '']?.hand.length || 0}
                  visibleHand={isSpectator && config?.spectatorsSeeHands ? (gameState?.players[uid || '']?.hand || []) : undefined}
                  isRoundStarter={gameState?.status === 'IN_GAME' && gameState.vaza[0]?.userId === uid}
                  isLeadingTeam={leadingTeam !== null && team === leadingTeam}
                  canKick={!isSpectator && uid !== null && uid !== user?.id && !kickVote && !!gameState}
                  onKick={() => uid && initiateKick(uid)}
                />
              );
            })}

            {/* Fila de espectadores — olho flutuante, canto inferior-esquerdo */}
            {roomData.spectators.length > 0 && (
              <div className="absolute bottom-2 left-3 z-40">
                <AnimatePresence>
                  {showSpecQueue && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-8 left-0 bg-slate-900/95 border border-amber-500/40 rounded-xl p-3 w-44 shadow-2xl backdrop-blur-sm"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Fila de Espera</span>
                        <button onClick={() => setShowSpecQueue(false)} className="text-slate-500 hover:text-white"><X size={10} /></button>
                      </div>
                      <div className="space-y-1">
                        {roomData.spectators.map((s, i) => (
                          <div key={s.userId} className="flex items-center gap-1.5">
                            <span className="text-[8px] font-black text-amber-500 w-4">#{i+1}</span>
                            <span className={`text-[8px] font-bold truncate ${s.userId === user?.id ? 'text-amber-300' : 'text-slate-400'}`}>{s.nickname}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  onClick={() => setShowSpecQueue(v => !v)}
                  className="flex items-center gap-1 bg-amber-900/60 hover:bg-amber-800/80 border border-amber-500/40 text-amber-400 rounded-full px-2 py-1 text-[8px] font-black shadow-lg transition"
                >
                  <span>👁</span>
                  <span>{roomData.spectators.length}</span>
                </button>
              </div>
            )}

            {/* Monte da Minha Dupla — canto inferior-esquerdo */}
            {myTeamCardCount > 0 && (
              <div className="absolute bottom-2 left-3 pointer-events-none z-30">
                <div className="text-[7px] font-black text-amber-400 mb-0.5 uppercase tracking-widest">Sua Dupla</div>
                <div className="relative w-14 h-10">
                  {Array.from({ length: Math.min(myTeamCardCount, 10) }).map((_, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, scale: 0.3, x: 0, y: 20 }}
                      animate={{ opacity: 1, scale: 1, x: ((i * 13) % 19) - 9, y: ((i * 7) % 11) - 5 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 180, delay: 0.03 * i }}
                      className="absolute w-7 h-10 rounded-md border shadow-md"
                      style={{
                        background: 'repeating-linear-gradient(45deg,#713f12,#713f12 3px,#a16207 3px,#a16207 6px)',
                        borderColor: 'rgba(234,179,8,0.5)',
                        transform: `rotate(${((i * 11) % 30) - 15}deg)`,
                        zIndex: i
                      }}
                    />
                  ))}
                </div>
                <div className="text-[8px] text-amber-300 font-bold text-center mt-0.5">{myTeamCardCount} cartas</div>
              </div>
            )}

            {/* Monte da Dupla Adversária — canto superior-direito */}
            {opponentCardCount > 0 && (
              <div className="absolute top-2 right-3 pointer-events-none z-30">
                <div className="text-[7px] font-black text-red-400 mb-0.5 uppercase tracking-widest text-right">Adversários</div>
                <div className="relative w-14 h-10">
                  {Array.from({ length: Math.min(opponentCardCount, 10) }).map((_, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, scale: 0.3, x: 0, y: -20 }}
                      animate={{ opacity: 1, scale: 1, x: ((i * 13) % 19) - 9, y: ((i * 7) % 11) - 5 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 180, delay: 0.03 * i }}
                      className="absolute w-7 h-10 rounded-md border shadow-md"
                      style={{
                        background: 'repeating-linear-gradient(45deg,#7f1d1d,#7f1d1d 3px,#b91c1c 3px,#b91c1c 6px)',
                        borderColor: 'rgba(239,68,68,0.5)',
                        transform: `rotate(${((i * 11) % 30) - 15}deg)`,
                        zIndex: i
                      }}
                    />
                  ))}
                </div>
                <div className="text-[8px] text-red-300 font-bold text-center mt-0.5">{opponentCardCount} cartas</div>
              </div>
            )}

            {/* Centro da Mesa */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {gameState ? (
                <div className="relative flex items-center justify-center scale-[0.6] sm:scale-75 md:scale-100 w-full h-full pointer-events-none">
                  {/* Animações de status */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {gameState.status === 'SHUFFLING' && (
                      <div className="flex flex-col items-center">
                        <motion.div className="relative w-14 h-20 md:w-16 md:h-24">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <motion.div key={i}
                              animate={{ x: [0,(i%2===0?15:-15),0], y:[0,(i%3===0?-10:10),0], rotate:[0,(i%2===0?10:-10),0] }}
                              transition={{ repeat: Infinity, duration: 0.4, delay: i*0.03 }}
                              className="absolute inset-0 rounded-lg border-2 border-white/30"
                              style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }}
                            />
                          ))}
                        </motion.div>
                        <p className="text-white font-black uppercase tracking-[0.2em] text-[8px] mt-4 animate-pulse italic bg-black/40 px-3 py-1 rounded-full border border-white/10">Embaralhando...</p>
                      </div>
                    )}

                    {gameState.status === 'CUTTING' && (
                      <div className="flex flex-col items-center gap-4 pointer-events-auto">
                        <div className="relative h-[120px] md:h-[150px] w-full flex items-center justify-center">
                          {gameState.cuttingCards.map((card, idx) => {
                            const isSelected = gameState.visibleCorte?.id === card.id;
                            const xPos = isSelected ? 0 : (idx - 2) * (isMobile ? 38 : 52);
                            const yPos = isSelected ? 0 : -Math.abs(idx - 2) * 8;
                            return (
                              <motion.div key={card.id} style={{ position: 'absolute' }}
                                initial={{ x: 0, y: 50, rotate: 0, opacity: 0 }}
                                animate={{ x: xPos, y: yPos, opacity: 1, rotate: isSelected ? 0 : (idx-2)*11, scale: isSelected ? 1.35 : (isMobile ? 0.75 : 0.9), zIndex: isSelected ? 100 : idx }}
                                whileHover={gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? { scale: 1.1, y: yPos-10 } : {}}
                                onClick={() => gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte && selectCorte(card.id)}
                                className={gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? 'cursor-pointer' : 'opacity-80'}
                              >
                                <GameCard card={card} size={isMobile ? 'sm' : 'md'} faceDown={!isSelected} />
                              </motion.div>
                            );
                          })}
                        </div>
                        {gameState.cutterId === user?.id && !gameState.visibleCorte && !pendingCorte ? (
                          <div className="flex flex-col items-center gap-3">
                            <p className="text-yellow-400 font-black uppercase tracking-widest text-[10px] animate-bounce bg-black/70 px-4 py-2 rounded-full border border-yellow-400/30">Corte o baralho!</p>
                            <button onClick={() => selectCorte(undefined, true)} className="bg-red-600 hover:bg-red-500 text-white font-black px-4 py-2 rounded-lg text-[10px] uppercase transition active:scale-95 border border-red-400/40">
                              BATER (COPAS)
                            </button>
                          </div>
                        ) : (!gameState.visibleCorte && !pendingCorte) && (
                          <p className="text-white/50 font-black uppercase tracking-widest text-[8px] bg-black/40 px-6 py-3 rounded-full">Aguardando corte...</p>
                        )}
                      </div>
                    )}

                    {gameState.status === 'DEALING' && (
                      <div className="flex flex-col items-center relative">
                        <div className="relative w-14 h-20 md:w-16 md:h-24">
                          {(() => {
                            const targetRelPos = gameState.lastDealtUserId ? getRelPos(roomData.slots.indexOf(gameState.lastDealtUserId)) : 0;
                            return (
                              <motion.div animate={{ rotate: [0, 90, 180, -90][targetRelPos] }} transition={{ type:'spring', damping:15, stiffness:150 }}
                                className="absolute inset-0 rounded-lg border-2 border-white/30 shadow-xl"
                                style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }}>
                                <div className="absolute top-2 w-1 h-4 bg-white/30 rounded-full left-1/2 -translate-x-1/2" />
                              </motion.div>
                            );
                          })()}
                        </div>
                        <p className="text-white font-black uppercase tracking-widest text-[8px] mt-10 animate-pulse italic bg-black/40 px-4 py-1 rounded-full border border-white/10">Dando cartas...</p>
                      </div>
                    )}
                  </div>

                  {/* Baralho + Carta do Corte */}
                  <div className="relative flex items-center justify-center">
                    {['IN_GAME', 'DEALING'].includes(gameState.status) && (
                      <motion.div initial={{ opacity:0, scale:0.8 }} animate={{ opacity:1, scale:1 }}
                        className="absolute left-[-150px] md:left-[-250px] flex items-center justify-center">
                        {/* Carta do corte — 1/3 sob o baralho, 2/3 exposta à direita */}
                        {!gameState.isCopas && gameState.visibleCorte && (
                          <div className={`absolute rotate-90 transition-all duration-500 ${gameState.status === 'IN_GAME' ? 'translate-x-[52px] md:translate-x-[60px]' : 'translate-x-2'}`}>
                            <GameCard card={gameState.visibleCorte} size="md" isCorte />
                          </div>
                        )}
                        {/* Baralho — só mostra quando tem cartas */}
                        {gameState.deck.length > 0 && gameState.status === 'IN_GAME' && (
                          <div className="relative z-10">
                            <div className="w-12 h-18 md:w-16 md:h-24 bg-blue-900 border-2 border-slate-100 rounded-lg shadow-2xl flex items-center justify-center"
                              style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }}>
                              <span className="text-white/30 font-black text-lg select-none">{gameState.deck.length}</span>
                            </div>
                          </div>
                        )}
                        {/* Animação da carta do corte sendo distribuída */}
                        <AnimatePresence>
                          {corteCardDealAnim && (
                            <motion.div
                              className="absolute z-[60] pointer-events-none"
                              initial={{ x: -80, y: 0, scale: 0.6, opacity: 0 }}
                              animate={corteCardDealAnim.phase === 'show'
                                ? { x: 0, y: 0, scale: 1.3, opacity: 1 }
                                : { x: corteCardDealAnim.recipientId === (roomData.slots[myIdx] || '') ? 0 : 200, y: corteCardDealAnim.recipientId === (roomData.slots[myIdx] || '') ? 120 : -80, scale: 0.4, opacity: 0 }}
                              transition={{ duration: corteCardDealAnim.phase === 'show' ? 0.35 : 0.5, ease: 'easeInOut' }}
                            >
                              <GameCard card={corteCardDealAnim.corteCard} size="lg" faceDown={corteCardDealAnim.phase === 'flyout'} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )}

                    {/* Flying card — distribuição inicial (DEALING) e pós-vaza */}
                    <AnimatePresence>
                      {flyingCardRelPos !== null && (gameState.status === 'DEALING' || postVazaDealActive) && (
                        <motion.div key={flyingCardKey}
                          initial={{ x:0, y:0, opacity:1, scale:1 }}
                          animate={{ x: flyingCardRelPos===1?260:flyingCardRelPos===3?-260:0, y: flyingCardRelPos===0?260:flyingCardRelPos===2?-260:0, opacity:0, scale:0.75 }}
                          transition={{ duration:0.35, ease:'easeOut' }}
                          className="absolute w-10 h-14 md:w-14 md:h-20 rounded-lg border-2 border-white/30 shadow-xl pointer-events-none z-50"
                          style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }}
                        />
                      )}
                    </AnimatePresence>

                    {/* Cartas na mesa (vaza) */}
                    <AnimatePresence>
                      {gameState.vaza.map((v, i) => {
                        const playerIdx = roomData.slots.indexOf(v.userId);
                        const relPos = getRelPos(playerIdx);
                        const offsetX = i * 40 - 60;
                        const offsetY = i * -15;
                        const winnerTeam = roomData.teams[gameState.lastVazaWinner || ''];
                        const myTeam = roomData.teams[user?.id || ''];
                        const isMyTeamWin = winnerTeam === myTeam;
                        return (
                          <motion.div key={v.userId + v.card.id}
                            initial={{ x:(relPos===0?0:relPos===1?400:relPos===2?0:-400), y:(relPos===0?400:relPos===1?0:relPos===2?-400:0), opacity:0, scale:0.5, rotate:0, rotateY:180 }}
                            animate={{ x:offsetX, y:offsetY, opacity:1, scale:1, rotate:(i*10-15), rotateY:0 }}
                            exit={{
                              // Vai para o monte da dupla correspondente
                              x: isMyTeamWin ? -320 : 320,
                              y: isMyTeamWin ? 280 : -280,
                              opacity: 0, scale: 0.25,
                              transition: { duration: 0.55, ease: 'easeIn', delay: i * 0.04 }
                            }}
                            transition={{ type:'spring', damping:15, stiffness:80 }}
                            className="absolute" style={{ zIndex: i }}
                          >
                            <GameCard card={v.card} size="lg" />
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              ) : (
                /* Sala de espera (sem jogo) */
                <div className="text-center pointer-events-auto bg-black/20 p-6 md:p-12 rounded-full border border-white/5 backdrop-blur-sm">
                  <h3 className="text-white font-black uppercase tracking-widest text-[10px] md:text-sm mb-3">Sala de Espera</h3>
                  <div className="flex gap-2 justify-center mb-6">
                    {roomData.slots.map((s, i) => {
                      const team = roomData.teams[s || ''] as 1 | 2 | undefined;
                      const tc = team ? TEAM_COLORS[team] : null;
                      return (
                        <div key={i} className="relative flex flex-col items-center gap-1">
                          <div className={`w-3 h-3 rounded-full ${s ? (tc?.dot || 'bg-blue-500') : 'bg-slate-800'} ${s ? 'shadow-[0_0_8px_rgba(59,130,246,0.5)]' : ''}`} />
                          {s === roomData.ownerId && <Crown size={8} fill="currentColor" className="text-yellow-500" />}
                        </div>
                      );
                    })}
                  </div>
                  {user?.id === roomData.ownerId && !gameState && (
                    <button onClick={startGame}
                      disabled={roomData.slots.filter(s=>s!==null).length !== 4}
                      className={`font-black px-8 py-3 rounded-2xl shadow-xl transition active:scale-95 border text-xs ${roomData.slots.filter(s=>s!==null).length===4 ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400/30' : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'}`}>
                      {roomData.slots.filter(s=>s!==null).length === 4 ? 'PARTIR PRO JOGO' : 'AGUARDANDO JOGADORES'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Mensagem de sistema */}
          <AnimatePresence>
            {sysMsg && (
              <motion.div initial={{ y:50, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:-50, opacity:0 }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-blue-600/90 backdrop-blur text-white px-6 py-2 rounded-full border border-blue-400/50 text-[10px] font-black tracking-widest uppercase z-[120] shadow-2xl pointer-events-none">
                {sysMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Erro */}
          <AnimatePresence>
            {gameError && (
              <motion.div initial={{ y:-60, opacity:0, scale:0.9 }} animate={{ y:0, opacity:1, scale:1 }} exit={{ y:-60, opacity:0 }}
                transition={{ type:'spring', damping:20, stiffness:300 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-[160] pointer-events-none">
                <div className="flex items-center gap-3 bg-red-950/95 border-2 border-red-500/70 text-red-200 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md max-w-[340px]">
                  <span className="text-red-400 text-lg shrink-0">⛔</span>
                  <p className="text-xs font-bold leading-snug">{gameError}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Heley */}
          <AnimatePresence>
            {heleyNotice && (
              <motion.div initial={{ scale:0.3, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.5, opacity:0, y:-40 }}
                transition={{ type:'spring', damping:12, stiffness:200 }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-[150]">
                <div className="flex flex-col items-center gap-2">
                  <div className="bg-gradient-to-b from-yellow-400 to-amber-600 text-black font-black text-xl md:text-3xl px-8 py-4 rounded-2xl shadow-2xl border-4 border-yellow-300 tracking-widest uppercase">⚡ HELEY! ⚡</div>
                  <div className="bg-black/70 text-yellow-300 font-black text-xs px-6 py-2 rounded-full border border-yellow-500/40">
                    Dupla {heleyNotice.team} +{heleyNotice.points} ponto{heleyNotice.points > 1 ? 's' : ''}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Revelação do Ás do Trunfo */}
          <AnimatePresence>
            {aceReveal && (
              <motion.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
                className="absolute top-6 left-1/2 -translate-x-1/2 z-[155] pointer-events-none">
                <div className="flex items-center gap-2 bg-purple-950/95 border-2 border-purple-400/60 text-purple-200 px-5 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md">
                  <span className="text-lg">🃏</span>
                  <p className="text-xs font-bold"><span className="text-purple-300 font-black">{aceReveal.nickname}</span> tem o Ás do trunfo!</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Rodapé — Mão do jogador */}
        <div className="h-36 md:h-44 flex items-center justify-center p-3 md:p-6 bg-slate-900/50 border-t border-slate-800 relative z-10 shrink-0">
          <div className="flex gap-4 md:gap-8 items-center w-full max-w-4xl justify-center">
            <div className="hidden sm:flex flex-col items-center">
              <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full border-2 md:border-4 overflow-hidden mb-1 shadow-lg ${myIdx !== -1 && roomData.teams[user?.id || ''] ? (TEAM_COLORS[roomData.teams[user?.id || ''] as 1|2]?.ring) : 'border-blue-500'}`}>
                <div className="w-full h-full flex items-center justify-center font-black text-blue-400 text-xs bg-slate-800">
                  {user?.nickname[0].toUpperCase()}
                </div>
              </div>
              <span className="text-[9px] font-black text-slate-500 uppercase">Você</span>
            </div>

            <div className="flex gap-2 md:gap-3 p-3 md:p-4 bg-slate-800/50 rounded-[2rem] border border-white/5 shadow-inner backdrop-blur flex-1 max-w-[400px] justify-center overflow-x-auto min-h-[90px] md:min-h-[110px] items-end">
              {isSpectator ? (
                <div className="flex flex-col items-center justify-center gap-2 w-full">
                  <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-500/40 px-4 py-2 rounded-full">
                    <span className="text-amber-400">👁</span>
                    <span className="text-amber-300 font-black text-xs uppercase">Espectador</span>
                    <span className="text-amber-500 font-bold text-xs">#{roomData.spectators.findIndex(s => s.userId === user?.id) + 1}</span>
                  </div>
                  <p className="text-slate-500 text-[9px] uppercase">Aguardando vaga na próxima partida</p>
                </div>
              ) : (
                <>
                  <AnimatePresence>
                    {gameState?.players[user?.id || '']?.hand.map(card => (
                      <motion.div key={card.id}
                        initial={{ y:100, opacity:0, scale:0.5 }} animate={{ y:0, opacity:1, scale:1 }} exit={{ y:-100, opacity:0 }}
                        whileHover={{ y:-28, scale:1.08 }}
                        onClick={() => playCard(card.id)}
                        className={`${gameState.currentTurn === user?.id ? 'cursor-pointer' : 'opacity-60 pointer-events-none'} flex-shrink-0 origin-bottom`}>
                        <GameCard card={card} size="hand" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {(!gameState || gameState.status === 'SHUFFLING') && (
                    <div className="flex gap-2 opacity-10">
                      {[0,1,2].map(i => <div key={i} className="w-12 h-16 md:w-16 md:h-24 bg-slate-600 rounded-xl" />)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Chat Mobile */}
        <AnimatePresence>
          {showChatMb && (
            <div className="fixed inset-0 z-[400] lg:hidden flex flex-col bg-slate-950">
              <header className="p-4 bg-slate-900 border-b border-white/5 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3">
                  <MessageSquare size={18} className="text-blue-400" />
                  <h3 className="font-black text-white uppercase text-sm italic">Resenha</h3>
                </div>
                <button onClick={() => setShowChatMb(false)} className="p-2 text-slate-500 hover:text-white"><X size={22} /></button>
              </header>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map(m => (
                  <div key={m.id} className={`flex flex-col ${m.userId === user?.id ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className={`text-[9px] font-black uppercase ${m.userId === user?.id ? 'text-blue-400' : 'text-slate-500'}`}>{m.nickname}</span>
                      <span className="text-[7px] text-slate-600">{new Date(m.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</span>
                    </div>
                    <div className={`p-3 rounded-2xl max-w-[85%] text-sm font-medium ${m.userId === user?.id ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>{m.text}</div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={sendChat} className="p-4 bg-slate-900 border-t border-white/5 flex gap-3 pb-8 shrink-0">
                <input autoFocus type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Mande sua real aqui..."
                  className="flex-1 bg-slate-800 border-none rounded-2xl px-5 py-3 text-white focus:ring-2 focus:ring-blue-500 font-bold placeholder:text-slate-600" />
                <button type="submit" className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl active:scale-95"><Send size={20} /></button>
              </form>
            </div>
          )}
        </AnimatePresence>

        {/* Revelação do 7 — Ás jogado antes do 7 */}
        <AnimatePresence>
          {sevenReveal && (
            <motion.div className="absolute inset-0 flex flex-col items-center justify-center z-[258] pointer-events-none"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="bg-black/55 backdrop-blur-sm absolute inset-0" />
              <motion.div className="relative z-10 flex flex-col items-center gap-3"
                initial={{ scale: 0.3, y: 60 }}
                animate={sevenReveal.phase === 'show' ? { scale: 1.9, y: 0 } : { scale: 0.4, y: 80, opacity: 0 }}
                transition={{ type: 'spring', damping: 18, stiffness: 220 }}>
                <GameCard card={sevenReveal.sevenCard} size="lg" />
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={sevenReveal.phase === 'show' ? { opacity: 1, y: 0 } : { opacity: 0 }}
                className="relative z-10 mt-8 text-white font-black text-xs uppercase tracking-widest bg-emerald-800/90 px-4 py-2 rounded-full border border-emerald-400/50">
                {sevenReveal.nickname} tem o 7 do corte!
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Última rodada — troca de cartas entre parceiros */}
        <AnimatePresence>
          {lastRoundShare && (
            <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center z-[275] p-4">
              <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="bg-slate-800 border-2 border-blue-500/60 p-6 rounded-[2rem] shadow-2xl max-w-sm w-full text-center">

                {lastRoundShare.phase === 'sending' && (
                  <>
                    <div className="text-2xl mb-2">↑</div>
                    <h4 className="text-sm font-black text-white uppercase mb-1">Última rodada!</h4>
                    <p className="text-slate-400 text-xs mb-4">Enviando suas cartas para <span className="text-blue-300 font-bold">{lastRoundShare.partnerNickname}</span> ver...</p>
                    <div className="flex justify-center gap-2">
                      {[0,1,2].map(i => (
                        <motion.div key={i}
                          initial={{ y: 0, opacity: 1 }}
                          animate={{ y: -80, opacity: 0 }}
                          transition={{ delay: i * 0.15, duration: 0.5 }}>
                          <div className="w-10 h-14 rounded-lg border-2 border-white/30"
                            style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }} />
                        </motion.div>
                      ))}
                    </div>
                  </>
                )}

                {lastRoundShare.phase === 'viewing' && (
                  <>
                    <h4 className="text-sm font-black text-white uppercase mb-1">Cartas de {lastRoundShare.partnerNickname}</h4>
                    <p className="text-slate-500 text-[9px] mb-4 uppercase font-bold">Visível apenas para você</p>
                    <div className="flex justify-center gap-3 flex-wrap">
                      {lastRoundShare.partnerCards.map(card => (
                        <motion.div key={card.id}
                          initial={{ y: -40, opacity: 0, scale: 0.7 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', damping: 18 }}>
                          <GameCard card={card} size="md" />
                        </motion.div>
                      ))}
                    </div>
                    <div className="mt-4 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <motion.div className="h-full bg-blue-500 rounded-full"
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: 5, ease: 'linear' }} />
                    </div>
                  </>
                )}

                {lastRoundShare.phase === 'returning' && (
                  <>
                    <div className="text-2xl mb-2">↓</div>
                    <h4 className="text-sm font-black text-white uppercase mb-1">Retornando suas cartas...</h4>
                    <div className="flex justify-center gap-2">
                      {[0,1,2].map(i => (
                        <motion.div key={i}
                          initial={{ y: -80, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: i * 0.15, duration: 0.4 }}>
                          <div className="w-10 h-14 rounded-lg border-2 border-white/30"
                            style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)' }} />
                        </motion.div>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Revelação dramática do Ás — 7 de fundo */}
        <AnimatePresence>
          {sevenFundoReveal && (
            <motion.div
              className="absolute inset-0 flex flex-col items-center justify-center z-[260] pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="bg-black/60 backdrop-blur-sm absolute inset-0" />
              <motion.div
                className="relative z-10 flex flex-col items-center gap-3"
                initial={{ scale: 0.3, y: 60 }}
                animate={sevenFundoReveal.phase === 'show'
                  ? { scale: 2.2, y: 0 }
                  : { scale: 0.4, y: 80, opacity: 0 }}
                transition={{ type: 'spring', damping: 18, stiffness: 220 }}
              >
                <GameCard card={sevenFundoReveal.aceCard} size="lg" />
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={sevenFundoReveal.phase === 'show' ? { opacity: 1, y: 0 } : { opacity: 0 }}
                className="relative z-10 mt-8 text-white font-black text-xs uppercase tracking-widest bg-purple-800/90 px-4 py-2 rounded-full border border-purple-400/50"
              >
                {sevenFundoReveal.nickname} tem o Ás do corte!
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal: troca do 2 do corte */}
        <AnimatePresence>
          {trumpTwoPrompt && swapPhase && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[270] p-4">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                className="bg-slate-800 border-2 border-yellow-500/60 p-6 rounded-[2rem] shadow-2xl max-w-xs w-full text-center"
              >
                <div className="text-2xl mb-1">🔄</div>
                <h4 className="text-sm font-black text-white uppercase mb-1">Você tem o 2 do corte!</h4>
                <p className="text-slate-400 text-[9px] mb-4">Quer trocar pelo <span className="text-yellow-300 font-bold">{trumpTwoPrompt.corteCard.value} de {trumpTwoPrompt.corteCard.suit}</span>?</p>

                {/* Animação das cartas */}
                <div className="flex items-center justify-center gap-4 my-4">
                  <motion.div
                    animate={swapPhase === 'animating' ? { x: 80, opacity: 0, scale: 0.5 } : { x: 0, opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center gap-1"
                  >
                    <GameCard card={trumpTwoPrompt.twoCard} size="sm" />
                    <span className="text-[7px] text-slate-400 font-bold">sua mão</span>
                  </motion.div>

                  <motion.div
                    animate={swapPhase === 'animating' ? { rotate: [0, 15, -15, 0], scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 0.6 }}
                    className="text-yellow-400 font-black text-lg"
                  >⇄</motion.div>

                  <motion.div
                    animate={swapPhase === 'animating' ? { x: -80, opacity: 0, scale: 0.5 } : { x: 0, opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center gap-1"
                  >
                    <GameCard card={trumpTwoPrompt.corteCard} size="sm" />
                    <span className="text-[7px] text-yellow-500 font-bold">corte</span>
                  </motion.div>
                </div>

                {swapPhase === 'prompt' && (
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={() => { setTrumpTwoPrompt(null); setSwapPhase(null); }}
                      className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl font-black text-slate-300 text-xs uppercase transition"
                    >
                      Manter
                    </button>
                    <button
                      onClick={performTwoSwap}
                      className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-xl font-black text-white text-xs uppercase transition"
                    >
                      Trocar!
                    </button>
                  </div>
                )}
                {swapPhase === 'animating' && (
                  <p className="text-yellow-400 text-[9px] font-black uppercase animate-pulse mt-2">Trocando...</p>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Resultado da Mão */}
        <AnimatePresence>
          {handResult && (
            <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-[280] p-4">
              <motion.div initial={{ scale:0.8, opacity:0, y:40 }} animate={{ scale:1, opacity:1, y:0 }} exit={{ scale:0.9, opacity:0 }}
                transition={{ type:'spring', damping:20, stiffness:250 }}
                className="bg-slate-800 border-2 border-slate-600 p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center">
                <div className="text-3xl mb-3">{handResult.isCapote ? '💥' : '🃏'}</div>
                <h3 className="text-xl font-black text-white uppercase mb-1">
                  {handResult.isCapote ? 'CAPOTE!' : 'Fim da Mão!'}
                </h3>
                {handResult.isCopas && <p className="text-red-400 text-xs font-black uppercase mb-3">♥ Mão de Copas</p>}

                {/* Pontuação das duplas */}
                <div className="flex gap-3 my-5">
                  {([1,2] as const).map(team => {
                    const pts = team === 1 ? handResult.team1Points : handResult.team2Points;
                    const isWinner = handResult.winnerTeam === team;
                    const tc = TEAM_COLORS[team];
                    return (
                      <div key={team} className={`flex-1 rounded-2xl p-4 border-2 ${isWinner ? `${tc.bg} border-opacity-60` : 'bg-slate-900 border-slate-700'}`}
                        style={isWinner ? { borderColor: team===1?'#3b82f6':'#f97316' } : {}}>
                        <p className={`text-[9px] font-black uppercase tracking-widest ${tc.text}`}>{tc.label}</p>
                        <CountUp target={pts} className={`text-3xl font-black mt-1 block ${isWinner ? 'text-white' : 'text-slate-400'}`} />
                        <p className="text-[8px] text-slate-500 mt-1">pontos em cartas</p>
                        {isWinner && <div className={`text-[9px] font-black mt-2 uppercase ${tc.text}`}>+{handResult.pointsWon} gol{handResult.pointsWon>1?'s':''} ✓</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Placar atualizado */}
                <div className="bg-slate-900 rounded-2xl p-4 mb-4 border border-slate-700">
                  <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2">Placar da Partida</p>
                  <div className="flex justify-center items-center gap-4">
                    <div className="text-center"><p className="text-[9px] text-blue-400 font-bold">Dupla 1</p><p className="text-3xl font-black text-white">{handResult.newGameScore.team1}</p></div>
                    <span className="text-slate-600 font-bold">–</span>
                    <div className="text-center"><p className="text-[9px] text-orange-400 font-bold">Dupla 2</p><p className="text-3xl font-black text-white">{handResult.newGameScore.team2}</p></div>
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">Próxima mão começa em instantes...</p>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Votação de Kick */}
        <AnimatePresence>
          {kickVote && (
            <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-[220] p-4">
              <motion.div initial={{ scale:0.85, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.85, opacity:0 }}
                className="bg-slate-800 border-2 border-red-500/50 p-7 rounded-3xl text-center shadow-2xl max-w-xs w-full">
                <div className="text-3xl mb-3">⚖️</div>
                <h4 className="text-sm font-black text-white mb-1 uppercase">Votação de Remoção</h4>
                <p className="text-slate-400 text-xs mb-1"><span className="text-slate-300 font-bold">{kickVote.initiatorNickname}</span> quer remover:</p>
                <p className="text-red-400 font-black text-base mb-4 uppercase">{kickVote.targetNickname}</p>
                <div className="flex justify-center gap-1.5 mb-4">
                  {roomData.slots.filter(Boolean).map((uid, i) => (
                    <div key={i} className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-black ${kickVote.votes.includes(uid!) ? 'border-green-500 bg-green-900/40 text-green-400' : 'border-slate-600 bg-slate-900 text-slate-600'}`}>
                      {kickVote.votes.includes(uid!) ? '✓' : '?'}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 mb-4">{kickVote.votes.length}/4 — precisa ser unânime</p>
                {kickVote.initiatorId === user?.id ? (
                  <p className="text-[10px] text-green-400 font-bold bg-green-900/20 py-2 rounded-xl border border-green-500/20">Você iniciou e votou SIM ✓</p>
                ) : kickVote.votes.includes(user?.id || '') ? (
                  <p className="text-[10px] text-green-400 font-bold bg-green-900/20 py-2 rounded-xl border border-green-500/20">Você votou SIM ✓ — aguardando os demais</p>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => castKickVote(false)} className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-black text-slate-300 text-xs uppercase transition active:scale-95">NÃO</button>
                    <button onClick={() => castKickVote(true)} className="flex-1 py-3 bg-red-700 hover:bg-red-600 rounded-xl font-black text-white text-xs uppercase transition active:scale-95">SIM, REMOVER</button>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Espectador escolhe quem sai */}
        <AnimatePresence>
          {spectatorChoose && spectatorChoose.spectatorId === user?.id && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[250] p-4">
              <motion.div initial={{ scale:0.85, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.85, opacity:0 }}
                className="bg-slate-800 border-2 border-amber-500/60 p-8 rounded-3xl text-center shadow-2xl max-w-sm w-full">
                <span className="text-3xl">🪑</span>
                <h4 className="text-lg font-black text-white mt-3 mb-1 uppercase">Sua vez de entrar!</h4>
                <p className="text-amber-400 text-xs font-bold mb-5 uppercase">Escolha quem da Dupla {spectatorChoose.losingTeam} vai sair</p>
                <div className="space-y-3">
                  {spectatorChoose.candidates.map(c => (
                    <button key={c.userId} onClick={() => handleSpectatorPick(c.userId)}
                      className="w-full flex items-center justify-between bg-red-900/20 hover:bg-red-800/40 border border-red-500/30 text-white px-5 py-3 rounded-xl font-bold transition active:scale-95">
                      <span>{c.nickname}</span>
                      <span className="text-red-400 text-xs font-black uppercase">REMOVER ✕</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Modal: Troca de lugar */}
        <AnimatePresence>
          {swapReq && (
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-[200]">
              <motion.div initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }}
                className="bg-slate-800 border-2 border-blue-500 p-8 rounded-3xl text-center shadow-2xl max-w-sm">
                <RefreshCcw size={32} className="text-blue-400 mx-auto mb-4" />
                <h4 className="text-lg font-bold text-white mb-2">Solicitação de Troca</h4>
                <p className="text-slate-400 text-sm mb-8"><strong>{swapReq.fromNickname}</strong> quer trocar de lugar com você.</p>
                <div className="flex gap-4">
                  <button onClick={() => setSwapReq(null)} className="flex-1 bg-slate-700 py-3 rounded-xl font-bold text-slate-300 hover:bg-slate-600 transition">RECUSAR</button>
                  <button onClick={acceptSwap} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold text-white hover:bg-blue-500 transition">ACEITAR</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Componente Contador Animado ──
function CountUp({ target, className }: { target: number; className?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = Math.max(1, Math.ceil(target / 30));
    const t = setInterval(() => {
      start = Math.min(start + step, target);
      setVal(start);
      if (start >= target) clearInterval(t);
    }, 40);
    return () => clearInterval(t);
  }, [target]);
  return <span className={className}>{val}</span>;
}

// ── Slot de Jogador na Mesa ──
function PlayerSlot({ relPos, isTurn, nickname, isMe, team, vazaCard, onSwap, showSwap, isOwner, handSize, isRoundStarter, isLeadingTeam, visibleHand, canKick, onKick }: any) {
  const posClasses: any = {
    0: 'bottom-[-20px] md:bottom-[-40px] left-1/2 -translate-x-1/2',
    1: 'right-[-20px] md:right-[-40px] top-1/2 -translate-y-1/2',
    2: 'top-[-20px] md:top-[-40px] left-1/2 -translate-x-1/2',
    3: 'left-[-20px] md:left-[-40px] top-1/2 -translate-y-1/2',
  };
  const handCardsPos: any = {
    0: 'hidden',
    1: 'flex-col -left-12 top-1/2 -translate-y-1/2',
    2: 'flex-row -bottom-12 left-1/2 -translate-x-1/2',
    3: 'flex-col -right-12 top-1/2 -translate-y-1/2',
  };

  const tc = team ? TEAM_COLORS[team as 1|2] : null;
  const teamRing = tc ? tc.ring : 'border-slate-600';

  return (
    <div className={`absolute pointer-events-none z-10 transition-transform duration-300 ${posClasses[relPos]} ${isTurn ? 'scale-125' : ''}`}>
      <div className="flex flex-col items-center gap-1 relative">
        {/* Cartas na mão (verso ou face visível) */}
        {handSize > 0 && relPos !== 0 && (
          <div className={`absolute flex gap-0.5 ${handCardsPos[relPos]}`}>
            {visibleHand && visibleHand.length > 0
              ? visibleHand.map((card: any) => {
                  const isRed = card.suit === 'Copas' || card.suit === 'Ouros';
                  return (
                    <motion.div key={card.id} initial={{ scale:0, opacity:0 }} animate={{ scale:1, opacity:1 }}
                      className="w-5 h-7 md:w-7 md:h-10 bg-white border border-slate-200 rounded shadow-md flex flex-col items-center justify-between p-0.5 text-[5px] md:text-[7px] font-bold">
                      <span className={isRed ? 'text-red-600' : 'text-slate-900'}>{card.value}</span>
                      <span className={isRed ? 'text-red-500' : 'text-slate-800'} style={{ fontSize:'0.5rem' }}>
                        {card.suit==='Copas'?'♥':card.suit==='Ouros'?'♦':card.suit==='Espadas'?'♠':'♣'}
                      </span>
                    </motion.div>
                  );
                })
              : Array.from({ length: handSize }).map((_, i) => (
                <motion.div key={i} initial={{ scale:0, opacity:0 }} animate={{ scale:1, opacity:1 }}
                  className="w-4 h-6 md:w-6 md:h-9 rounded border border-white/30 shadow-md"
                  style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 2px,#2563eb 2px,#2563eb 4px)' }}
                />
              ))
            }
          </div>
        )}

        {/* Glow do time liderando */}
        {isLeadingTeam && (
          <div className="absolute inset-0 -m-3 rounded-full pointer-events-none" style={{
            background: 'radial-gradient(circle, rgba(34,197,94,0.22) 0%, transparent 75%)',
            filter: 'blur(6px)'
          }} />
        )}

        {/* Coroa do dono */}
        {isOwner && <div className="absolute -top-5 text-yellow-500"><Crown size={12} fill="currentColor" /></div>}

        {/* Avatar */}
        <div className={`relative w-8 h-8 md:w-11 md:h-11 rounded-full bg-slate-800 border-2 md:border-[3px] flex items-center justify-center text-[8px] md:text-[10px] font-bold shadow-lg transition-all duration-300 ${isTurn ? 'border-yellow-400 shadow-[0_0_14px_rgba(250,204,21,0.7)] scale-110' : teamRing}`}>
          {nickname[0]?.toUpperCase()}
          {isRoundStarter && <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full border border-slate-600 shadow" />}
        </div>

        {/* Nome + badge de dupla */}
        <div className={`flex flex-col items-center px-2 py-0.5 rounded-full border shadow-lg backdrop-blur ${isTurn ? 'bg-yellow-900/30 border-yellow-400/60' : 'bg-slate-900/90 border-slate-700'}`}>
          <span className={`font-bold text-[7px] md:text-[8px] truncate max-w-[60px] uppercase ${isTurn ? 'text-yellow-200' : 'text-white'}`}>{nickname}</span>
          {tc && <span className={`text-[5px] font-black uppercase tracking-widest ${tc.text}`}>{tc.label}</span>}
        </div>

        {/* Botão de kick (X abaixo do nome) */}
        {canKick && (
          <button onClick={(e) => { e.stopPropagation(); onKick?.(); }}
            className="mt-0.5 pointer-events-auto w-4 h-4 md:w-5 md:h-5 rounded-full bg-red-900/40 hover:bg-red-600 border border-red-500/40 hover:border-red-400 flex items-center justify-center transition text-red-400 hover:text-white"
            title="Votar para remover">
            <X size={8} />
          </button>
        )}

        {/* Botão de troca (sala de espera) */}
        {showSwap && (
          <button onClick={(e) => { e.stopPropagation(); onSwap(); }}
            className="mt-1 bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[6px] font-black px-1.5 py-0.5 rounded-lg pointer-events-auto transition border border-blue-500/30 whitespace-nowrap">
            TROCAR
          </button>
        )}
      </div>
    </div>
  );
}

// ── Carta ──
function GameCard({ card, size = 'lg', isCorte = false, faceDown = false }: { card: Card, size?: 'sm'|'md'|'lg'|'hand', isCorte?: boolean, faceDown?: boolean }) {
  const isRed = card.suit === 'Copas' || card.suit === 'Ouros';
  const sizeClasses = {
    sm:   'w-8 h-12 md:w-10 md:h-14 text-[7px] md:text-[9px] p-1 md:p-1.5 rounded-lg border-2',
    md:   'w-12 h-16 md:w-14 md:h-20 text-[10px] md:text-xs p-1.5 md:p-2 rounded-xl border-2',
    lg:   'w-14 h-20 md:w-16 md:h-24 text-xs md:text-sm p-2 md:p-3 rounded-2xl border-[3px]',
    hand: 'w-12 h-18 md:w-16 md:h-24 text-[10px] md:text-sm p-2 md:p-3 rounded-2xl border-[3px]',
  };
  return (
    <motion.div initial={faceDown ? { rotateY:180 } : { rotateY:0 }} animate={{ rotateY: faceDown ? 180 : 0 }}
      transition={{ duration:0.6, type:'spring', stiffness:260, damping:20 }}
      style={{ transformStyle:'preserve-3d' }}
      className={`${sizeClasses[size]} shadow-2xl relative flex flex-col justify-between flex-shrink-0 border-slate-700`}>
      <div className={`absolute inset-0 bg-white border-slate-300 rounded-[inherit] flex flex-col justify-between p-[inherit] ${faceDown ? 'hidden' : 'flex'}`}>
        <div className={`leading-none font-bold ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.value}</div>
        <div className="flex-1 flex items-center justify-center">
          <SuitIcon suit={card.suit} className={`w-3/4 h-3/4 ${isRed ? 'text-red-500' : 'text-slate-900'}`} />
        </div>
        <div className={`leading-none font-bold self-end rotate-180 ${isRed ? 'text-red-600' : 'text-slate-900'}`}>{card.value}</div>
      </div>
      <div className={`absolute inset-0 bg-blue-900 rounded-[inherit] ${!faceDown ? 'hidden' : 'block'}`}
        style={{ background:'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 5px,#2563eb 5px,#2563eb 10px)', transform:'rotateY(180deg)' }} />
    </motion.div>
  );
}

function SuitIcon({ suit, className }: { suit: string, className?: string }) {
  const style = { fontSize:'1.2em', display:'inline-flex', alignItems:'center', justifyContent:'center' };
  switch (suit) {
    case 'Copas':   return <span className={className} style={style}>♥</span>;
    case 'Ouros':   return <span className={className} style={style}>♦</span>;
    case 'Espadas': return <span className={className} style={style}>♠</span>;
    case 'Paus':    return <span className={className} style={style}>♣</span>;
    default: return null;
  }
}
