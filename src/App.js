import React, { useState, useEffect, useRef } from "react";
import {
  insertCoin,
  myPlayer,
  isHost,
  useMultiplayerState,
  usePlayersList,
} from "playroomkit";

// --- CONFIGURAÇÃO ---
const SUITS = {
  hearts: { symbol: "♥️", color: "text-red-600", name: "Copas" },
  diamonds: { symbol: "♦️", color: "text-red-600", name: "Ouros" },
  clubs: { symbol: "♣️", color: "text-slate-900", name: "Paus" },
  spades: { symbol: "♠️", color: "text-slate-900", name: "Espadas" },
};

// Hierarquia de nomes para exibição (os valores numéricos reais são definidos em getCardPower)
// Hierarquia ajustada para refletir a força real no jogo (A > 3 > 7 > 2 > K...)
const RANKS = [
  { label: "A", value: 14 }, // O maior de todos
  { label: "3", value: 13 }, // Manilha forte
  { label: "7", value: 12 }, // Manilha forte
  { label: "2", value: 11 }, // Manilha forte
  { label: "K", value: 10 },
  { label: "4", value: 9 }, // Empata com K em pontos, mas perde na força? (Ajustável)
  { label: "J", value: 8 },
  { label: "5", value: 7 },
  { label: "Q", value: 6 },
  { label: "6", value: 5 }, // O menor de todos
];

const POINTS_GOAL = 31;

