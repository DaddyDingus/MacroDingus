import type { ReactNode } from "react";

interface ModalMacroHeaderProps {
  left: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  status: ReactNode;
  children?: ReactNode;
  className?: string;
  statusClassName?: string;
}

// Plate Preview and Food Detail are two states of the same full-screen
// logging modal, so their top chrome must share one geometry contract. The
// Android shell already places the WebView below the system status bar; the
// browser/PWA does not, and therefore keeps its normal safe-area flow.
export default function ModalMacroHeader({
  left,
  center,
  right,
  status,
  children,
  className = "",
  statusClassName = "",
}: ModalMacroHeaderProps) {
  const isAndroidShell = window.MacroTrackAndroid?.isNativeApp?.() === true;

  return (
    <div className={`modal-macro-header${isAndroidShell ? " modal-macro-header--android" : ""} ${className}`}>
      <div className="modal-macro-header__controls">
        <div className="justify-self-start min-w-0">{left}</div>
        <div className="justify-self-center min-w-0">{center}</div>
        <div className="justify-self-end min-w-0">{right}</div>
      </div>
      <div className={`modal-macro-header__status ${statusClassName}`}>{status}</div>
      {children}
    </div>
  );
}
