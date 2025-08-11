"use client";

import "./globals.css";
import React, { useEffect, useMemo, useState } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, getMint } from "@solana/spl-token";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4EMXw3v5Y4tZrx"); // Solana USDC

type GameView = {
  player: string[];
  dealer: string[];
  status: "playing" | "player_blackjack" | "dealer_blackjack" | "player_bust" | "dealer_bust" | "push" | "player_win" | "dealer_win";
  bet: number;
  canDouble: boolean;
  canSplit: boolean;
  revealDealer?: boolean;
};

export default function Page() {
  const [pubkey, setPubkey] = useState<PublicKey | null>(null);
  const [conn] = useState(() => new Connection(RPC_URL, "confirmed"));
  const [currency, setCurrency] = useState<"SOL" | "USDC">("SOL");
  const [balSOL, setBalSOL] = useState<number | null>(null);
  const [balUSDC, setBalUSDC] = useState<number | null>(null);
  const [bet, setBet] = useState<string>("0.01");
  const [loading, setLoading] = useState(false);

  // blackjack state
  const [stateToken, setStateToken] = useState<string | null>(null);
  const [view, setView] = useState<GameView | null>(null);

  // Phantom connect
  const connect = async () => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) {
      alert("Install Phantom Wallet to continue.");
      return;
    }
    const resp = await provider.connect();
    setPubkey(new PublicKey(resp.publicKey.toString()));
  };
  const disconnect = async () => {
    try { await (window as any).solana?.disconnect(); } catch {}
    setPubkey(null);
    setView(null);
    setStateToken(null);
  };

  // Fetch balances
  useEffect(() => {
    if (!pubkey) return;
    (async () => {
      setBalSOL(null);
      setBalUSDC(null);
      // SOL
      const lamports = await conn.getBalance(pubkey);
      setBalSOL(lamports / LAMPORTS_PER_SOL);
      // USDC
      try {
        const ata = await getAssociatedTokenAddress(USDC_MINT, pubkey, false);
        const acc = await conn.getAccountInfo(ata);
        if (acc) {
          const info = await getAccount(conn, ata);
          const mintInfo = await getMint(conn, USDC_MINT);
          const dec = Number(mintInfo.decimals);
          setBalUSDC(Number(info.amount) / 10 ** dec);
        } else {
          setBalUSDC(0);
        }
      } catch (e) {
        setBalUSDC(0);
      }
    })();
  }, [pubkey, conn]);

  const startGame = async () => {
    if (!pubkey) return alert("Connect wallet first.");
    setLoading(true);
    try {
      const res = await fetch("/api/python/blackjack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", publicKey: pubkey.toBase58(), currency, bet: Number(bet) }),
      });
      const data = await res.json();
      setStateToken(data.stateToken);
      setView(data.view);
    } finally {
      setLoading(false);
    }
  };

  const sendAction = async (action: "hit" | "stand" | "double") => {
    if (!stateToken) return;
    setLoading(true);
    try {
      const res = await fetch("/api/python/blackjack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, stateToken }),
      });
      const data = await res.json();
      setStateToken(data.stateToken);
      setView(data.view);
    } finally {
      setLoading(false);
    }
  };

  const canPlay = useMemo(() => !!pubkey, [pubkey]);

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="h1">🃏 Blackjack (MVP)</div>
          <div className="row">
            {!pubkey ? (
              <button className="btn" onClick={connect}>Connect Phantom</button>
            ) : (
              <>
                <span className="badge">{pubkey.toBase58().slice(0,4)}…{pubkey.toBase58().slice(-4)}</span>
                <button className="btn" onClick={disconnect}>Disconnect</button>
              </>
            )}
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="h2">Balances</div>
            <div className="row">
              <div className="badge">SOL: {balSOL == null ? "…" : balSOL.toFixed(4)}</div>
              <div className="badge">USDC: {balUSDC == null ? "…" : balUSDC.toFixed(2)}</div>
            </div>
          </div>
          <div className="card">
            <div className="h2">Bet</div>
            <div className="row">
              <select className="btn" value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
              </select>
              <input className="input" value={bet} onChange={(e)=>setBet(e.target.value)} />
              <button className="btn" disabled={!canPlay || loading} onClick={startGame}>Deal</button>
            </div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="h2">Player</div>
            <div className="table">
              {view?.player?.map((c, i) => <div key={i} className="cardFace">{c}</div>)}
            </div>
          </div>
          <div className="card">
            <div className="h2">Dealer</div>
            <div className="table">
              {view?.dealer?.map((c, i) => <div key={i} className="cardFace">{c}</div>)}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={!view || loading || view.status!=="playing"} onClick={()=>sendAction("hit")}>Hit</button>
          <button className="btn" disabled={!view || loading || view.status!=="playing"} onClick={()=>sendAction("stand")}>Stand</button>
          <button className="btn" disabled={!view || loading || !view?.canDouble} onClick={()=>sendAction("double")}>Double</button>
          {view && <span className="badge">Status: {view.status}</span>}
          {view && <span className="badge">Bet: {view.bet} {currency}</span>}
        </div>
      </div>
    </div>
  );
}
