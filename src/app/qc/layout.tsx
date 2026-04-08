/**
 * Layout do Dashboard de QC (Tarefa 4).
 * Nav simples: Pendentes · Larry Loop.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "MrTok · QC Dashboard",
};

export default function QCLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-6">
        <h1 className="text-lg font-semibold tracking-tight">
          MrTok · QC Dashboard
        </h1>
        <nav className="flex gap-4 text-sm text-zinc-400">
          <Link href="/qc" className="hover:text-zinc-100">
            Pendentes
          </Link>
          <Link href="/qc/larry-loop" className="hover:text-zinc-100">
            Larry Loop
          </Link>
        </nav>
      </header>
      <main className="px-6 py-8 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
