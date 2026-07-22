"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";

export function ReceiptLookup() {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string>();
  const router = useRouter();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isAddress(address)) { setError("Enter a valid workflow coordinator address"); return; }
    setError(undefined);
    router.push(`/receipts/${address}`);
  };
  return <form className="lookup-form" onSubmit={submit}><label>Workflow coordinator address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x…" /></label><button className="button button-primary" type="submit">Read receipt</button>{error !== undefined && <p role="alert">{error}</p>}</form>;
}

