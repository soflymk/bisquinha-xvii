/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrictMode, useEffect, useState, createContext, useContext } from 'react';
import { io, Socket } from 'socket.io-client';
import { User, GameState } from './lib/types';
import Login from './components/Login';
import Lobby from './components/Lobby';
import GameRoom from './components/GameRoom';
import Admin from './components/Admin';
import Profile from './components/Profile';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, User as UserIcon, Shield, LayoutGrid, Menu, X } from 'lucide-react';

interface AppContextType {
  user: User | null;
  setUser: (u: User | null) => void;
  socket: Socket | null;
  view: 'LOGIN' | 'LOBBY' | 'GAME' | 'ADMIN' | 'PROFILE';
  setView: (v: 'LOGIN' | 'LOBBY' | 'GAME' | 'ADMIN' | 'PROFILE') => void;
  currentRoomId: string | null;
  setCurrentRoomId: (id: string | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [view, setView] = useState<'LOGIN' | 'LOBBY' | 'GAME' | 'ADMIN' | 'PROFILE'>('LOGIN');
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Close mobile menu on view change
    setMobileMenuOpen(false);
  }, [view]);

  useEffect(() => {
    // Check session
    fetch('/api/me')
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => {
        if (data.id) {
          setUser(data);
          setView('LOBBY');
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user && !socket) {
      const s = io();
      setSocket(s);
      return () => { s.disconnect(); };
    }
  }, [user]);

  const logout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
      console.error('Logout request failed:', e);
    }
    setUser(null);
    if (socket) socket.disconnect();
    setSocket(null);
    setView('LOGIN');
  };

  if (loading) return <div className="h-screen w-screen bg-[#1a1a1a] flex items-center justify-center text-white">Carregando...</div>;

  return (
    <AppContext.Provider value={{ user, setUser, socket, view, setView, currentRoomId, setCurrentRoomId }}>
      <div className="h-screen flex flex-col bg-[#1a1a1a] text-gray-100 font-sans selection:bg-orange-500 selection:text-white overflow-hidden">
        
        {user && view !== 'GAME' && (
          <nav className="bg-[#121212] border-b border-gray-800 px-4 md:px-6 py-3 flex justify-between items-center sticky top-0 z-[100]">
            <div className="flex items-center gap-4 md:gap-6">
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-400 hover:text-white"
              >
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
              
              <h1 className="text-lg md:text-xl font-bold tracking-tighter text-orange-500 flex items-center gap-2">
                 BISCA <span className="text-white hidden sm:inline">CAPIXABA</span>
              </h1>
              
              <div className="hidden md:flex gap-4">
                <button onClick={() => setView('LOBBY')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${view === 'LOBBY' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'}`}>
                  <LayoutGrid size={18} /> Lobby
                </button>
                {user.role === 'ADMIN' && (
                   <button onClick={() => setView('ADMIN')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition ${view === 'ADMIN' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'}`}>
                    <Shield size={18} /> Admin
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-4">
               <button onClick={() => setView('PROFILE')} className="flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-800/50 transition">
                <UserIcon size={18} /> <span className="hidden sm:inline">{user.nickname}</span>
              </button>
              <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 transition tooltip" title="Sair">
                <LogOut size={18} />
              </button>
            </div>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
              {mobileMenuOpen && (
                <>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setMobileMenuOpen(false)}
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[-1] md:hidden"
                  />
                  <motion.div 
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    className="fixed top-[61px] left-0 bottom-0 w-64 bg-[#121212] border-r border-gray-800 p-6 z-[-1] md:hidden shadow-2xl"
                  >
                    <div className="flex flex-col gap-4">
                      <button 
                        onClick={() => setView('LOBBY')} 
                        className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition ${view === 'LOBBY' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                      >
                        <LayoutGrid size={20} /> Lobby
                      </button>
                      {user.role === 'ADMIN' && (
                        <button 
                          onClick={() => setView('ADMIN')} 
                          className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition ${view === 'ADMIN' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                        >
                          <Shield size={20} /> Admin
                        </button>
                      )}
                      <div className="h-px bg-gray-800 my-2" />
                      <button 
                        onClick={() => setView('PROFILE')} 
                        className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition ${view === 'PROFILE' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                      >
                        <UserIcon size={20} /> Perfil
                      </button>
                      <button 
                        onClick={logout} 
                        className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition"
                      >
                        <LogOut size={20} /> Sair
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </nav>
        )}

        <main className={`flex-1 overflow-hidden ${view === 'GAME' ? 'p-0' : 'container mx-auto p-4 md:p-8'}`}>
          <AnimatePresence mode="wait">
             {view === 'LOGIN' && <Login key="login" />}
             {view === 'LOBBY' && <Lobby key="lobby" />}
             {view === 'GAME' && <GameRoom key="game" />}
             {view === 'ADMIN' && <Admin key="admin" />}
             {view === 'PROFILE' && <Profile key="profile" />}
          </AnimatePresence>
        </main>
      </div>
    </AppContext.Provider>
  );
}
