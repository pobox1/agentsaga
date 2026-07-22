"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { arcTestnet } from "@agentsaga/contracts";
import {
  automaticRecoveryDue,
  dismissTransaction,
  loadPendingTransactions,
  loadTransactionHistory,
  maximumAutomaticRecoveryAttempts,
  recoverPendingTransaction,
  retryTransactionRecovery,
  transactionUpdateEvent,
  type TransactionRecord,
} from "../lib/transactions";

export function TransactionCenter() {
  const client = usePublicClient({ chainId: arcTestnet.id });
  const [records, setRecords] = useState<TransactionRecord[]>(() => loadTransactionHistory());
  const [open, setOpen] = useState(false);
  const refresh = useCallback(() => setRecords(loadTransactionHistory()), []);

  useEffect(() => {
    window.addEventListener(transactionUpdateEvent, refresh);
    return () => window.removeEventListener(transactionUpdateEvent, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const recover = async () => {
      for (const pending of loadPendingTransactions().filter((record) => automaticRecoveryDue(record))) {
        await recoverPendingTransaction(client, pending);
        if (cancelled) return;
      }
      refresh();
    };
    void recover();
    const timer = window.setInterval(() => void recover(), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [client, refresh]);

  if (records.length === 0) return null;
  return <aside className={`transaction-center ${open ? "open" : ""}`} aria-label="Transaction center">
    <button type="button" className="transaction-toggle" onClick={() => setOpen((value) => !value)}>
      Transactions <span>{records.filter((record) => record.status === "Submitted" || record.status === "Confirming" || record.status === "RecoveryPaused").length}</span>
    </button>
    {open && <div className="transaction-list">{records.slice(0, 12).map((record) => <article key={record.hash}>
      <div><strong>{record.action}</strong><span className={`state state-${record.status.toLowerCase().replaceAll(" ", "-")}`}>{record.status}</span></div>
      <small>{new Date(record.createdAt).toLocaleString()} · Arc Testnet</small>
      <code>{record.hash}</code>
      <small>From {record.from.slice(0, 10)}… · nonce {record.nonce ?? "pending lookup"} · recovery {record.recoveryAttempts}/{maximumAutomaticRecoveryAttempts}</small>
      {record.status === "ConfirmedVerificationIncomplete" && <small className="error-text">Confirmed onchain; event verification is incomplete.</small>}
      {record.decodedEvent && <small>Decoded: {record.decodedEvent}</small>}
      {record.expectedEmitter && <small>Expected emitter: {record.expectedEmitter}</small>}
      {record.error && <small className="error-text">{record.error}</small>}
      {record.status === "RecoveryPaused" && <div className="action-row"><button type="button" onClick={() => client && void retryTransactionRecovery(client, record.hash)}>Retry</button><button type="button" onClick={() => dismissTransaction(record.hash)}>Dismiss</button></div>}
      <a href={`${arcTestnet.blockExplorers.default.url}/tx/${record.hash}`} target="_blank" rel="noreferrer">ArcScan ↗</a>
    </article>)}</div>}
  </aside>;
}
