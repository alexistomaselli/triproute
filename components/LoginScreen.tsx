import React from 'react';
import { useAuth } from '../AuthContext';

export const LoginScreen: React.FC = () => {
    const { signInWithGoogle } = useAuth();

    return (
        <div className="relative min-h-screen flex items-center justify-center bg-slate-900 overflow-hidden">
            {/* Dynamic Background Elements */}
            <div className="absolute inset-0 overflow-hidden">
                <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-indigo-600/20 blur-[120px] animate-pulse"></div>
                <div className="absolute top-[40%] -right-[20%] w-[60%] h-[60%] rounded-full bg-violet-600/20 blur-[100px] animate-pulse" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="relative z-10 w-full max-w-md px-6">
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-10 rounded-[3rem] shadow-2xl flex flex-col items-center text-center">

                    <div className="mb-8 p-5 bg-indigo-600 rounded-[2rem] shadow-lg shadow-indigo-500/30 transform rotate-3 hover:rotate-6 transition-all duration-300">
                        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                    </div>

                    <h1 className="text-4xl font-black text-white mb-3 tracking-tight">VoiA <span className="text-indigo-400 italic">Travel</span></h1>
                    <p className="text-slate-300 text-lg font-medium mb-10 leading-relaxed">
                        Diseña tu próxima aventura con inteligencia artificial y precisión geográfica.
                    </p>

                    <button
                        onClick={signInWithGoogle}
                        className="w-full py-4 px-6 bg-white text-slate-900 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-indigo-50 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 shadow-xl"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Continuar con Google
                    </button>

                    <p className="mt-8 text-slate-400 text-xs font-medium">
                        Al continuar, aceptas crear tu cuenta personal.
                    </p>
                </div>
            </div>
        </div>
    );
};
