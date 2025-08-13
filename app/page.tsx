"use client";

import "./globals.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, getMint } from "@solana/spl-token";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4EMXw3v5Y4tZrx"); // USDC on Solana

type GameView = {
  player: string[];
  dealer: string[];
  status:
    | "playing"
    | "player_blackjack"
    | "dealer_blackjack"
    | "player_bust"
    | "dealer_bust"
    | "push"
    | "player_win"
    | "dealer_win";
  bet: number;
  canDouble: boolean;
  canSplit: boolean;
  revealDealer?: boolean;
};

type Owner = "player" | "dealer";
type CardObj = {
  id: string;
  text: string;      // e.g. "A♠"
  owner: Owner;
  index: number;     // position in that hand
  faceDown?: boolean;
  inPlace?: boolean; // toggles after mount to trigger transition
};

export default function Page() {
  // Wallet
  const [pubkey, setPubkey] = useState<PublicKey | null>(null);
  const [conn] = useState(() => new Connection(RPC_URL, "confirmed"));
  const [currency, setCurrency] = useState<"SOL" | "USDC" | "FUN">("SOL");
  const [balSOL, setBalSOL] = useState<number | null>(null);
  const [balUSDC, setBalUSDC] = useState<number | null>(null);
  const [bet, setBet] = useState<string>("0.01");
  const [funMode, setFunMode] = useState(false);

  // Game
  const [loading, setLoading] = useState(false);
  const [stateToken, setStateToken] = useState<string | null>(null);
  const [view, setView] = useState<GameView | null>(null);

  // Animation state
  const [cards, setCards] = useState<CardObj[]>([]);
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Phantom connect
  const connect = async () => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) return alert("Install Phantom Wallet to continue.");
    const resp = await provider.connect();
    setPubkey(new PublicKey(resp.publicKey.toString()));
  };
  const disconnect = async () => {
    try { await (window as any).solana?.disconnect(); } catch {}
    setPubkey(null);
    setView(null);
    setStateToken(null);
    setCards([]);
    setFunMode(false);
  };

  // Balances
  useEffect(() => {
    if (!pubkey) return;
    (async () => {
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
        } else setBalUSDC(0);
      } catch { setBalUSDC(0); }
    })();
  }, [pubkey, conn]);

  // Helpers to compute card target positions
  // Everything is absolutely positioned within .tableWrap
  const computeTarget = (owner: Owner, index: number) => {
    // Tune these numbers to tweak layout
    const baseTop = owner === "player" ? 300 : 90;   // px from top of table
    const startLeft = 140;                           // first card left
    const gap = 66;                                  // gap between cards
    return { top: baseTop, left: startLeft + index * gap };
  };

  // Deal animation: push card with deck position, then on next frame toggle inPlace so it slides to target
  const pushAnimatedCard = (text: string, owner: Owner, index: number, faceDown = false) => {
    const id = `${owner}-${index}-${text}-${Math.random().toString(36).slice(2,8)}`;
    setCards((prev) => [...prev, { id, text, owner, index, faceDown, inPlace: false }]);
    requestAnimationFrame(() => {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, inPlace: true } : c)));
    });
  };

  // Build animation from a new view (initial deal)
  const animateInitialDeal = async (newView: GameView) => {
    setCards([]);
    // sequence: P1, D1, P2, D2
    const seq: {owner: Owner; text: string; faceDown?: boolean}[] = [];
    if (newView.player[0]) seq.push({ owner: "player", text: newView.player[0] });
    if (newView.dealer[0]) seq.push({ owner: "dealer", text: newView.dealer[0] });
    if (newView.player[1]) seq.push({ owner: "player", text: newView.player[1] });
    if (newView.dealer[1]) {
      const faceDown = !newView.revealDealer && newView.status === "playing";
      seq.push({ owner: "dealer", text: newView.dealer[1], faceDown });
    }

    for (let i = 0; i < seq.length; i++) {
      const s = seq[i];
      pushAnimatedCard(
        s.text,
        s.owner,
        s.owner === "player" ? (i > 1 ? 1 : 0) : (i > 2 ? 1 : 0),
        !!s.faceDown
      );
      await new Promise((r) => setTimeout(r, 200)); // stagger
    }
  };

  // Add a single card to owner (hit animations)
  const animateHit = async (owner: Owner, newCardText: string, index: number) => {
    pushAnimatedCard(newCardText, owner, index, false);
  };

  // Flip dealer hole when revealDealer toggles
  useEffect(() => {
    if (!view) return;
    if (view.revealDealer) {
      setCards((prev) =>
        prev.map((c) => (c.owner === "dealer" && c.index === 1 ? { ...c, faceDown: false } : c))
      );
    }
  }, [view?.revealDealer]); // eslint-disable-line

  // API wiring
  const startGame = async (mode: "wallet" | "fun" = "wallet") => {
    if (mode === "wallet" && !pubkey) return alert("Connect wallet first.");
    setLoading(true);
    try {
      const useFun = mode === "fun";
      if (useFun) {
        setFunMode(true);
        setCurrency("FUN");
      }

      const res = await fetch("/api/python/blackjack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          publicKey: useFun ? "FUN_PLAYER" : pubkey!.toBase58(),
          currency: useFun ? "FUN" : currency,
          bet: Number(bet),
        }),
      });
      const data = await res.json();
      setStateToken(data.stateToken);
      setView(data.view);
      await animateInitialDeal(data.view);
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
      const prev = view;
      setStateToken(data.stateToken);
      setView(data.view);

      // Infer what changed to animate new card(s)
      if (prev) {
        if (data.view.player.length > prev.player.length) {
          const text = data.view.player[data.view.player.length - 1];
          await animateHit("player", text, data.view.player.length - 1);
        }
        if (data.view.dealer.length > prev.dealer.length) {
          const text = data.view.dealer[data.view.dealer.length - 1];
          await animateHit("dealer", text, data.view.dealer.length - 1);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Simple computed labels
  const statusText = useMemo(() => {
    if (!view) return "—";
    const map: Record<string, string> = {
      playing: "Playing",
      player_blackjack: "Player Blackjack!",
      dealer_blackjack: "Dealer Blackjack",
      player_bust: "Player Bust",
      dealer_bust: "Dealer Bust",
      push: "Push",
      player_win: "Player Wins",
      dealer_win: "Dealer Wins",
    };
    return map[view.status] ?? view.status;
  }, [view]);

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="h1">🃏 Blackjack</div>
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
            {funMode ? (
              <div className="badge">Fun Mode (no wallet required)</div>
            ) : (
              <div className="row">
                <div className="badge">SOL: {balSOL == null ? "…" : balSOL.toFixed(4)}</div>
                <div className="badge">USDC: {balUSDC == null ? "…" : balUSDC.toFixed(2)}</div>
              </div>
            )}
          </div>
          <div className="card">
            <div className="h2">Bet</div>
            <div className="row">
              <select
                className="btn"
                value={funMode ? "FUN" : currency}
                onChange={(e) => setCurrency(e.target.value as any)}
                disabled={funMode}
              >
                {funMode && <option value="FUN">FUN</option>}
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
              </select>

              <input className="input" value={bet} onChange={(e)=>setBet(e.target.value)} />

              {/* Wallet play */}
              <button
                className="btn"
                disabled={!pubkey || loading}
                onClick={() => { setFunMode(false); startGame("wallet"); }}
              >
                Deal
              </button>

              {/* Fun play */}
              <button
                className="btn"
                disabled={loading}
                onClick={() => startGame("fun")}
              >
                Fun Play
              </button>
            </div>
          </div>
        </div>

        <div className="tableWrap" ref={tableRef}>
          <div className="felt"/>
          {/* Deck stack */}
          <div className="deck">
            <div className="deckCard" />
            <div className="deckCard" />
            <div className="deckCard" />
          </div>

          {/* Animated cards */}
          {cards.map((c) => {
            const target = computeTarget(c.owner, c.index);
            const style: React.CSSProperties = {
              top: c.inPlace ? target.top : 200,
              left: c.inPlace ? target.left : 420,
            };
            return (
              <Card key={c.id} text={c.text} faceDown={c.faceDown} style={style}/>
            );
          })}

          {/* Labels */}
          <div className="seatLabel seatPlayer">PLAYER</div>
          <div className="seatLabel seatDealer">DEALER</div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={!view || loading || view.status!=="playing"} onClick={()=>sendAction("hit")}>Hit</button>
          <button className="btn" disabled={!view || loading || view.status!=="playing"} onClick={()=>sendAction("stand")}>Stand</button>
          <button className="btn" disabled={!view || loading || !view?.canDouble} onClick={()=>sendAction("double")}>Double</button>
          {view && <span className="badge">Status: {statusText}</span>}
          {view && <span className="badge">Bet: {view.bet} {funMode ? "FUN" : currency}</span>}
        </div>
      </div>
    </div>
  );
}

// ---- Card component with face-down flip ----
function Card({ text, faceDown, style }: { text: string; faceDown?: boolean; style?: React.CSSProperties }) {
  return (
    <div className={`card3D ${faceDown ? "isDown" : ""}`} style={style}>
      <div className="cardInner">
        <div className="cardFace cardFront">{text}</div>
        <div className="cardFace cardBack">🂠</div>
      </div>
    </div>
  );
}