export default function App() {
  // --- ESTADOS GLOBAIS ---
  const [gameState, setGameState] = useMultiplayerState("gameState", "lobby");
  const [deck, setDeck] = useMultiplayerState("deck", []);
  const [tableCards, setTableCards] = useMultiplayerState("tableCards", []);
  const [trumpSuit, setTrumpSuit] = useMultiplayerState("trumpSuit", null);
  const [turn, setTurn] = useMultiplayerState("turn", null);

  const [roundScores, setRoundScores] = useMultiplayerState("roundScores", {});
  const [gamePoints, setGamePoints] = useMultiplayerState("gamePoints", {});
  const [tocoTarget, setTocoTarget] = useMultiplayerState("tocoTarget", null);
  const [lives, setLives] = useMultiplayerState("lives", 3);

  const [roundResult, setRoundResult] = useMultiplayerState(
    "roundResult",
    null
  );
  const [trickFeedback, setTrickFeedback] = useMultiplayerState(
    "trickFeedback",
    null
  );

  const [localProcessing, setLocalProcessing] = useState(false);

  const players = usePlayersList(true);
  const me = myPlayer();

  const stateRef = useRef({
    deck,
    roundScores,
    players,
    trumpSuit,
    turn,
    gamePoints,
    lives,
    tocoTarget,
  });
  useEffect(() => {
    stateRef.current = {
      deck,
      roundScores,
      players,
      trumpSuit,
      turn,
      gamePoints,
      lives,
      tocoTarget,
    };
  }, [
    deck,
    roundScores,
    players,
    trumpSuit,
    turn,
    gamePoints,
    lives,
    tocoTarget,
  ]);

  useEffect(() => {
    insertCoin({ skipLobby: false, gameId: "toco-v22-visual-turbo" });
  }, []);

  // --- SENSOR 1: JUIZ DA RODADA ---
  useEffect(() => {
    if (
      isHost() &&
      tableCards.length === players.length &&
      players.length >= 2
    ) {
      const timer = setTimeout(() => {
        resolveRound(tableCards);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [tableCards, players.length]);

  // --- SENSOR 2: DISTRIBUIDOR ---
  useEffect(() => {
    if (isHost() && gameState === "dealing") {
      performDeal();
    }
  }, [gameState]);

  // --- DESTRAVAS ---
  useEffect(() => {
    if (tableCards.length === 0) setLocalProcessing(false);
    if (me?.id && turn === me.id) setLocalProcessing(false);
  }, [tableCards.length, turn, me?.id]);

  // --- LÓGICA DE CARTAS ---
  const createDeepShuffleDeck = () => {
    let newDeck = [];
    Object.keys(SUITS).forEach((suitKey) => {
      RANKS.forEach((rank) => {
        newDeck.push({
          ...rank,
          suit: suitKey,
          id: `${suitKey}-${rank.label}-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`,
        });
      });
    });
    for (let i = newDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }
    return newDeck;
  };

  // --- HIERARQUIA DE PODER (QUEM GANHA A VAZA) ---
  function getCardPower(card, currentTrump, leadSuit) {
    let power = 0;

    // Força base das cartas (usada para desempate dentro do mesmo naipe)
    // A > 3 > 7 > 2 > K > 4 > J > 5 > Q > 6
    const basePower = {
      A: 100,
      3: 90,
      7: 80,
      2: 70,
      K: 60,
      4: 55,
      J: 50,
      5: 45,
      Q: 40,
      6: 35,
    };

    power = basePower[card.label] || 0;

    // 1. REGRA DO CORTE (TRUNFO)
    // Se for do naipe de trunfo, ganha bônus gigante (+1000).
    // Isso garante que um 6 de trunfo ganhe de um Ás de outro naipe.
    if (card.suit === currentTrump) {
      power += 1000;
    }
    // 2. REGRA DO NAIPE (SEGUIR A MESA)
    // Se não for trunfo, mas for do naipe da puxada (leadSuit), ganha bônus médio (+200).
    // Isso garante que um 6 do naipe ganhe de um 7 (Bisca) de fora.
    else if (card.suit === leadSuit) {
      power += 200;
    }

    // Se for Bisca de outro naipe (que não é trunfo nem leadSuit),
    // ela fica só com o "power" base (ex: 80 ou 100), perdendo para o +200.

    return power;
  }

  // --- CONTAGEM DE PONTOS (PARA OS 31) ---
  const getCardPoints = (card, currentTrump) => {
    const label = card.label;

    // --- PONTOS FIXOS (Valem em qualquer naipe - BISCAS e FIGURAS) ---

    // Ás (Corte ou Bisca) sempre vale 11
    if (label === "A") return 11;

    // 7 (Manilha ou Bisca) sempre vale 10
    if (label === "7") return 10;

    // Rei (K) e 4 valem 4 pontos
    if (label === "K") return 4;
    if (label === "4") return 4;

    // Valete (J) e 5 valem 3 pontos
    if (label === "J") return 3;
    if (label === "5") return 3;

    // Dama (Q) e 6 valem 2 pontos
    if (label === "Q") return 2;
    if (label === "6") return 2;

    // --- PONTOS CONDICIONAIS (Só valem se for TRUNFO) ---
    // 3 e 2 geralmente só pontuam se forem trunfo (confirmei 6 como 2 pts acima)
    const isTrump = card.suit === currentTrump;
    if (isTrump) {
      if (label === "3") return 10;
      if (label === "2") return 10;
    }

    return 0;
  };

  // --- START GAME ---
  const startGameFirstTime = () => {
    if (!isHost()) return;

    const pts = {};
    players.forEach((p) => (pts[p.id] = 0));
    setGamePoints(pts);

    const ids = players.map((p) => p.id);
    const randomIndex = Math.floor(Math.random() * ids.length);
    const randomStartId = ids[randomIndex];

    setTocoTarget(randomStartId);
    setTimeout(() => startNewHand(randomStartId), 100);
  };

  const startNewHand = (targetId) => {
    if (!isHost()) return;

    const newDeck = createDeepShuffleDeck();
    const rScores = {};
    players.forEach((p) => (rScores[p.id] = 0));
    setRoundScores(rScores);

    setTableCards([]);
    setTrickFeedback(null);
    setRoundResult(null);
    setLocalProcessing(false);

    players.forEach((p) => {
      p.setState("hand", []);
    });

    setDeck(newDeck);
    setGameState("choose_trump");
  };

  const confirmTrumpAndDeal = (suit) => {
    setTrumpSuit(suit);
    setGameState("dealing");
    setLocalProcessing(false);
  };

  const performDeal = () => {
    const currentDeck = [...stateRef.current.deck];
    const currentPlayers = stateRef.current.players;

    currentPlayers.forEach((p, index) => {
      const hand = currentDeck.slice(index * 4, (index + 1) * 4);
      p.setState("hand", hand);
    });

    const remaining = currentDeck.slice(currentPlayers.length * 4);
    setDeck(remaining);

    setTurn(stateRef.current.tocoTarget);
    setGameState("playing");
  };

  const handleCardClick = (card) => {
    if (!me?.id) return;
    if (gameState !== "playing") return;
    if (turn !== me.id) return;
    if (localProcessing) return;

    const alreadyPlayed = tableCards.some((tc) => tc.playerId === me.id);
    if (alreadyPlayed) return;

    setLocalProcessing(true);

    const currentHand = me.getState("hand") || [];
    const newHand = currentHand.filter((c) => c.id !== card.id);
    me.setState("hand", newHand);

    const newTable = [...tableCards, { playerId: me.id, card }];
    setTableCards(newTable);

    if (newTable.length < players.length) {
      const myIdx = players.findIndex((p) => p.id === me.id);
      const nextIdx = (myIdx + 1) % players.length;
      setTurn(players[nextIdx].id);
    }
  };

  const resolveRound = (cards) => {
    const {
      deck: currentDeck,
      roundScores: currentRS,
      players: currentP,
      trumpSuit: currentT,
    } = stateRef.current;

    let validCards = cards;
    if (cards.length > 2) validCards = cards.slice(-2);

    const p1 = validCards[0];
    const p2 = validCards[1];

    if (!p1 || !p2) {
      setTableCards([]);
      return;
    }

    const leadSuit = p1.card.suit;
    const p1Power = getCardPower(p1.card, currentT, leadSuit);
    const p2Power = getCardPower(p2.card, currentT, leadSuit);

    let winnerId = p1Power > p2Power ? p1.playerId : p2.playerId;
    const pts =
      getCardPoints(p1.card, currentT) + getCardPoints(p2.card, currentT);

    const newScores = { ...currentRS };
    newScores[winnerId] = (newScores[winnerId] || 0) + pts;
    setRoundScores(newScores);

    const winnerName =
      currentP.find((p) => p.id === winnerId)?.getProfile()?.name || "Oponente";
    setTrickFeedback({ winnerName, pts });

    setTableCards([]);

    if (newScores[winnerId] >= POINTS_GOAL) {
      handleGameEnd(winnerId);
    } else {
      setTimeout(() => {
        let nextDeck = [...currentDeck];

        // CORREÇÃO: Só entrega cartas se houver o par (uma para cada)
        if (nextDeck.length >= 2) {
          const c1 = nextDeck.shift(); // Carta para quem ganhou
          const c2 = nextDeck.shift(); // Carta para quem perdeu

          const pWinner = currentP.find((p) => p.id === winnerId);
          const pLoser = currentP.find((p) => p.id !== winnerId);

          // Garante que ambos recebam a carta no estado do jogo
          if (pWinner)
            pWinner.setState("hand", [...(pWinner.getState("hand") || []), c1]);
          if (pLoser)
            pLoser.setState("hand", [...(pLoser.getState("hand") || []), c2]);

          setDeck(nextDeck);
        }
        setTurn(winnerId);
      }, 300);
      setTimeout(() => setTrickFeedback(null), 2500);
    }
  };

  const handleGameEnd = (winnerId) => {
    const {
      tocoTarget: currentTarget,
      lives: currentLives,
      gamePoints: currentGP,
      players: currentP,
    } = stateRef.current;
    const loserId = currentP.find((p) => p.id !== winnerId)?.id;

    let resultType = "";

    if (winnerId === currentTarget) {
      resultType = "escaped";
      setTocoTarget(loserId);
      setLives(3);
    } else {
      const newLives = currentLives - 1;
      setLives(newLives);
      if (newLives > 0) {
        resultType = "life_lost";
      } else {
        resultType = "toco_confirmed";
        const gPoints = { ...currentGP };
        gPoints[winnerId] = (gPoints[winnerId] || 0) + 1;
        setGamePoints(gPoints);
        setLives(3);
      }
    }

    setRoundResult({
      type: resultType,
      winnerId: winnerId,
      loserId: loserId,
    });

    setGameState("round_end");
    setTrickFeedback(null);
  };

  // --- VISUAL TURBINADO ---

  const EndGameMessage = () => {
    if (!roundResult) return null;
    const iAmWinner = me?.id === roundResult.winnerId;
    const iAmLoser = me?.id === roundResult.loserId;

    if (roundResult.type === "escaped") {
      if (iAmWinner)
        return (
          <span className="text-green-400 drop-shadow-md">
            UFA! ME LIVREI! 😅
          </span>
        );
      if (iAmLoser)
        return (
          <span className="text-yellow-400 drop-shadow-md">
            ELE SE LIVROU! O TOCO AGORA É SEU! 🫵
          </span>
        );
      return <span>O ALVO ESCAPOU!</span>;
    }
    if (roundResult.type === "life_lost") {
      if (iAmLoser)
        return (
          <span className="text-red-400 drop-shadow-md">
            PERDI UMA VIDA! 💔
          </span>
        );
      if (iAmWinner)
        return (
          <span className="text-green-400 drop-shadow-md">
            VOCÊ TIROU UMA VIDA DELE! ⚔️
          </span>
        );
      return <span>ALVO PERDEU VIDA!</span>;
    }
    if (roundResult.type === "toco_confirmed") {
      if (iAmLoser)
        return (
          <span className="text-red-600 drop-shadow-md">
            QUE PENA! PEGUEI O TOCO. 🪵
          </span>
        );
      if (iAmWinner)
        return (
          <span className="text-yellow-400 drop-shadow-md">
            AÊ! VOCÊ DEU UM TOCO NELE! 🏆
          </span>
        );
      return <span>TOCO CONFIRMADO!</span>;
    }
    return null;
  };

  const CardFace = ({ card, playable, onClick }) => {
    const isTrump = card.suit === trumpSuit;
    const opacityClass =
      localProcessing && playable ? "opacity-50 cursor-wait" : "opacity-100";

    return (
      <div
        onClick={() => playable && !localProcessing && onClick(card)}
        className={`
          w-16 h-24 md:w-20 md:h-32 bg-gradient-to-br from-gray-100 to-white rounded-xl border border-gray-300 shadow-xl 
          flex flex-col items-center justify-between p-2 select-none relative transition-all duration-200 transform ${opacityClass}
          ${
            playable && !localProcessing
              ? "cursor-pointer hover:-translate-y-6 hover:shadow-yellow-400/50 hover:ring-4 ring-yellow-400 z-10 scale-105"
              : ""
          }
        `}
      >
        <div
          className={`text-left w-full font-bold leading-none ${
            SUITS[card.suit].color
          }`}
        >
          {card.label}
        </div>
        <div className={`text-4xl ${SUITS[card.suit].color} drop-shadow-sm`}>
          {SUITS[card.suit].symbol}
        </div>
        <div
          className={`text-right w-full font-bold leading-none rotate-180 ${
            SUITS[card.suit].color
          }`}
        >
          {card.label}
        </div>
        {isTrump && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full shadow-lg border-2 border-white flex items-center justify-center">
            <div className="w-2 h-2 bg-yellow-600 rounded-full animate-pulse"></div>
          </div>
        )}
      </div>
    );
  };

  const CardBack = () => (
    <div className="w-16 h-24 md:w-20 md:h-32 bg-blue-900 rounded-xl border-2 border-white/50 shadow-2xl flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 to-transparent"></div>
      <div className="w-10 h-16 border-2 border-blue-400/30 rounded-lg border-dashed"></div>
    </div>
  );

  if (gameState === "lobby") {
    return (
      <div
        className="min-h-screen bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-800 via-green-900 to-black flex flex-col items-center justify-center text-white font-sans p-4"
        translate="no"
      >
        <h1 className="text-6xl font-extrabold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-600 drop-shadow-lg notranslate tracking-tighter">
          ♦️ TOCO ♣️
        </h1>
        <div className="bg-black/40 backdrop-blur-md p-8 rounded-2xl border border-white/10 text-center w-full max-w-sm shadow-2xl">
          <p className="mb-6 text-gray-300 font-bold uppercase tracking-wider text-sm">
            Sala de Espera
          </p>
          <div className="flex justify-center gap-3 mb-8">
            {players.map((p) => (
              <div
                key={p.id}
                className="bg-blue-600 px-4 py-2 rounded-lg font-bold shadow-lg border-b-4 border-blue-800 notranslate"
              >
                {p.getProfile()?.name}
              </div>
            ))}
          </div>
          {isHost() && players.length >= 2 ? (
            <button
              onClick={startGameFirstTime}
              className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold py-4 rounded-xl hover:from-yellow-400 hover:to-yellow-500 shadow-lg transition-all transform hover:scale-105 active:scale-95 uppercase tracking-widest"
            >
              INICIAR JOGO
            </button>
          ) : (
            <div className="animate-pulse text-yellow-200 text-sm font-medium bg-yellow-900/30 py-2 rounded-lg">
              {players.length < 2
                ? "Convide um amigo para jogar..."
                : "O Host iniciará a partida..."}
            </div>
          )}
        </div>
      </div>
    );
  }

  const opponent = players.find((p) => p.id !== me?.id);
  const opHandCount = opponent?.getState("hand")?.length || 0;
  const showCards = gameState === "playing" || gameState === "round_end";

  return (
    <div
      className="min-h-screen bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-800 via-green-900 to-black flex flex-col font-sans overflow-hidden notranslate text-white"
      translate="no"
    >
      <style>{`
        @keyframes deal { from { opacity: 0; transform: translateY(-50px); } to { opacity: 1; transform: translateY(0); } }
        .animate-deal { animation: deal 0.5s ease-out forwards; }
      `}</style>

      {/* PLACAR (GLASSMORPHISM) */}
      <div className="bg-black/30 backdrop-blur-md border-b border-white/10 shadow-2xl h-24 flex w-full relative z-20">
        {players[0] && (
          <div
            className={`flex-1 flex flex-col justify-center px-4 border-r border-white/10 ${
              turn === players[0].id ? "bg-white/5" : ""
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="font-bold truncate text-lg drop-shadow">
                {players[0].getProfile()?.name}
              </span>
              {tocoTarget === players[0].id && (
                <div className="flex gap-1 text-lg drop-shadow">
                  {[...Array(lives)].map((_, i) => (
                    <span key={i}>❤️</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end justify-between mt-1">
              <span className="text-yellow-400 font-mono text-3xl font-bold drop-shadow-md">
                {roundScores[players[0].id] || 0}
                <span className="text-sm text-gray-400 font-sans">/31</span>
              </span>
              <span className="text-xs text-gray-400 uppercase tracking-wide">
                Tocos:{" "}
                <span className="text-white font-bold text-sm">
                  {gamePoints[players[0].id] || 0}
                </span>
              </span>
            </div>
          </div>
        )}
        <div className="w-12 flex items-center justify-center bg-black/60 text-gray-500 font-black text-sm italic border-x border-white/10">
          VS
        </div>
        {players[1] && (
          <div
            className={`flex-1 flex flex-col justify-center px-4 border-l border-white/10 ${
              turn === players[1].id ? "bg-white/5" : ""
            }`}
          >
            <div className="flex justify-between items-center flex-row-reverse">
              <span className="font-bold truncate text-lg drop-shadow">
                {players[1].getProfile()?.name}
              </span>
              {tocoTarget === players[1].id && (
                <div className="flex gap-1 text-lg drop-shadow">
                  {[...Array(lives)].map((_, i) => (
                    <span key={i}>❤️</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end justify-between mt-1 flex-row-reverse">
              <span className="text-yellow-400 font-mono text-3xl font-bold drop-shadow-md">
                {roundScores[players[1].id] || 0}
                <span className="text-sm text-gray-400 font-sans">/31</span>
              </span>
              <span className="text-xs text-gray-400 uppercase tracking-wide">
                Tocos:{" "}
                <span className="text-white font-bold text-sm">
                  {gamePoints[players[1].id] || 0}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* MESA */}
      <div className="flex-1 flex flex-col items-center justify-center relative w-full">
        {/* Mão Oponente */}
        <div className="absolute top-4 flex -space-x-2 transition-all duration-500">
          {showCards &&
            Array.from({ length: opHandCount }).map((_, i) => (
              <CardBack key={i} />
            ))}
        </div>

        {/* Baralho e Trunfo */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
          {deck.length > 0 && (
            <div className="w-16 h-24 bg-blue-900 border-2 border-white/50 rounded-lg flex items-center justify-center text-white font-bold shadow-2xl relative">
              <div className="absolute -top-1 -right-1 bg-red-600 text-xs rounded-full w-5 h-5 flex items-center justify-center border border-white shadow">
                {deck.length}
              </div>
            </div>
          )}
          {trumpSuit && (
            <div className="w-12 h-12 bg-white rounded-full border-4 border-yellow-500 flex items-center justify-center text-2xl shadow-xl">
              <span className={SUITS[trumpSuit].color}>
                {SUITS[trumpSuit].symbol}
              </span>
            </div>
          )}
        </div>

        {/* Cartas Jogadas */}
        <div className="flex gap-8 items-center h-40 z-10">
          {tableCards.map((tc, i) => (
            <div
              key={tc.card.id}
              className="flex flex-col items-center animate-bounce"
            >
              <CardFace card={tc.card} playable={false} />
              <span className="bg-black/60 backdrop-blur text-white text-[10px] px-3 py-1 rounded-full mt-2 font-bold shadow-lg border border-white/20">
                {players.find((p) => p.id === tc.playerId)?.getProfile()?.name}
              </span>
            </div>
          ))}
        </div>

        {/* Feedback Vitoria da Mão */}
        {trickFeedback && (
          <div className="absolute z-30 bg-white/95 backdrop-blur px-8 py-4 rounded-2xl border-4 border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.5)] animate-fade-in text-center transform scale-110">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">
              VENCEU A MÃO
            </p>
            <p className="text-3xl font-black text-blue-900 mb-2">
              {trickFeedback.winnerName}
            </p>
            <span className="inline-block bg-green-100 text-green-700 font-bold px-3 py-1 rounded-full text-lg border border-green-200">
              +{trickFeedback.pts} pts
            </span>
          </div>
        )}
      </div>

      {/* MINHA MÃO */}
      <div className="bg-gradient-to-t from-black/80 to-transparent pb-8 pt-4 w-full flex flex-col items-center">
        <div className="mb-4 h-10 flex items-center justify-center">
          {turn === me?.id ? (
            <span className="bg-yellow-400 text-black font-black px-8 py-2 rounded-full animate-pulse shadow-[0_0_20px_rgba(250,204,21,0.6)] border-2 border-white tracking-widest text-sm uppercase transform hover:scale-105 transition-transform cursor-default">
              SUA VEZ DE JOGAR
            </span>
          ) : (
            <span className="text-gray-300 text-xs bg-black/40 backdrop-blur px-6 py-2 rounded-full flex items-center gap-2 border border-white/10">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-ping"></div>
              Aguardando jogada...
            </span>
          )}
        </div>

        <div className="flex -space-x-2 md:space-x-4 px-4 h-36 items-end pb-2">
          {showCards &&
            (me?.getState("hand") || []).map((card) => (
              <div
                key={card.id}
                className="transition-transform duration-200 hover:-translate-y-8 hover:z-20"
              >
                <CardFace
                  card={card}
                  playable={turn === me?.id}
                  onClick={handleCardClick}
                />
              </div>
            ))}
        </div>

        {isHost() && (
          <div className="absolute bottom-2 right-2 opacity-20 hover:opacity-100 transition-opacity">
            <button
              onClick={() => setTurn(tocoTarget)}
              className="text-[10px] bg-red-900/50 hover:bg-red-700 text-white px-3 py-1 rounded border border-red-500/30"
            >
              Failsafe (Destravar)
            </button>
          </div>
        )}
      </div>

      {/* MODAL TRUNFO */}
      {gameState === "choose_trump" && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          {tocoTarget === me?.id ? (
            <div className="bg-white rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full border-4 border-yellow-500 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-2 bg-yellow-500"></div>
              <h2 className="text-3xl font-black mb-2 text-gray-800">
                VOCÊ ESTÁ NO TOCO!
              </h2>
              <p className="text-gray-500 mb-6 text-sm font-medium">
                Escolha o naipe do trunfo para começar.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {Object.keys(SUITS).map((s) => (
                  <button
                    key={s}
                    onClick={() => confirmTrumpAndDeal(s)}
                    className="group border-2 border-gray-100 p-4 rounded-xl hover:bg-yellow-50 hover:border-yellow-400 flex flex-col items-center transition-all duration-200 active:scale-95 shadow-sm hover:shadow-md"
                  >
                    <span className="text-4xl mb-2 group-hover:scale-125 transition-transform duration-200">
                      {SUITS[s].symbol}
                    </span>
                    <span className="text-xs font-bold text-gray-400 group-hover:text-yellow-600 uppercase tracking-widest">
                      {SUITS[s].name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-white bg-black/60 p-8 rounded-2xl border border-white/20 backdrop-blur-md">
              <div className="text-6xl mb-4 animate-bounce">🃏</div>
              <h2 className="text-2xl font-bold text-yellow-400 mb-1">
                Aguardando Trunfo...
              </h2>
              <p className="text-gray-400 text-sm">
                O Alvo está escolhendo o naipe.
              </p>
            </div>
          )}
        </div>
      )}

      {/* MODAL FIM DE RODADA */}
      {gameState === "round_end" && (
        <div className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-gray-900 to-black p-1 rounded-2xl shadow-[0_0_60px_rgba(234,179,8,0.3)] max-w-sm w-full border border-gray-700">
            <div className="bg-gray-900/50 backdrop-blur p-8 rounded-xl text-center">
              <div className="text-2xl font-black text-white mb-6 uppercase flex flex-col gap-3 leading-tight tracking-wide">
                <EndGameMessage />
              </div>

              {isHost() ? (
                <button
                  onClick={() => startNewHand(tocoTarget)}
                  className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold py-4 px-8 rounded-xl hover:from-yellow-400 hover:to-yellow-500 shadow-lg uppercase tracking-widest transition-transform hover:scale-105"
                >
                  Próxima Mão
                </button>
              ) : (
                <div className="flex flex-col items-center gap-2 mt-6 opacity-60">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-white text-xs uppercase tracking-widest">
                    Aguardando Host...
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
