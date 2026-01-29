import React, { useState, useEffect } from 'react';

interface SaveTripModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (name: string) => void;
    initialName: string;
    title?: string;
    description?: string;
}

export const SaveTripModal: React.FC<SaveTripModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialName,
    title = "Guardar Viaje",
    description = "Asigna un nombre para recordar esta aventura."
}) => {
    const [name, setName] = useState(initialName);

    useEffect(() => {
        if (isOpen) setName(initialName);
    }, [isOpen, initialName]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) onSave(name);
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in zoom-in-95 duration-200 border border-white/50">
                <div className="p-6 bg-indigo-600 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
                    </div>
                    <h3 className="font-black text-xl relative z-10">{title}</h3>
                    <p className="text-indigo-100 text-xs mt-1 relative z-10 font-medium">{description}</p>
                </div>

                <form onSubmit={handleSubmit} className="p-8">
                    <div className="mb-8">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Nombre del Viaje</label>
                        <div className="relative">
                            <input
                                autoFocus
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-4 py-4 text-slate-800 font-bold focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300 text-lg"
                                placeholder="Ej: Escapada a la Montaña"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none">
                                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end items-center">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 text-slate-500 hover:bg-slate-50 rounded-xl font-bold text-sm transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                            Guardar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
