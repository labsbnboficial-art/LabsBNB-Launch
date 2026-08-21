import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ACTIVE_NETWORK } from "@/lib/web3/networks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Permanent legal disclaimer available from the header on every page. */
export function RiskDisclaimer({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg text-xs uppercase tracking-wider text-warning/90 hover:text-warning hover:bg-white/5 transition"
          aria-label="Risk disclaimer"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {!compact && <span>Disclaimer</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="glass-strong max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Aviso de riesgo · Risk Disclaimer
          </DialogTitle>
          <DialogDescription className="sr-only">Aviso legal de LabsBNB Launchpad</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground max-h-[60vh] overflow-y-auto pr-1">
          <p>
            LabsBNB Launchpad es una plataforma descentralizada y sin custodia. Todos los tokens
            son creados por usuarios anónimos: LabsBNB <strong className="text-foreground">no
            audita, respalda ni recomienda</strong> ningún token listado.
          </p>
          <p>
            Operar con tokens de curva de bonding implica un riesgo elevado, incluida la
            <strong className="text-foreground"> pérdida total del capital</strong>. Los precios son
            extremadamente volátiles y pueden llegar a cero en segundos.
          </p>
          <p>
            Todas las transacciones se ejecutan on-chain en BNB Smart Chain y son
            <strong className="text-foreground"> irreversibles</strong>. Verifica siempre la
            dirección del contrato antes de comprar.
          </p>
          <p>
            Nada en esta plataforma constituye asesoramiento financiero, legal o fiscal. Eres el
            único responsable de tus decisiones y del cumplimiento de la normativa de tu
            jurisdicción.
          </p>
          <p className="text-xs">
            Red activa: {ACTIVE_NETWORK.name} (Chain ID {ACTIVE_NETWORK.chainId}).
            {ACTIVE_NETWORK.isTestnet
              ? " Fase de pruebas: los activos de testnet no tienen valor económico."
              : ""}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
