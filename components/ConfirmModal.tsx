import React from 'react';

interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "Aceptar",
    cancelText = "Cancelar"
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in zoom-in-95 duration-200 border border-white/50">
                <div className="p-6 bg-rose-500 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
                    </div>
                    <h3 className="font-black text-xl relative z-10">{title}</h3>
                    <p className="text-rose-100 text-xs mt-1 relative z-10 font-medium">{description}</p>
                </div>

                <div className="p-8">
                    <p className="text-slate-600 font-medium mb-8 text-sm leading-relaxed">
                        Esta acción no se puede deshacer. Asegúrate de haber guardado tus cambios si quieres conservarlos.
                    </p>

                    <div className="flex gap-3 justify-end items-center">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 text-slate-500 hover:bg-slate-50 rounded-xl font-bold text-sm transition-colors"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={() => { onConfirm(); onClose(); }}
                            className="px-8 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-rose-200 transition-all active:scale-95 flex items-center gap-2"
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
