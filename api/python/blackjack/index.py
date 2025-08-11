\
from flask import Flask, request, jsonify
import os, json, hmac, hashlib, time, random

app = Flask(__name__)

SECRET = os.environ.get("BJ_SECRET", "dev_secret_change_me")

RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]
SUITS = ["♠","♥","♦","♣"]

def new_deck():
    deck = [f"{r}{s}" for s in SUITS for r in RANKS] * 4  # 4 decks shoe
    random.shuffle(deck)
    return deck

def hand_value(cards):
    total = 0
    aces = 0
    for c in cards:
        r = c[:-1] if c[:-1] != "" else c[0]
        if r in ["J","Q","K"]:
            total += 10
        elif r == "A":
            aces += 1
            total += 11
        else:
            total += int(r)
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1
    return total

def sign_state(state: dict) -> str:
    payload = json.dumps(state, separators=(",", ":"), sort_keys=True)
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return json.dumps({"p": payload, "s": sig})

def verify_state(token: str) -> dict:
    obj = json.loads(token)
    payload = obj["p"]
    sig = obj["s"]
    exp_sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, exp_sig):
        raise ValueError("Invalid state signature")
    return json.loads(payload)

def initial_deal(deck):
    player = [deck.pop(), deck.pop()]
    dealer = [deck.pop(), deck.pop()]
    return player, dealer, deck

def visible_dealer(dealer, reveal=False):
    return dealer if reveal else [dealer[0], "🂠"]

def is_blackjack(hand):
    return len(hand) == 2 and hand_value(hand) == 21

@app.route("/", methods=["POST"])
def main():
    data = request.get_json(force=True, silent=True) or {}
    action = data.get("action")

    if action == "start":
        public_key = data.get("publicKey")
        currency = data.get("currency", "SOL")
        bet = float(data.get("bet", 0.01))
        # Create a new shoe
        deck = new_deck()
        player, dealer, deck = initial_deal(deck)

        status = "playing"
        if is_blackjack(player) and is_blackjack(dealer):
            status = "push"
        elif is_blackjack(player):
            status = "player_blackjack"
        elif is_blackjack(dealer):
            status = "dealer_blackjack"

        state = {
            "t": int(time.time()),
            "deck": deck,
            "player": player,
            "dealer": dealer,
            "bet": bet,
            "currency": currency,
            "publicKey": public_key,
            "status": status,
            "doubled": False,
            "revealDealer": False
        }

        view = {
            "player": player,
            "dealer": visible_dealer(dealer, reveal=False if status=="playing" else True),
            "status": "playing" if status=="playing" else status,
            "bet": bet,
            "canDouble": status=="playing",
            "canSplit": False,
            "revealDealer": status!="playing"
        }
        return jsonify({"stateToken": sign_state(state), "view": view})

    elif action in ["hit","stand","double"]:
        token = data.get("stateToken")
        if not token:
            return jsonify({"error": "Missing stateToken"}), 400
        state = verify_state(token)
        if state["status"] != "playing":
            # return same state
            view = {
                "player": state["player"],
                "dealer": visible_dealer(state["dealer"], reveal=True),
                "status": state["status"],
                "bet": state["bet"],
                "canDouble": False,
                "canSplit": False,
                "revealDealer": True
            }
            return jsonify({"stateToken": sign_state(state), "view": view})

        deck = state["deck"]
        player = state["player"]
        dealer = state["dealer"]
        bet = state["bet"]

        if action == "hit":
            player.append(deck.pop())
            if hand_value(player) > 21:
                state["status"] = "player_bust"
                state["revealDealer"] = True
        elif action == "double":
            if not state["doubled"] and len(player) == 2:
                state["doubled"] = True
                state["bet"] = bet * 2
                player.append(deck.pop())
                if hand_value(player) > 21:
                    state["status"] = "player_bust"
                    state["revealDealer"] = True
                else:
                    action = "stand"  # force stand after double
            else:
                # ignore invalid double, treat as hit
                player.append(deck.pop())
                if hand_value(player) > 21:
                    state["status"] = "player_bust"
                    state["revealDealer"] = True

        if action == "stand":
            # dealer plays
            while hand_value(dealer) < 17:  # dealer stands on soft 17? tweak as needed
                dealer.append(deck.pop())
            pv = hand_value(player)
            dv = hand_value(dealer)
            if dv > 21:
                state["status"] = "dealer_bust"
            elif pv > dv:
                state["status"] = "player_win"
            elif pv < dv:
                state["status"] = "dealer_win"
            else:
                state["status"] = "push"
            state["revealDealer"] = True

        state["player"] = player
        state["dealer"] = dealer
        state["deck"] = deck

        view = {
            "player": player,
            "dealer": visible_dealer(dealer, reveal=state.get("revealDealer", False)),
            "status": state["status"],
            "bet": state["bet"],
            "canDouble": state["status"]=="playing" and len(player)==2 and not state["doubled"],
            "canSplit": False,
            "revealDealer": state.get("revealDealer", False)
        }
        return jsonify({"stateToken": sign_state(state), "view": view})

    else:
        return jsonify({"error": "Unknown action"}), 400
